import secrets
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from database import get_admin_secret, get_supabase
from engine import PubQuizEngine
from models import RoundPhase

router = APIRouter(prefix="/api/admin", tags=["admin"])
engine = PubQuizEngine(points_for_correct=10)


def _derive_round_phase(state: dict | None) -> str:
    if not state or not state.get("current_question_id"):
        return RoundPhase.IDLE.value
    if state.get("is_active"):
        return RoundPhase.OPEN.value
    if state.get("reveal_answers"):
        return RoundPhase.REVEAL.value
    return RoundPhase.CLOSED.value


def _get_state_with_phase(client):
    state = (
        client.table("game_state")
        .select("id, is_active, current_question_id, round_started_at, round_ends_at, reveal_answers, updated_at")
        .eq("id", 1)
        .maybe_single()
        .execute()
        .data
    )
    if state:
        state["phase"] = _derive_round_phase(state)
    return state


def _fetch_player_score(client, player_id: str):
    return (
        client.table("players")
        .select("id, score")
        .eq("id", player_id)
        .maybe_single()
        .execute()
        .data
    )


def _finalize_question_scores(client, question_id: str):
    question = (
        client.table("quiz_questions")
        .select("id, correct_option")
        .eq("id", question_id)
        .maybe_single()
        .execute()
        .data
    )
    if not question:
        return

    answers = (
        client.table("player_answers")
        .select("id, player_id, selected_option, is_correct, points_awarded")
        .eq("question_id", question_id)
        .execute()
        .data
        or []
    )

    for answer in answers:
        score = engine.score_answer(answer["selected_option"], question["correct_option"])
        target_is_correct = score["is_correct"]
        target_points = score["points_awarded"]

        already_scored = (
            bool(answer.get("is_correct")) == target_is_correct
            and int(answer.get("points_awarded") or 0) == target_points
        )
        if already_scored:
            continue

        (
            client.table("player_answers")
            .update({"is_correct": target_is_correct, "points_awarded": target_points})
            .eq("id", answer["id"])
            .execute()
        )

        if target_points > 0:
            player = _fetch_player_score(client, answer["player_id"])
            if player:
                (
                    client.table("players")
                    .update({"score": int(player["score"] or 0) + target_points})
                    .eq("id", answer["player_id"])
                    .execute()
                )


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
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


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
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


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
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


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
async def create_question(request: Request):
    client = get_supabase()

    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    def pick(*keys: str):
        for key in keys:
            if key in body:
                return body.get(key)
        return None

    prompt = (pick("prompt") or "").strip()
    option_a = (pick("option_a", "optionA") or "").strip()
    option_b = (pick("option_b", "optionB") or "").strip()
    option_c = (pick("option_c", "optionC") or "").strip()
    option_d = (pick("option_d", "optionD") or "").strip()
    correct_option = (pick("correct_option", "correctOption") or "").strip().upper()
    category_raw = pick("category")
    category = category_raw.strip() if isinstance(category_raw, str) else None

    if len(prompt) < 5:
        raise HTTPException(status_code=400, detail="Prompt must be at least 5 characters")
    if not option_a or not option_b or not option_c or not option_d:
        raise HTTPException(status_code=400, detail="All options A-D are required")
    if correct_option not in {"A", "B", "C", "D"}:
        raise HTTPException(status_code=400, detail="correct_option must be one of A, B, C, D")

    payload = {
        "prompt": prompt,
        "option_a": option_a,
        "option_b": option_b,
        "option_c": option_c,
        "option_d": option_d,
        "correct_option": correct_option,
        "category": category,
    }

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
async def activate_question(request: Request):
    client = get_supabase()

    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    question_id_raw = body.get("question_id", body.get("questionId"))
    question_id = str(question_id_raw or "").strip()
    if not question_id:
        raise HTTPException(status_code=400, detail="question_id is required")

    duration_raw = body.get("duration_seconds", body.get("durationSeconds", 30))
    try:
        duration_seconds = int(duration_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="duration_seconds must be an integer")

    if duration_seconds < 5 or duration_seconds > 600:
        raise HTTPException(status_code=400, detail="duration_seconds must be between 5 and 600")

    question = (
        client.table("quiz_questions")
        .select("id")
        .eq("id", question_id)
        .maybe_single()
        .execute()
        .data
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    now = datetime.now(timezone.utc)
    ends_at = now + timedelta(seconds=duration_seconds)
    res = (
        client.table("game_state")
        .upsert(
            {
                "id": 1,
                "is_active": True,
                "current_question_id": question_id,
                "round_started_at": now.isoformat(),
                "round_ends_at": ends_at.isoformat(),
                "reveal_answers": False,
                "updated_at": now.isoformat(),
            }
        )
        .execute()
    )
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.post("/questions/reveal", dependencies=[Depends(require_admin)])
async def reveal_answers(request: Request):
    client = get_supabase()
    try:
        body = await request.json()
    except Exception:
        body = {}

    reveal = True
    if isinstance(body, dict) and "reveal" in body:
        reveal_raw = body.get("reveal")
        if isinstance(reveal_raw, bool):
            reveal = reveal_raw
        elif isinstance(reveal_raw, str):
            reveal = reveal_raw.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            reveal = bool(reveal_raw)

    now = datetime.now(timezone.utc).isoformat()

    if reveal:
        state = (
            client.table("game_state")
            .select("current_question_id")
            .eq("id", 1)
            .maybe_single()
            .execute()
            .data
        )
        question_id = (state or {}).get("current_question_id")
        if question_id:
            _finalize_question_scores(client, question_id)

        res = (
            client.table("game_state")
            .update({
                "reveal_answers": True,
                "is_active": False,
                "round_ends_at": now,
                "updated_at": now,
            })
            .eq("id", 1)
            .execute()
        )
    else:
        res = (
            client.table("game_state")
            .update({"reveal_answers": False, "updated_at": now})
            .eq("id", 1)
            .execute()
        )

    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


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
