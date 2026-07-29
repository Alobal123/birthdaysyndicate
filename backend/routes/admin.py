from typing import Any, Optional
from datetime import datetime, timedelta, timezone
import os
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile

from database import get_admin_secret, get_supabase
from engine import PubQuizEngine
from in_memory_cache import cache_delete, cache_delete_prefix
from models import RoundPhase, SetSpecialPlayerBody

router = APIRouter(prefix="/api/admin", tags=["admin"])
engine = PubQuizEngine(points_for_correct=10)


def _invalidate_game_caches(game_id: str):
    cache_delete("players:active_game")
    cache_delete(f"players:leaderboard:{game_id}")
    cache_delete(f"quiz:state:{game_id}")
    cache_delete(f"quiz:game_state:{game_id}")
    cache_delete_prefix(f"quiz:player_answer:{game_id}:")


def _invalidate_question_cache(question_id: str | None):
    if question_id:
        cache_delete(f"quiz:question:{question_id}")


def _response_data_dict(response) -> dict[str, Any] | None:
    data = getattr(response, "data", None)
    return data if isinstance(data, dict) else None


def _response_data_list(response) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _get_game_state(client, game_id: str):
    try:
        state = _response_data_dict(
            client.table("game_state")
            .select("id, game_id, is_active, game_over, current_question_id, special_player_id, round_started_at, round_ends_at, reveal_answers, updated_at")
            .eq("game_id", game_id)
            .maybe_single()
            .execute()
        )
    except Exception:
        state = _response_data_dict(
            client.table("game_state")
            .select("id, game_id, is_active, current_question_id, special_player_id, round_started_at, round_ends_at, reveal_answers, updated_at")
            .eq("game_id", game_id)
            .maybe_single()
            .execute()
        )
        if state is not None:
            state["game_over"] = False
        return state

    if state is not None and "game_over" not in state:
        state["game_over"] = False
    return state


def _upsert_game_state(client, game_id: str, payload: dict[str, Any]):
    # Always use update since game_state is created when game is created
    try:
        return client.table("game_state").update(payload).eq("game_id", game_id).execute()
    except Exception:
        if "game_over" not in payload:
            raise
        fallback_payload = {k: v for k, v in payload.items() if k != "game_over"}
        return client.table("game_state").update(fallback_payload).eq("game_id", game_id).execute()


def _update_game_state(client, game_id: str, payload: dict[str, Any]):
    try:
        return client.table("game_state").update(payload).eq("game_id", game_id).execute()
    except Exception:
        if "game_over" not in payload:
            raise
        fallback_payload = {k: v for k, v in payload.items() if k != "game_over"}
        return client.table("game_state").update(fallback_payload).eq("game_id", game_id).execute()


def _derive_round_phase(state: dict | None) -> str:
    if not state or not state.get("current_question_id"):
        return RoundPhase.IDLE.value
    if state.get("is_active"):
        return RoundPhase.OPEN.value
    if state.get("reveal_answers"):
        return RoundPhase.REVEAL.value
    return RoundPhase.CLOSED.value


def _get_state_with_phase(client, game_id: str):
    state = _get_game_state(client, game_id)
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


def _rebuild_player_scores(client, game_id: str):
    players = _response_data_list(
        client.table("players")
        .select("id")
        .eq("game_id", game_id)
        .execute()
    )
    answer_rows = _response_data_list(
        client.table("player_answers")
        .select("player_id, points_awarded")
        .eq("game_id", game_id)
        .execute()
    )

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


def _question_image_bucket() -> str:
    return os.getenv("SUPABASE_QUESTION_IMAGE_BUCKET", "question-clues").strip() or "question-clues"


def _storage_public_url(client, bucket: str, path: str) -> str:
    result = client.storage.from_(bucket).get_public_url(path)
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        if isinstance(result.get("data"), dict):
            data_url = result["data"].get("publicUrl") or result["data"].get("publicURL")
            if data_url:
                return data_url
        dict_url = result.get("publicUrl") or result.get("publicURL")
        if dict_url:
            return dict_url
    raise HTTPException(status_code=500, detail="Failed to resolve image public URL")


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


def _finalize_question_scores(client, game_id: str, question_id: str, special_player_id: str | None = None):
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
        _rebuild_player_scores(client, game_id)


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
def start_game(game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    now = datetime.now(timezone.utc).isoformat()
    res = _upsert_game_state(
        client,
        game_id,
        {"game_id": game_id, "is_active": True, "game_over": False, "updated_at": now}
    )
    _invalidate_game_caches(game_id)
    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


@router.post("/game/stop", dependencies=[Depends(require_admin)])
def stop_game(game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    now = datetime.now(timezone.utc).isoformat()
    res = _update_game_state(
        client,
        game_id,
        {"is_active": False, "game_over": False, "updated_at": now}
    )
    _invalidate_game_caches(game_id)
    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


@router.post("/game/end", dependencies=[Depends(require_admin)])
def end_game(game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    now = datetime.now(timezone.utc).isoformat()

    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, special_player_id")
        .eq("game_id", game_id)
        .maybe_single()
        .execute()
    )
    question_id = (state or {}).get("current_question_id")
    if question_id:
        _finalize_question_scores(client, game_id, question_id, (state or {}).get("special_player_id"))

    res = _upsert_game_state(
        client,
        game_id,
        {
            "game_id": game_id,
            "is_active": False,
            "game_over": True,
            "current_question_id": None,
            "round_started_at": None,
            "round_ends_at": None,
            "reveal_answers": False,
            "updated_at": now,
        },
    )
    _invalidate_game_caches(game_id)
    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


@router.get("/players", dependencies=[Depends(require_admin)])
def admin_players(game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    players = _response_data_list(
        client.table("players")
        .select("id, name, score, created_at")
        .eq("game_id", game_id)
        .order("score", desc=True)
        .execute()
    )
    return {"players": players}


@router.delete("/players/{player_id}", dependencies=[Depends(require_admin)])
def delete_player(player_id: str):
    client = get_supabase()
    player = _response_data_dict(
        client.table("players")
        .select("id, game_id")
        .eq("id", player_id)
        .maybe_single()
        .execute()
    )
    rows = _response_data_list(client.table("players").delete().eq("id", player_id).execute())
    if player and player.get("game_id"):
        _invalidate_game_caches(player["game_id"])
    cache_delete(f"players:by_id:{player_id}")
    return {"deleted": len(rows) > 0}


@router.post("/game/special-player", dependencies=[Depends(require_admin)])
def set_special_player(body: SetSpecialPlayerBody, game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    now = datetime.now(timezone.utc).isoformat()

    special_player_id = (body.special_player_id or "").strip() or None
    if special_player_id:
        player = _response_data_dict(
            client.table("players")
            .select("id")
            .eq("id", special_player_id)
            .eq("game_id", game_id)
            .maybe_single()
            .execute()
        )
        if not player:
            raise HTTPException(status_code=404, detail="Special player not found")

    res = _upsert_game_state(
        client,
        game_id,
        {
            "game_id": game_id,
            "special_player_id": special_player_id,
            "updated_at": now,
        },
    )
    _invalidate_game_caches(game_id)
    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


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
    image_url_raw = pick("image_url", "imageUrl")
    image_url = (str(image_url_raw).strip() if image_url_raw is not None else "")
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
        "image_url": image_url or None,
        "duration_seconds": duration_seconds,
    }

    res = client.table("quiz_questions").insert(payload).execute()
    created = _response_data_list(res)
    if not created:
        raise HTTPException(status_code=500, detail="Question creation failed")
    _invalidate_question_cache(created[0].get("id"))
    return created[0]

@router.get("/questions", dependencies=[Depends(require_admin)])
def list_questions():
    client = get_supabase()
    questions = _response_data_list(
        client.table("quiz_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, image_url, duration_seconds, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"questions": questions}


@router.post("/questions/{question_id}/update", dependencies=[Depends(require_admin)])
async def update_question(question_id: str, request: Request):
    client = get_supabase()

    existing = _response_data_dict(
        client.table("quiz_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, image_url, duration_seconds")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Question not found")

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

    prompt = (str(pick("prompt") if pick("prompt") is not None else existing.get("prompt") or "")).strip()
    option_a = (str(pick("option_a", "optionA") if pick("option_a", "optionA") is not None else existing.get("option_a") or "")).strip()
    option_b = (str(pick("option_b", "optionB") if pick("option_b", "optionB") is not None else existing.get("option_b") or "")).strip()
    option_c = (str(pick("option_c", "optionC") if pick("option_c", "optionC") is not None else existing.get("option_c") or "")).strip()
    option_d = (str(pick("option_d", "optionD") if pick("option_d", "optionD") is not None else existing.get("option_d") or "")).strip()

    correct_option_raw = pick("correct_option", "correctOption")
    if correct_option_raw is None:
        correct_option = existing.get("correct_option")
    else:
        correct_option = str(correct_option_raw).strip().upper() or None

    image_url_raw = pick("image_url", "imageUrl")
    if image_url_raw is None:
        image_url = existing.get("image_url")
    else:
        image_url = str(image_url_raw).strip() or None

    duration_raw = pick("duration_seconds", "durationSeconds")
    try:
        duration_seconds = int(duration_raw if duration_raw is not None else (existing.get("duration_seconds") or 30))
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

    updated_rows = _response_data_list(
        client.table("quiz_questions")
        .update(
            {
                "prompt": prompt,
                "option_a": option_a,
                "option_b": option_b,
                "option_c": option_c,
                "option_d": option_d,
                "correct_option": correct_option,
                "image_url": image_url,
                "duration_seconds": duration_seconds,
            }
        )
        .eq("id", question_id)
        .execute()
    )
    if not updated_rows:
        raise HTTPException(status_code=500, detail="Question update failed")
    _invalidate_question_cache(question_id)
    return updated_rows[0]


@router.post("/questions/{question_id}/image", dependencies=[Depends(require_admin)])
async def upload_question_image(question_id: str, image: UploadFile = File(...)):
    client = get_supabase()

    question = _response_data_dict(
        client.table("quiz_questions")
        .select("id")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    content_type = (image.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="Image file is empty")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be 8MB or smaller")

    original_name = image.filename or "image"
    extension_match = re.search(r"(\.[A-Za-z0-9]{1,8})$", original_name)
    extension = extension_match.group(1).lower() if extension_match else ""
    if not extension:
        extension = ".jpg" if content_type in {"image/jpeg", "image/jpg"} else ".png"

    bucket = _question_image_bucket()
    object_path = f"questions/{question_id}/{uuid4().hex}{extension}"

    try:
        client.storage.from_(bucket).upload(
            object_path,
            content,
            {"content-type": content_type, "upsert": "false"},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Image upload failed. Ensure Storage bucket '{bucket}' exists and is writable.",
        ) from exc

    image_url = _storage_public_url(client, bucket, object_path)

    updated_rows = _response_data_list(
        client.table("quiz_questions")
        .update({"image_url": image_url})
        .eq("id", question_id)
        .execute()
    )
    if not updated_rows:
        raise HTTPException(status_code=500, detail="Failed to attach image to question")

    _invalidate_question_cache(question_id)

    return {"image_url": image_url, "object_path": object_path}


@router.delete("/questions/{question_id}", dependencies=[Depends(require_admin)])
def delete_question(question_id: str, game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, is_active, reveal_answers")
        .eq("game_id", game_id)
        .maybe_single()
        .execute()
    )
    if (state or {}).get("current_question_id") == question_id:
        raise HTTPException(status_code=409, detail="Cannot delete the current round question")

    rows = _response_data_list(client.table("quiz_questions").delete().eq("id", question_id).execute())
    _invalidate_question_cache(question_id)
    return {"deleted": len(rows) > 0}


@router.post("/questions/activate", dependencies=[Depends(require_admin)])
async def activate_question(request: Request, game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None

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

    # Mark this question as activated in game_questions
    now = datetime.now(timezone.utc)
    client.table("game_questions").update({"activated_at": now.isoformat()}).eq("game_id", game_id).eq("question_id", question_id).execute()

    ends_at = now + timedelta(seconds=duration_seconds)
    res = _upsert_game_state(
        client,
        game_id,
        {
            "game_id": game_id,
            "is_active": True,
            "game_over": False,
            "current_question_id": question_id,
            "round_started_at": now.isoformat(),
            "round_ends_at": ends_at.isoformat(),
            "reveal_answers": False,
            "updated_at": now.isoformat(),
        },
    )
    _invalidate_game_caches(game_id)
    _invalidate_question_cache(question_id)
    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


@router.post("/questions/reveal", dependencies=[Depends(require_admin)])
async def reveal_answers(request: Request, game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
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
            .eq("game_id", game_id)
            .maybe_single()
            .execute()
        )
        question_id = (state or {}).get("current_question_id")
        if not question_id:
            raise HTTPException(status_code=409, detail="Cannot reveal without an active question")

        _finalize_question_scores(client, game_id, question_id, (state or {}).get("special_player_id"))

        res = _update_game_state(
            client,
            game_id,
            {
                "reveal_answers": True,
                "is_active": False,
                "current_question_id": question_id,
                "round_ends_at": now,
                "updated_at": now,
            },
        )
    else:
        res = _update_game_state(client, game_id, {"reveal_answers": False, "updated_at": now})

    _invalidate_game_caches(game_id)

    return _get_state_with_phase(client, game_id) or (res.data[0] if res.data else {"ok": True})


@router.get("/answers/current", dependencies=[Depends(require_admin)])
def current_answers(game_id: Optional[str] = None):
    client = get_supabase()
    
    if not game_id:
        # Get active game
        games = _response_data_list(
            client.table("games")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if not games:
            raise HTTPException(status_code=400, detail="No active game available")
        game_id = games[0]["id"]
    assert game_id is not None
    
    state = _response_data_dict(
        client.table("game_state")
        .select("current_question_id, special_player_id")
        .eq("game_id", game_id)
        .maybe_single()
        .execute()
    )
    question_id = (state or {}).get("current_question_id")
    if not question_id:
        return {"answers": []}

    answers = _response_data_list(
        client.table("player_answers")
        .select("id, player_id, selected_option, is_correct, points_awarded, answered_at")
        .eq("game_id", game_id)
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
