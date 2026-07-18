from fastapi import APIRouter

from database import get_supabase

router = APIRouter(prefix="/api", tags=["questions"])


@router.get("/questions")
def list_questions():
    client = get_supabase()
    rows = (
        client.table("quiz_questions")
        .select("id, prompt, option_a, option_b, option_c, option_d, category, created_at")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return {"questions": rows or []}
