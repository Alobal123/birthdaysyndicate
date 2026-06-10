from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import get_supabase
from models import ClaimLootBody

router = APIRouter(prefix="/api", tags=["loot"])


@router.post("/loot/claim")
def claim_loot(body: ClaimLootBody):
    client = get_supabase()

    token_row = (
        client.table("loot_tokens")
        .select("id, item_type, token, is_used")
        .eq("token", body.token)
        .maybe_single()
        .execute()
        .data
    )
    if not token_row:
        raise HTTPException(status_code=404, detail="Invalid token")
    if token_row["is_used"]:
        raise HTTPException(status_code=409, detail="Token already claimed")

    player = (
        client.table("players")
        .select("id, inventory")
        .eq("id", body.player_id)
        .maybe_single()
        .execute()
        .data
    )
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    inventory = player.get("inventory") or []
    inventory.append(token_row["item_type"])

    (
        client.table("players")
        .update({"inventory": inventory})
        .eq("id", body.player_id)
        .execute()
    )

    (
        client.table("loot_tokens")
        .update(
            {
                "is_used": True,
                "claimed_by": body.player_id,
                "claimed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", token_row["id"])
        .execute()
    )

    return {"ok": True, "item": token_row["item_type"], "inventory": inventory}
