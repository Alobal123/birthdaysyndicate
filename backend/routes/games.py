from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException

from database import get_admin_secret, get_supabase
from in_memory_cache import cache_delete, cache_delete_prefix
from models import AddGameQuestionBody, CreateGameBody, ReorderGameQuestionsBody

router = APIRouter(prefix="/api", tags=["games"])


def _invalidate_game_caches(game_id: str | None = None):
    cache_delete("players:active_game")
    if game_id:
        cache_delete(f"players:leaderboard:{game_id}")
        cache_delete(f"quiz:state:{game_id}")
        cache_delete(f"quiz:game_state:{game_id}")
        cache_delete_prefix(f"quiz:player_answer:{game_id}:")


def _response_data_dict(response) -> dict[str, Any] | None:
    data = getattr(response, "data", None)
    return data if isinstance(data, dict) else None


def _response_data_list(response) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _verify_admin(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization[7:]
    expected = get_admin_secret()
    if not expected or token != expected:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return token


@router.get("/admin/games")
def get_games(authorization: str = Header(None)):
    _verify_admin(authorization)
    client = get_supabase()
    try:
        games = _response_data_list(
            client.table("games")
            .select("id, name, status, created_at, closed_at")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Games service unavailable") from exc
    return {"games": games}


@router.post("/admin/games")
def create_game(body: CreateGameBody, authorization: str = Header(None)):
    _verify_admin(authorization)
    client = get_supabase()
    normalized_name = body.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Game name cannot be empty")

    try:
        created = _response_data_list(
            client.table("games")
            .insert({"name": normalized_name, "status": "active"})
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Games service unavailable") from exc

    if not created:
        raise HTTPException(status_code=500, detail="Game creation failed")
    
    game = created[0]
    
    # Create game_state for this new game
    try:
        client.table("game_state").insert({
            "game_id": game["id"],
            "is_active": False,
            "game_over": False,
            "reveal_answers": False
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to initialize game state") from exc

    _invalidate_game_caches(game["id"])
    
    return game


@router.post("/admin/games/{game_id}/end")
def end_game(game_id: str, authorization: str = Header(None)):
    _verify_admin(authorization)
    try:
        UUID(game_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game id")

    client = get_supabase()
    try:
        updated = _response_data_list(
            client.table("games")
            .update({"status": "closed", "closed_at": "now()"})
            .eq("id", game_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Games service unavailable") from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Game not found")
    _invalidate_game_caches(game_id)
    return updated[0]


@router.get("/admin/games/{game_id}/questions")
def get_game_questions(game_id: str, authorization: str = Header(None)):
    _verify_admin(authorization)
    try:
        UUID(game_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game id")

    client = get_supabase()
    try:
        # Get game questions with full question details
        questions = _response_data_list(
            client.table("game_questions")
            .select("""
                id,
                game_id,
                question_id,
                question_order,
                activated_at,
                quiz_questions:question_id(
                    id,
                    prompt,
                    option_a,
                    option_b,
                    option_c,
                    option_d,
                    correct_option,
                    duration_seconds,
                    image_url
                )
            """)
            .eq("game_id", game_id)
            .order("question_order", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Questions service unavailable") from exc
    
    return {"questions": questions}


@router.post("/admin/games/{game_id}/questions")
def add_game_question(game_id: str, body: AddGameQuestionBody, authorization: str = Header(None)):
    _verify_admin(authorization)
    try:
        UUID(game_id)
        UUID(body.question_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game id or question id")

    client = get_supabase()
    
    # Get the next question order if not specified
    question_order = body.question_order
    if question_order is None:
        try:
            existing = _response_data_list(
                client.table("game_questions")
                .select("question_order")
                .eq("game_id", game_id)
                .order("question_order", desc=True)
                .limit(1)
                .execute()
            )
            question_order = (existing[0]["question_order"] + 1) if existing else 1
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Questions service unavailable") from exc
    
    try:
        created = _response_data_list(
            client.table("game_questions")
            .insert({
                "game_id": game_id,
                "question_id": body.question_id,
                "question_order": question_order
            })
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to add question to game") from exc

    if not created:
        raise HTTPException(status_code=500, detail="Failed to add question to game")
    return created[0]


@router.delete("/admin/games/{game_id}/questions/{question_id}")
def remove_game_question(game_id: str, question_id: str, authorization: str = Header(None)):
    _verify_admin(authorization)
    try:
        UUID(game_id)
        UUID(question_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game id or question id")

    client = get_supabase()
    try:
        deleted = _response_data_list(
            client.table("game_questions")
            .delete()
            .eq("game_id", game_id)
            .eq("question_id", question_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Questions service unavailable") from exc

    if not deleted:
        raise HTTPException(status_code=404, detail="Game question not found")
    return {"message": "Question removed from game"}


@router.put("/admin/games/{game_id}/questions/{question_id}/reorder")
def reorder_game_question(
    game_id: str, 
    question_id: str, 
    body: ReorderGameQuestionsBody,
    authorization: str = Header(None)
):
    _verify_admin(authorization)
    try:
        UUID(game_id)
        UUID(question_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game id or question id")

    client = get_supabase()
    try:
        updated = _response_data_list(
            client.table("game_questions")
            .update({"question_order": body.question_order})
            .eq("game_id", game_id)
            .eq("question_id", question_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Questions service unavailable") from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Game question not found")
    return updated[0]


def ensure_default_game():
    """Auto-create a default game if none exists"""
    client = get_supabase()
    try:
        games = _response_data_list(
            client.table("games")
            .select("id")
            .execute()
        )
        if not games:
            # Create default game
            created = _response_data_list(
                client.table("games")
                .insert({"name": "Default Game", "status": "active"})
                .execute()
            )
            if created:
                # Create game_state for default game
                try:
                    client.table("game_state").insert({
                        "game_id": created[0]["id"],
                        "is_active": False,
                        "game_over": False,
                        "reveal_answers": False
                    }).execute()
                    _invalidate_game_caches(created[0]["id"])
                except Exception:
                    pass  # Silently fail if game_state already exists
    except Exception:
        pass  # Silently fail - this is just initialization
