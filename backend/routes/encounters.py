from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import get_supabase
from engine import SyndicateGameEngine
from models import CreateEncounterBody, EncounterStatus, JoinEncounterBody, SubmitChoiceBody

router = APIRouter(prefix="/api", tags=["encounters"])
engine = SyndicateGameEngine()


def _fetch_player(player_id: str):
    client = get_supabase()
    return (
        client.table("players")
        .select("id, score")
        .eq("id", player_id)
        .maybe_single()
        .execute()
        .data
    )


@router.post("/encounters")
def create_encounter(body: CreateEncounterBody):
    if not _fetch_player(body.p1_id):
        raise HTTPException(status_code=404, detail="Player not found")

    client = get_supabase()
    result = (
        client.table("encounters")
        .insert({"p1_id": body.p1_id, "status": EncounterStatus.PENDING.value})
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Encounter creation failed")
    return result.data[0]


@router.get("/encounters/{encounter_id}")
def get_encounter(encounter_id: str):
    client = get_supabase()
    result = (
        client.table("encounters")
        .select("*")
        .eq("id", encounter_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Encounter not found")
    return result.data


@router.patch("/encounters/{encounter_id}/join")
def join_encounter(encounter_id: str, body: JoinEncounterBody):
    client = get_supabase()

    encounter_res = (
        client.table("encounters")
        .select("id, p1_id, p2_id, status")
        .eq("id", encounter_id)
        .maybe_single()
        .execute()
    )
    encounter = encounter_res.data
    if not encounter:
        raise HTTPException(status_code=404, detail="Encounter not found")
    if encounter["status"] != EncounterStatus.PENDING.value:
        # Idempotent join: if this player already joined, return success.
        if encounter.get("p2_id") == body.player_id:
            return encounter
        raise HTTPException(status_code=409, detail="Encounter is not joinable")
    if encounter["p1_id"] == body.player_id:
        raise HTTPException(status_code=400, detail="Cannot join your own encounter as player 2")
    if not _fetch_player(body.player_id):
        raise HTTPException(status_code=404, detail="Player not found")

    update_res = (
        client.table("encounters")
        .update({"p2_id": body.player_id, "status": EncounterStatus.LOCKED.value})
        .eq("id", encounter_id)
        .eq("status", EncounterStatus.PENDING.value)
        .execute()
    )
    if not update_res.data:
        # Handle race: another request may have already locked this encounter.
        latest = (
            client.table("encounters")
            .select("id, p1_id, p2_id, status")
            .eq("id", encounter_id)
            .maybe_single()
            .execute()
            .data
        )
        if latest and latest.get("p2_id") == body.player_id:
            return latest
        raise HTTPException(status_code=409, detail="Encounter already joined")
    return update_res.data[0]


@router.patch("/encounters/{encounter_id}/choice")
def submit_choice(encounter_id: str, body: SubmitChoiceBody):
    client = get_supabase()

    encounter_res = (
        client.table("encounters")
        .select("*")
        .eq("id", encounter_id)
        .maybe_single()
        .execute()
    )
    encounter = encounter_res.data
    if not encounter:
        raise HTTPException(status_code=404, detail="Encounter not found")
    if encounter["status"] not in [EncounterStatus.LOCKED.value, EncounterStatus.PENDING.value]:
        raise HTTPException(status_code=409, detail="Encounter cannot accept choices")

    if body.player_id == encounter["p1_id"]:
        if encounter.get("p1_choice"):
            raise HTTPException(status_code=409, detail="Choice already locked")
        choice_patch = {"p1_choice": body.choice.value, "p1_item": body.item}
    elif body.player_id == encounter["p2_id"]:
        if encounter.get("p2_choice"):
            raise HTTPException(status_code=409, detail="Choice already locked")
        choice_patch = {"p2_choice": body.choice.value, "p2_item": body.item}
    else:
        raise HTTPException(status_code=403, detail="Player is not part of this encounter")

    (
        client.table("encounters")
        .update(choice_patch)
        .eq("id", encounter_id)
        .execute()
    )

    refreshed = (
        client.table("encounters")
        .select("*")
        .eq("id", encounter_id)
        .maybe_single()
        .execute()
        .data
    )
    if not refreshed:
        raise HTTPException(status_code=500, detail="Failed to refresh encounter")

    if not refreshed.get("p1_choice") or not refreshed.get("p2_choice"):
        if refreshed["status"] == EncounterStatus.PENDING.value and refreshed.get("p2_id"):
            (
                client.table("encounters")
                .update({"status": EncounterStatus.LOCKED.value})
                .eq("id", encounter_id)
                .execute()
            )
        return {"status": "WAITING", "encounter": refreshed}

    eval_result = engine.evaluate(
        refreshed["p1_choice"],
        refreshed["p2_choice"],
        refreshed.get("p1_item"),
        refreshed.get("p2_item"),
    )

    p1 = _fetch_player(refreshed["p1_id"])
    p2 = _fetch_player(refreshed["p2_id"])
    if not p1 or not p2:
        raise HTTPException(status_code=404, detail="Encounter player missing")

    if eval_result["status"] == EncounterStatus.COMPLETED.value:
        (
            client.table("players")
            .update({"score": p1["score"] + int(eval_result["p1_delta"])})
            .eq("id", refreshed["p1_id"])
            .execute()
        )
        (
            client.table("players")
            .update({"score": p2["score"] + int(eval_result["p2_delta"])})
            .eq("id", refreshed["p2_id"])
            .execute()
        )

    status = eval_result["status"]
    final_patch = {"status": status}
    if status == EncounterStatus.COMPLETED.value:
        final_patch["completed_at"] = datetime.now(timezone.utc).isoformat()

    final_res = (
        client.table("encounters")
        .update(final_patch)
        .eq("id", encounter_id)
        .execute()
    )

    return {
        "status": status,
        "result": eval_result,
        "encounter": final_res.data[0] if final_res.data else refreshed,
    }
