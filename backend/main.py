import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routes import admin, encounters, loot, players

load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI(title="Birthday Syndicate Pub Quiz API", version="0.2.0")

origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router)
app.include_router(encounters.router)
app.include_router(loot.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {"service": "birthday-syndicate-pub-quiz-api", "ok": True, "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True}
