import secrets
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException

from database import get_admin_secret, get_supabase
from models import AdminGenerateLootBody, EncounterStatus

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(authorization: Optional[str] = Header(default=None)):
    expected = get_admin_secret()
    if not expected:
        raise HTTPException(status_code=500, detail="ADMIN_SECRET is not configured")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.replace("Bearer ", "", 1).strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid admin token")


@router.post("/game/start", dependencies=[Depends(require_admin)])
def start_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    res = (
        client.table("game_state")
        .upsert({"id": 1, "is_active": True, "started_at": now, "updated_at": now})
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.post("/game/stop", dependencies=[Depends(require_admin)])
def stop_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    res = (
        client.table("game_state")
        .update({"is_active": False, "updated_at": now})
        .eq("id", 1)
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.post("/game/reset", dependencies=[Depends(require_admin)])
def reset_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    client.table("players").update({"score": 0, "inventory": []}).gte("score", -2147483648).execute()
    client.table("encounters").update({"status": EncounterStatus.CANCELED.value}).in_("status", [EncounterStatus.PENDING.value, EncounterStatus.LOCKED.value]).execute()

    state = (
        client.table("game_state")
        .select("id, reset_count")
        .eq("id", 1)
        .maybe_single()
        .execute()
        .data
    )
    reset_count = (state or {}).get("reset_count", 0) + 1

    res = (
        client.table("game_state")
        .upsert({"id": 1, "is_active": False, "reset_count": reset_count, "updated_at": now})
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.get("/players", dependencies=[Depends(require_admin)])
def admin_players():
    client = get_supabase()
    res = (
        client.table("players")
        .select("id, name, score, inventory, created_at")
        .order("score", desc=True)
        .execute()
    )
    return {"players": res.data or []}


@router.delete("/players/{player_id}", dependencies=[Depends(require_admin)])
def delete_player(player_id: str):
    client = get_supabase()
    res = client.table("players").delete().eq("id", player_id).execute()
    return {"deleted": len(res.data or []) > 0}


@router.post("/loot/generate", dependencies=[Depends(require_admin)])
def generate_loot_tokens(body: AdminGenerateLootBody):
    client = get_supabase()

    rows = []
    for _ in range(body.count):
        rows.append({"item_type": body.item_type, "token": secrets.token_urlsafe(18)})

    res = client.table("loot_tokens").insert(rows).execute()
    return {"tokens": res.data or []}


@router.get("/loot", dependencies=[Depends(require_admin)])
def list_loot_tokens():
    client = get_supabase()
    res = (
        client.table("loot_tokens")
        .select("id, item_type, token, is_used, claimed_by, claimed_at, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"tokens": res.data or []}
