from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Choice(str, Enum):
    ALLIANCE = "ALLIANCE"
    CUT = "CUT"
    HEIST = "HEIST"


class EncounterStatus(str, Enum):
    PENDING = "PENDING"
    LOCKED = "LOCKED"
    COMPLETED = "COMPLETED"
    CANCELED = "CANCELED"


class CreatePlayerBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class CreateEncounterBody(BaseModel):
    p1_id: str


class JoinEncounterBody(BaseModel):
    player_id: str


class SubmitChoiceBody(BaseModel):
    player_id: str
    choice: Choice
    item: Optional[str] = None


class ClaimLootBody(BaseModel):
    player_id: str
    token: str


class AdminGenerateLootBody(BaseModel):
    item_type: str = Field(min_length=1, max_length=100)
    count: int = Field(ge=1, le=500)
