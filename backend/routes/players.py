from fastapi import APIRouter, HTTPException

from database import get_supabase
from models import CreatePlayerBody

router = APIRouter(prefix="/api", tags=["players"])


@router.post("/players")
def create_player(body: CreatePlayerBody):
    client = get_supabase()
    normalized_name = body.name.strip()

    existing = (
        client.table("players")
        .select("id, name, score, inventory, created_at")
        .eq("name", normalized_name)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]

    result = (
        client.table("players")
        .insert({"name": normalized_name})
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Player creation failed")
    return result.data[0]


@router.get("/players/{player_id}")
def get_player(player_id: str):
    client = get_supabase()
    result = (
        client.table("players")
        .select("id, name, score, inventory, created_at")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Player not found")
    return result.data


@router.get("/leaderboard")
def leaderboard():
    client = get_supabase()
    result = (
        client.table("players")
        .select("id, name, score")
        .order("score", desc=True)
        .order("created_at", desc=False)
        .execute()
    )
    return {"players": result.data or []}
