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


@router.post("/players")
def create_player(body: CreatePlayerBody):
    client = get_supabase()
    normalized_name = body.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Player name cannot be empty")

    try:
        existing = _response_data_list(
            client.table("players")
            .select("id, name, score, created_at")
            .eq("name", normalized_name)
            .limit(1)
            .execute()
        )
        if existing:
            return existing[0]

        created = _response_data_list(
            client.table("players")
            .insert({"name": normalized_name})
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
            .select("id, name, score, created_at")
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
def leaderboard():
    client = get_supabase()
    try:
        players = _response_data_list(
            client.table("players")
            .select("id, name, score")
            .order("score", desc=True)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Leaderboard service unavailable") from exc
    return {"players": players}
