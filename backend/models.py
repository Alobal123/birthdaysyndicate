from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class AnswerOption(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class RoundPhase(str, Enum):
    IDLE = "IDLE"
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    REVEAL = "REVEAL"


class CreatePlayerBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class SubmitAnswerBody(BaseModel):
    player_id: str
    option: AnswerOption


class CreateQuestionBody(BaseModel):
    prompt: str = Field(min_length=5, max_length=500)
    option_a: str = Field(min_length=1, max_length=200)
    option_b: str = Field(min_length=1, max_length=200)
    option_c: str = Field(min_length=1, max_length=200)
    option_d: str = Field(min_length=1, max_length=200)
    correct_option: AnswerOption
    category: Optional[str] = Field(default=None, max_length=80)


class ActivateQuestionBody(BaseModel):
    question_id: str
    duration_seconds: int = Field(default=30, ge=5, le=600)


class RevealAnswersBody(BaseModel):
    reveal: bool = True
