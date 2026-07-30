from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EventEnvelope(BaseModel):
    event_name: str = Field(min_length=1, max_length=80)
    event_version: int = Field(default=1, ge=1)
    event_id: UUID
    session_id: str = Field(min_length=1, max_length=128)
    participant_id: str = Field(min_length=1, max_length=128)
    connection_id: str = Field(min_length=1, max_length=128)
    sequence_number: int = Field(ge=1)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    trace_id: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)


class AuthorizedSession(BaseModel):
    session_id: str
    room_id: str
    workspace_id: str
    participant_id: str
    mode: Literal["audio", "video"] = "video"
    source_language: str = "vi"
    target_language: str = "zh-TW"


class RoomSnapshot(BaseModel):
    session_id: str
    room_id: str
    participants: list[str]
    status: str
