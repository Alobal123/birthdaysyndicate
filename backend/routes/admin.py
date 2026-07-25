from typing import Any, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from database import get_admin_secret, get_supabase
from engine import PubQuizEngine
from models import RoundPhase, SetSpecialPlayerBody

router = APIRouter(prefix="/api/admin", tags=["admin"])
engine = PubQuizEngine(points_for_correct=10)


def _response_data_dict(response) -> dict[str, Any] | None:
    data = getattr(response, "data", None)
    return data if isinstance(data, dict) else None


def _response_data_list(response) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _get_game_state(client):
    try:
        state = _response_data_dict(
            client.table("game_state")
            .select("id, is_active, game_over, current_question_id, special_player_id, round_started_at, round_ends_at, reveal_answers, updated_at")
            .eq("id", 1)
            .maybe_single()
            .execute()
        )
    except Exception:
        state = _response_data_dict(
            client.table("game_state")
            .select("id, is_active, current_question_id, special_player_id, round_started_at, round_ends_at, reveal_answers, updated_at")
            .eq("id", 1)
            .maybe_single()
            .execute()
        )
        if state is not None:
            state["game_over"] = False
        return state

    if state is not None and "game_over" not in state:
        state["game_over"] = False
    return state


def _upsert_game_state(client, payload: dict[str, Any]):
    try:
        return client.table("game_state").upsert(payload).execute()
    except Exception:
        if "game_over" not in payload:
            raise
        fallback_payload = {k: v for k, v in payload.items() if k != "game_over"}
        return client.table("game_state").upsert(fallback_payload).execute()


def _update_game_state(client, payload: dict[str, Any]):
    try:
        return client.table("game_state").update(payload).eq("id", 1).execute()
    except Exception:
        if "game_over" not in payload:
            raise
        fallback_payload = {k: v for k, v in payload.items() if k != "game_over"}
        return client.table("game_state").update(fallback_payload).eq("id", 1).execute()


def _derive_round_phase(state: dict | None) -> str:
    if not state or not state.get("current_question_id"):
        return RoundPhase.IDLE.value
    if state.get("is_active"):
        return RoundPhase.OPEN.value
    if state.get("reveal_answers"):
        return RoundPhase.REVEAL.value
    return RoundPhase.CLOSED.value


def _get_state_with_phase(client):
    state = _get_game_state(client)
    if state:
        state["phase"] = _derive_round_phase(state)
    return state


def _fetch_player_score(client, player_id: str):
    return _response_data_dict(
        client.table("players")
        .select("id, score")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )


def _rebuild_player_scores(client):
    players = _response_data_list(client.table("players").select("id").execute())
    answer_rows = _response_data_list(client.table("player_answers").select("player_id, points_awarded").execute())

    totals: dict[str, int] = {}
    for row in answer_rows:
        player_id = row.get("player_id")
        if not player_id:
            continue
        totals[player_id] = totals.get(player_id, 0) + int(row.get("points_awarded") or 0)

    for player in players:
        player_id = player.get("id")
        if not player_id:
            continue
        (
            client.table("players")
            .update({"score": totals.get(player_id, 0)})
            .eq("id", player_id)
            .execute()
        )


def _fetch_player_answer(client, player_id: str, question_id: str):
    rows = _response_data_list(
        client.table("player_answers")
        .select("selected_option")
        .eq("player_id", player_id)
        .eq("question_id", question_id)
        .order("answered_at", desc=True)
        .limit(1)
        .execute()
    )
    return rows[0]["selected_option"] if rows else None


def _resolve_benchmark_option(client, question: dict, special_player_id: str | None, question_id: str):
    if special_player_id:
        special_answer = _fetch_player_answer(client, special_player_id, question_id)
        if special_answer:
            return special_answer
    return question.get("correct_option")


def _finalize_question_scores(client, question_id: str, special_player_id: str | None = None):
    question = _response_data_dict(
        client.table("quiz_questions")
        .select("id, correct_option")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    if not question:
        return

    special_answer = _fetch_player_answer(client, special_player_id, question_id) if special_player_id else None
    answers = _response_data_list(
        client.table("player_answers")
        .select("id, player_id, selected_option, is_correct, points_awarded")
        .eq("question_id", question_id)
        .execute()
    )

    changed_any = False
    for answer in answers:
        score = engine.score_birthday_answer(
            answer["selected_option"],
            reference_option=question.get("correct_option"),
            special_answer=special_answer,
            is_special_player=bool(special_player_id and answer["player_id"] == special_player_id),
        )
        target_is_correct = score["is_correct"]
        target_points = score["points_awarded"]
        previous_points = int(answer.get("points_awarded") or 0)

        already_scored = (
            bool(answer.get("is_correct")) == target_is_correct
            and previous_points == target_points
        )
        if already_scored:
            continue

        changed_any = True

        (
            client.table("player_answers")
            .update({"is_correct": target_is_correct, "points_awarded": target_points})
            .eq("id", answer["id"])
            .execute()
        )

    if changed_any:
        _rebuild_player_scores(client)


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
    res = _upsert_game_state(client, {"id": 1, "is_active": True, "game_over": False, "updated_at": now})
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.post("/game/stop", dependencies=[Depends(require_admin)])
def stop_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    res = _update_game_state(client, {"is_active": False, "game_over": False, "updated_at": now})
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.post("/game/end", dependencies=[Depends(require_admin)])
def end_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, special_player_id")
        .eq("id", 1)
        .maybe_single()
        .execute()
    )
    question_id = (state or {}).get("current_question_id")
    if question_id:
        _finalize_question_scores(client, question_id, (state or {}).get("special_player_id"))

    res = _upsert_game_state(
        client,
        {
            "id": 1,
            "is_active": False,
            "game_over": True,
            "current_question_id": None,
            "round_started_at": None,
            "round_ends_at": None,
            "reveal_answers": False,
            "updated_at": now,
        },
    )
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.post("/game/reset", dependencies=[Depends(require_admin)])
def reset_game():
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    client.table("players").update({"score": 0}).gte("score", -2147483648).execute()
    client.table("player_answers").delete().gte("points_awarded", 0).execute()

    res = _upsert_game_state(
        client,
        {
            "id": 1,
            "is_active": False,
            "game_over": False,
            "current_question_id": None,
            "round_started_at": None,
            "round_ends_at": None,
            "reveal_answers": False,
            "updated_at": now,
        },
    )
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.get("/players", dependencies=[Depends(require_admin)])
def admin_players():
    client = get_supabase()
    players = _response_data_list(
        client.table("players")
        .select("id, name, score, created_at")
        .order("score", desc=True)
        .execute()
    )
    return {"players": players}


@router.delete("/players/{player_id}", dependencies=[Depends(require_admin)])
def delete_player(player_id: str):
    client = get_supabase()
    rows = _response_data_list(client.table("players").delete().eq("id", player_id).execute())
    return {"deleted": len(rows) > 0}


@router.post("/game/special-player", dependencies=[Depends(require_admin)])
def set_special_player(body: SetSpecialPlayerBody):
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    special_player_id = (body.special_player_id or "").strip() or None
    if special_player_id:
        player = _response_data_dict(
            client.table("players")
            .select("id")
            .eq("id", special_player_id)
            .maybe_single()
            .execute()
        )
        if not player:
            raise HTTPException(status_code=404, detail="Special player not found")

    res = _upsert_game_state(
        client,
        {
            "id": 1,
            "special_player_id": special_player_id,
            "updated_at": now,
        },
    )
    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


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
    correct_option_raw = pick("correct_option", "correctOption")
    correct_option = (str(correct_option_raw).strip().upper() if correct_option_raw is not None else "")
    duration_raw = pick("duration_seconds", "durationSeconds")
    try:
        duration_seconds = int(duration_raw if duration_raw is not None else 30)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="duration_seconds must be an integer")

    if len(prompt) < 5:
        raise HTTPException(status_code=400, detail="Prompt must be at least 5 characters")
    if not option_a or not option_b or not option_c or not option_d:
        raise HTTPException(status_code=400, detail="All options A-D are required")
    if correct_option and correct_option not in {"A", "B", "C", "D"}:
        raise HTTPException(status_code=400, detail="correct_option must be one of A, B, C, D")
    if duration_seconds < 5 or duration_seconds > 600:
        raise HTTPException(status_code=400, detail="duration_seconds must be between 5 and 600")

    payload = {
        "prompt": prompt,
        "option_a": option_a,
        "option_b": option_b,
        "option_c": option_c,
        "option_d": option_d,
        "correct_option": correct_option or None,
        "duration_seconds": duration_seconds,
    }

    res = client.table("quiz_questions").insert(payload).execute()
    created = _response_data_list(res)
    if not created:
        raise HTTPException(status_code=500, detail="Question creation failed")
    return created[0]

@router.get("/questions", dependencies=[Depends(require_admin)])
def list_questions():
    client = get_supabase()
    questions = _response_data_list(
        client.table("quiz_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, duration_seconds, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"questions": questions}


@router.delete("/questions/{question_id}", dependencies=[Depends(require_admin)])
def delete_question(question_id: str):
    client = get_supabase()
    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, is_active, reveal_answers")
        .eq("id", 1)
        .maybe_single()
        .execute()
    )
    if (state or {}).get("current_question_id") == question_id:
        raise HTTPException(status_code=409, detail="Cannot delete the current round question")

    rows = _response_data_list(client.table("quiz_questions").delete().eq("id", question_id).execute())
    return {"deleted": len(rows) > 0}


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

    question = _response_data_dict(
        client.table("quiz_questions")
        .select("id, duration_seconds")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    duration_raw = body.get("duration_seconds", body.get("durationSeconds"))
    if duration_raw is None:
        duration_seconds = int(question.get("duration_seconds") or 30)
    else:
        try:
            duration_seconds = int(duration_raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="duration_seconds must be an integer")

    if duration_seconds < 5 or duration_seconds > 600:
        raise HTTPException(status_code=400, detail="duration_seconds must be between 5 and 600")

    now = datetime.now(timezone.utc)
    ends_at = now + timedelta(seconds=duration_seconds)
    res = _upsert_game_state(
        client,
        {
            "id": 1,
            "is_active": True,
            "game_over": False,
            "current_question_id": question_id,
            "round_started_at": now.isoformat(),
            "round_ends_at": ends_at.isoformat(),
            "reveal_answers": False,
            "updated_at": now.isoformat(),
        },
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
        state = _response_data_dict(
            client.table("game_state")
            .select("current_question_id, special_player_id")
            .eq("id", 1)
            .maybe_single()
            .execute()
        )
        question_id = (state or {}).get("current_question_id")
        if not question_id:
            raise HTTPException(status_code=409, detail="Cannot reveal without an active question")

        _finalize_question_scores(client, question_id, (state or {}).get("special_player_id"))

        res = _update_game_state(
            client,
            {
                "reveal_answers": True,
                "is_active": False,
                "current_question_id": question_id,
                "round_ends_at": now,
                "updated_at": now,
            },
        )
    else:
        res = _update_game_state(client, {"reveal_answers": False, "updated_at": now})

    return _get_state_with_phase(client) or (res.data[0] if res.data else {"ok": True})


@router.get("/answers/current", dependencies=[Depends(require_admin)])
def current_answers():
    client = get_supabase()
    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, special_player_id")
        .eq("id", 1)
        .maybe_single()
        .execute()
    )
    question_id = (state or {}).get("current_question_id")
    if not question_id:
        return {"answers": []}

    answers = _response_data_list(
        client.table("player_answers")
        .select("id, player_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("question_id", question_id)
        .order("answered_at", desc=False)
        .execute()
    )

    player_ids = [row["player_id"] for row in answers]
    players = []
    if player_ids:
        players = _response_data_list(
            client.table("players")
            .select("id, name")
            .in_("id", player_ids)
            .execute()
        )
    name_by_id = {row["id"]: row["name"] for row in players}

    decorated = []
    for row in answers:
        decorated.append({**row, "player_name": name_by_id.get(row["player_id"], "Unknown")})

    special_player_id = (state or {}).get("special_player_id")
    special_player_answer = None
    if special_player_id and question_id:
        special_player_answer = _fetch_player_answer(client, special_player_id, question_id)

    return {
        "answers": decorated,
        "special_player_id": special_player_id,
        "special_player_answer": special_player_answer,
    }
