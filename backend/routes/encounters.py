from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from database import get_supabase
from engine import PubQuizEngine
from models import RoundPhase, SubmitAnswerBody

router = APIRouter(prefix="/api", tags=["quiz"])
engine = PubQuizEngine(points_for_correct=10)
ANSWER_GRACE_SECONDS = 3


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
        # Backward compatibility for DBs where game_over column is not migrated yet.
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


def _safe_update_game_state(client, payload: dict[str, Any], *, require_active_question_id: str | None = None):
    query = client.table("game_state").update(payload).eq("id", 1)
    if require_active_question_id is not None:
        query = query.eq("is_active", True).eq("current_question_id", require_active_question_id)
    try:
        return query.execute()
    except Exception:
        if "game_over" not in payload:
            raise
        fallback_payload = {k: v for k, v in payload.items() if k != "game_over"}
        fallback_query = client.table("game_state").update(fallback_payload).eq("id", 1)
        if require_active_question_id is not None:
            fallback_query = fallback_query.eq("is_active", True).eq("current_question_id", require_active_question_id)
        return fallback_query.execute()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_datetime(value: str | None):
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _fetch_player(player_id: str):
    client = get_supabase()
    response = (
        client.table("players")
        .select("id, score")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )
    return _response_data_dict(response)


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


def _derive_round_phase(state: dict | None) -> str:
    if not state or not state.get("current_question_id"):
        return RoundPhase.IDLE.value
    if state.get("is_active"):
        return RoundPhase.OPEN.value
    if state.get("reveal_answers"):
        return RoundPhase.REVEAL.value
    return RoundPhase.CLOSED.value


def _with_phase(state: dict | None):
    if not state:
        return state
    state["phase"] = _derive_round_phase(state)
    return state


def _score_and_finalize_round(client, question_id: str, special_player_id: str | None = None):
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

        if not already_scored:
            changed_any = True
            (
                client.table("player_answers")
                .update({"is_correct": target_is_correct, "points_awarded": target_points})
                .eq("id", answer["id"])
                .execute()
            )

    if changed_any:
        # Deterministic recompute prevents race issues when multiple finalize passes
        # run concurrently around timer expiry.
        _rebuild_player_scores(client)


def _finalize_round_if_needed(client):
    state = _get_game_state(client)
    if not state:
        return None

    question_id = state.get("current_question_id")
    if not question_id:
        return _with_phase(state)

    ends_at = _parse_iso_datetime(state.get("round_ends_at"))
    if not ends_at:
        return _with_phase(state)

    now = datetime.now(timezone.utc)
    if now < ends_at:
        return _with_phase(state)

    if bool(state.get("is_active")):
        # Acquire a soft lock by flipping active off for the current question.
        lock_res = _safe_update_game_state(
            client,
            {
                "is_active": False,
                "game_over": False,
                "reveal_answers": True,
                "current_question_id": question_id,
                "updated_at": _now_iso(),
            },
            require_active_question_id=question_id,
        )
        if lock_res.data:
            _score_and_finalize_round(client, question_id, state.get("special_player_id"))

    return _with_phase(_get_game_state(client))


@router.get("/quiz/state")
def get_quiz_state():
    client = get_supabase()
    state = _finalize_round_if_needed(client)
    if not state:
        state = _get_game_state(client)
        state = _with_phase(state)
    if not state:
        raise HTTPException(status_code=500, detail="Game state missing")

    question = None
    if state.get("current_question_id"):
        question = (
            _response_data_dict(
            client.table("quiz_questions")
            .select("id, prompt, option_a, option_b, option_c, option_d, correct_option")
            .eq("id", state["current_question_id"])
            .maybe_single()
            .execute()
            )
        )
        if question and not state.get("reveal_answers"):
            question.pop("correct_option", None)

    if state.get("reveal_answers") and state.get("current_question_id") and state.get("special_player_id"):
        special_answer = _fetch_player_answer(client, state["special_player_id"], state["current_question_id"])
        if special_answer:
            state["special_player_answer"] = special_answer

    answer_count = 0
    if state.get("current_question_id"):
        answers = _response_data_list(
            client.table("player_answers")
            .select("id")
            .eq("question_id", state["current_question_id"])
            .execute()
        )
        answer_count = len(answers)

    return {"state": state, "question": question, "answer_count": answer_count}


@router.post("/quiz/answer")
def submit_answer(body: SubmitAnswerBody):
    client = get_supabase()
    _finalize_round_if_needed(client)

    player = _fetch_player(body.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    state = _get_game_state(client)

    # Re-check expiration against parsed datetime to avoid string/clock edge cases.
    ends_at = _parse_iso_datetime((state or {}).get("round_ends_at"))
    if state and ends_at and datetime.now(timezone.utc) >= ends_at:
        _finalize_round_if_needed(client)
        state = _get_game_state(client)

    if not state or not state.get("current_question_id"):
        raise HTTPException(status_code=409, detail="No active question")

    now = datetime.now(timezone.utc)
    ends_at = _parse_iso_datetime(state.get("round_ends_at"))
    is_active = bool(state.get("is_active"))

    if is_active:
        if ends_at and now >= ends_at:
            raise HTTPException(status_code=409, detail="Answer window is closed")
    else:
        if not ends_at or now > (ends_at + timedelta(seconds=ANSWER_GRACE_SECONDS)):
            raise HTTPException(status_code=409, detail="Answer window is closed")

    existing_rows = _response_data_list(
        client.table("player_answers")
        .select("id, question_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("player_id", body.player_id)
        .eq("question_id", state["current_question_id"])
        .order("answered_at", desc=True)
        .limit(1)
        .execute()
    )
    existing = existing_rows[0] if existing_rows else None
    if existing:
        if existing.get("selected_option") == body.option.value:
            return {"already_answered": True, "answer": existing}

        updated_rows = _response_data_list(
            client.table("player_answers")
            .update(
                {
                    "selected_option": body.option.value,
                    "is_correct": False,
                    "points_awarded": 0,
                    "answered_at": _now_iso(),
                }
            )
            .eq("id", existing["id"])
            .execute()
        )
        updated = updated_rows[0] if updated_rows else None
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to update answer")

        if not is_active:
            _score_and_finalize_round(client, state["current_question_id"], state.get("special_player_id"))
        return {"already_answered": False, "answer": updated}

    question = _response_data_dict(
        client.table("quiz_questions")
        .select("id")
        .eq("id", state["current_question_id"])
        .maybe_single()
        .execute()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    inserted = _response_data_list(
        client.table("player_answers")
        .insert(
            {
                "player_id": body.player_id,
                "question_id": state["current_question_id"],
                "selected_option": body.option.value,
                "is_correct": False,
                "points_awarded": 0,
            }
        )
        .execute()
    )
    if not inserted:
        raise HTTPException(status_code=500, detail="Failed to submit answer")

    if not is_active:
        _score_and_finalize_round(client, state["current_question_id"], state.get("special_player_id"))

    return {"already_answered": False, "answer": inserted[0]}


@router.get("/quiz/answers/{question_id}/{player_id}")
def get_player_answer(question_id: str, player_id: str):
    client = get_supabase()
    rows = _response_data_list(
        client.table("player_answers")
        .select("id, question_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("question_id", question_id)
        .eq("player_id", player_id)
        .order("answered_at", desc=True)
        .limit(1)
        .execute()
    )
    answer = rows[0] if rows else None
    return {"answer": answer}
