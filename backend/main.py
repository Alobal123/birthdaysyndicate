import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routes import admin, encounters, games, loot, players

load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI(title="Birthday Syndicate Pub Quiz API", version="0.2.0")

origins_env = os.getenv("CORS_ORIGINS", "").strip()
if origins_env:
    origins = [origin.strip() for origin in origins_env.split(",") if origin.strip()]
else:
    # Safe default for initial deploys: allow browser access from any origin.
    origins = ["*"]

allow_credentials = "*" not in origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router)
app.include_router(games.router)
app.include_router(encounters.router)
app.include_router(loot.router)
app.include_router(admin.router)

# Ensure default game exists on startup
@app.on_event("startup")
async def startup_event():
    from routes.games import ensure_default_game
    ensure_default_game()


@app.get("/")
def root():
    return {"service": "birthday-syndicate-pub-quiz-api", "ok": True, "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True}
