from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import get_supabase
from engine import PubQuizEngine
from models import SubmitAnswerBody

router = APIRouter(prefix="/api", tags=["quiz"])
engine = PubQuizEngine(points_for_correct=10)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


@router.get("/quiz/state")
def get_quiz_state():
    client = get_supabase()
    state = (
        client.table("game_state")
        .select("id, is_active, current_question_id, round_started_at, round_ends_at, reveal_answers, updated_at")
        .eq("id", 1)
        .maybe_single()
        .execute()
        .data
    )
    if not state:
        raise HTTPException(status_code=500, detail="Game state missing")

    question = None
    if state.get("current_question_id"):
        question = (
            client.table("quiz_questions")
            .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, category")
            .eq("id", state["current_question_id"])
            .maybe_single()
            .execute()
            .data
        )
        if question and not state.get("reveal_answers"):
            question.pop("correct_option", None)

    answer_count = 0
    if state.get("current_question_id"):
        answers = (
            client.table("player_answers")
            .select("id")
            .eq("question_id", state["current_question_id"])
            .execute()
            .data
            or []
        )
        answer_count = len(answers)

    return {"state": state, "question": question, "answer_count": answer_count}


@router.post("/quiz/answer")
def submit_answer(body: SubmitAnswerBody):
    client = get_supabase()

    player = _fetch_player(body.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    state = (
        client.table("game_state")
        .select("id, is_active, current_question_id, round_ends_at")
        .eq("id", 1)
        .maybe_single()
        .execute()
        .data
    )
    if not state or not state.get("is_active") or not state.get("current_question_id"):
        raise HTTPException(status_code=409, detail="No active question")

    if state.get("round_ends_at") and _now_iso() > state["round_ends_at"]:
        raise HTTPException(status_code=409, detail="Answer window is closed")

    existing = (
        client.table("player_answers")
        .select("id, question_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("player_id", body.player_id)
        .eq("question_id", state["current_question_id"])
        .maybe_single()
        .execute()
        .data
    )
    if existing:
        return {"already_answered": True, "answer": existing}

    question = (
        client.table("quiz_questions")
        .select("id, correct_option")
        .eq("id", state["current_question_id"])
        .maybe_single()
        .execute()
        .data
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    score = engine.score_answer(body.option.value, question["correct_option"])
    inserted = (
        client.table("player_answers")
        .insert(
            {
                "player_id": body.player_id,
                "question_id": state["current_question_id"],
                "selected_option": body.option.value,
                "is_correct": score["is_correct"],
                "points_awarded": score["points_awarded"],
            }
        )
        .execute()
    )
    if not inserted.data:
        raise HTTPException(status_code=500, detail="Failed to submit answer")

    if score["points_awarded"] > 0:
        client.table("players").update({"score": player["score"] + score["points_awarded"]}).eq("id", body.player_id).execute()

    return {"already_answered": False, "answer": inserted.data[0]}


@router.get("/quiz/answers/{question_id}/{player_id}")
def get_player_answer(question_id: str, player_id: str):
    client = get_supabase()
    answer = (
        client.table("player_answers")
        .select("id, question_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("question_id", question_id)
        .eq("player_id", player_id)
        .maybe_single()
        .execute()
        .data
    )
    return {"answer": answer}
