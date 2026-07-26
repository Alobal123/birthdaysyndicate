from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException

from database import get_supabase
from models import CreatePlayerBody

router = APIRouter(prefix="/api", tags=["players"])


def _response_data_dict(response) -> dict[str, Any] | None:
    data = getattr(response, "data", None)
    return data if isinstance(data, dict) else None


def _response_data_list(response) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _get_active_game(client):
    """Get the first active game, or return None"""
    games = _response_data_list(
        client.table("games")
        .select("id")
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    return games[0]["id"] if games else None


@router.post("/players")
def create_player(body: CreatePlayerBody):
    client = get_supabase()
    normalized_name = body.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Player name cannot be empty")

    # Use provided game_id or get active game
    game_id = body.game_id
    if not game_id:
        game_id = _get_active_game(client)
    
    if not game_id:
        raise HTTPException(status_code=400, detail="No active game available")

    try:
        existing = _response_data_list(
            client.table("players")
            .select("id, name, score, created_at")
            .eq("game_id", game_id)
            .eq("name", normalized_name)
            .limit(1)
            .execute()
        )
        if existing:
            return existing[0]

        created = _response_data_list(
            client.table("players")
            .insert({"game_id": game_id, "name": normalized_name, "score": 0})
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Player service unavailable") from exc

    if not created:
        raise HTTPException(status_code=500, detail="Player creation failed")
    return created[0]


@router.get("/players/{player_id}")
def get_player(player_id: str):
    try:
        UUID(player_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid player id")

    client = get_supabase()
    try:
        player = _response_data_dict(
            client.table("players")
            .select("id, game_id, name, score, created_at")
            .eq("id", player_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Player service unavailable") from exc

    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.get("/leaderboard")
def leaderboard(game_id: str = None):
    client = get_supabase()
    
    # If no game_id provided, use active game
    if not game_id:
        game_id = _get_active_game(client)
    
    if not game_id:
        raise HTTPException(status_code=400, detail="No active game available")
    
    try:
        players = _response_data_list(
            client.table("players")
            .select("id, name, score")
            .eq("game_id", game_id)
            .order("score", desc=True)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Leaderboard service unavailable") from exc
    return {"players": players}
