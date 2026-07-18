import secrets
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException

from database import get_admin_secret, get_supabase
from models import ActivateQuestionBody, CreateQuestionBody, RevealAnswersBody

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
        .upsert({"id": 1, "is_active": True, "updated_at": now})
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

    client.table("players").update({"score": 0}).gte("score", -2147483648).execute()
    client.table("player_answers").delete().gte("points_awarded", 0).execute()

    res = (
        client.table("game_state")
        .upsert(
            {
                "id": 1,
                "is_active": False,
                "current_question_id": None,
                "round_started_at": None,
                "round_ends_at": None,
                "reveal_answers": False,
                "updated_at": now,
            }
        )
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.get("/players", dependencies=[Depends(require_admin)])
def admin_players():
    client = get_supabase()
    res = (
        client.table("players")
        .select("id, name, score, created_at")
        .order("score", desc=True)
        .execute()
    )
    return {"players": res.data or []}


@router.delete("/players/{player_id}", dependencies=[Depends(require_admin)])
def delete_player(player_id: str):
    client = get_supabase()
    res = client.table("players").delete().eq("id", player_id).execute()
    return {"deleted": len(res.data or []) > 0}


@router.post("/questions", dependencies=[Depends(require_admin)])
def create_question(body: CreateQuestionBody):
    client = get_supabase()
    payload = body.model_dump()
    payload["correct_option"] = body.correct_option.value
    res = client.table("quiz_questions").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Question creation failed")
    return res.data[0]

@router.get("/questions", dependencies=[Depends(require_admin)])
def list_questions():
    client = get_supabase()
    res = (
        client.table("quiz_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, category, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"questions": res.data or []}


@router.post("/questions/activate", dependencies=[Depends(require_admin)])
def activate_question(body: ActivateQuestionBody):
    client = get_supabase()
    question = (
        client.table("quiz_questions")
        .select("id")
        .eq("id", body.question_id)
        .maybe_single()
        .execute()
        .data
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    now = datetime.now(timezone.utc)
    ends_at = now + timedelta(seconds=body.duration_seconds)
    res = (
        client.table("game_state")
        .upsert(
            {
                "id": 1,
                "is_active": True,
                "current_question_id": body.question_id,
                "round_started_at": now.isoformat(),
                "round_ends_at": ends_at.isoformat(),
                "reveal_answers": False,
                "updated_at": now.isoformat(),
            }
        )
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.post("/questions/reveal", dependencies=[Depends(require_admin)])
def reveal_answers(body: RevealAnswersBody):
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    res = (
        client.table("game_state")
        .update({"reveal_answers": body.reveal, "updated_at": now})
        .eq("id", 1)
        .execute()
    )
    return res.data[0] if res.data else {"ok": True}


@router.post("/questions/seed", dependencies=[Depends(require_admin)])
def seed_questions():
    client = get_supabase()
    count = client.table("quiz_questions").select("id").limit(1).execute().data or []
    if count:
        return {"seeded": False, "reason": "Questions already exist"}

    nonce = secrets.token_hex(4)
    rows = [
        {
            "prompt": "Which planet is known as the Red Planet?",
            "option_a": "Venus",
            "option_b": "Mars",
            "option_c": "Jupiter",
            "option_d": "Saturn",
            "correct_option": "B",
            "category": f"General-{nonce}",
        },
        {
            "prompt": "How many players are on the field per football team in a standard match?",
            "option_a": "9",
            "option_b": "10",
            "option_c": "11",
            "option_d": "12",
            "correct_option": "C",
            "category": f"Sports-{nonce}",
        },
        {
            "prompt": "What does HTTP stand for?",
            "option_a": "HyperText Transfer Protocol",
            "option_b": "HighText Transfer Program",
            "option_c": "Hyper Transfer Text Process",
            "option_d": "Host Transfer Text Protocol",
            "correct_option": "A",
            "category": f"Tech-{nonce}",
        },
    ]
    res = client.table("quiz_questions").insert(rows).execute()
    return {"seeded": True, "questions": res.data or []}


@router.get("/answers/current", dependencies=[Depends(require_admin)])
def current_answers():
    client = get_supabase()
    state = (
        client.table("game_state")
        .select("current_question_id")
        .eq("id", 1)
        .maybe_single()
        .execute()
        .data
    )
    question_id = (state or {}).get("current_question_id")
    if not question_id:
        return {"answers": []}

    answers = (
        client.table("player_answers")
        .select("id, player_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("question_id", question_id)
        .order("answered_at", desc=False)
        .execute()
        .data
        or []
    )

    player_ids = [row["player_id"] for row in answers]
    players = []
    if player_ids:
        players = (
            client.table("players")
            .select("id, name")
            .in_("id", player_ids)
            .execute()
            .data
            or []
        )
    name_by_id = {row["id"]: row["name"] for row in players}

    decorated = []
    for row in answers:
        decorated.append({**row, "player_name": name_by_id.get(row["player_id"], "Unknown")})

    return {"answers": decorated}
