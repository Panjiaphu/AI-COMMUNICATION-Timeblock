from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SessionStatus(StrEnum):
    REQUESTED = 'requested'
    AUTHORIZED = 'authorized'
    CREATED = 'created'
    CONNECTING = 'connecting'
    ACTIVE = 'active'
    RECONNECTING = 'reconnecting'
    DEGRADED = 'degraded'
    ENDING = 'ending'
    ENDED = 'ended'
    FAILED = 'failed'
    EXPIRED = 'expired'


class EventName(StrEnum):
    HEARTBEAT = 'connection.heartbeat'
    SESSION_JOIN = 'session.join'
    SESSION_LEAVE = 'session.leave'
    SIGNALING_OFFER = 'signaling.offer'
    SIGNALING_ANSWER = 'signaling.answer'
    SIGNALING_ICE = 'signaling.ice_candidate'
    MEDIA_MUTED = 'media.muted'
    MEDIA_UNMUTED = 'media.unmuted'
    CAMERA_ENABLED = 'media.camera_enabled'
    CAMERA_DISABLED = 'media.camera_disabled'
    SESSION_ENDING = 'session.ending'
    SESSION_ENDED = 'session.ended'


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')


class EmptyPayload(StrictPayload):
    pass


class HeartbeatPayload(StrictPayload):
    client_timestamp: datetime | None = None


class SignalingOfferPayload(StrictPayload):
    target_participant_id: str = Field(min_length=1, max_length=128)
    sdp_type: Literal['offer'] = 'offer'
    sdp: str = Field(min_length=1, max_length=100_000)


class SignalingAnswerPayload(StrictPayload):
    target_participant_id: str = Field(min_length=1, max_length=128)
    sdp_type: Literal['answer'] = 'answer'
    sdp: str = Field(min_length=1, max_length=100_000)


class IceCandidatePayload(StrictPayload):
    target_participant_id: str = Field(min_length=1, max_length=128)
    candidate: str = Field(min_length=1, max_length=4096)
    sdp_mid: str | None = Field(default=None, max_length=128)
    sdp_mline_index: int | None = Field(default=None, ge=0, le=1024)
    username_fragment: str | None = Field(default=None, max_length=256)


class MediaStatePayload(StrictPayload):
    enabled: bool


PAYLOAD_MODELS = {
    EventName.HEARTBEAT: HeartbeatPayload,
    EventName.SESSION_JOIN: EmptyPayload,
    EventName.SESSION_LEAVE: EmptyPayload,
    EventName.SIGNALING_OFFER: SignalingOfferPayload,
    EventName.SIGNALING_ANSWER: SignalingAnswerPayload,
    EventName.SIGNALING_ICE: IceCandidatePayload,
    EventName.MEDIA_MUTED: MediaStatePayload,
    EventName.MEDIA_UNMUTED: MediaStatePayload,
    EventName.CAMERA_ENABLED: MediaStatePayload,
    EventName.CAMERA_DISABLED: MediaStatePayload,
    EventName.SESSION_ENDING: EmptyPayload,
    EventName.SESSION_ENDED: EmptyPayload,
}


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra='forbid')

    event_name: EventName
    event_version: Literal[1] = 1
    event_id: UUID
    session_id: str = Field(min_length=1, max_length=128)
    participant_id: str = Field(min_length=1, max_length=128)
    connection_id: str = Field(min_length=1, max_length=128)
    sequence_number: int = Field(ge=1)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    trace_id: str = Field(min_length=1, max_length=128)
    payload: dict = Field(default_factory=dict)

    @model_validator(mode='after')
    def validate_payload(self):
        PAYLOAD_MODELS[self.event_name].model_validate(self.payload)
        return self

    def typed_payload(self) -> StrictPayload:
        return PAYLOAD_MODELS[self.event_name].model_validate(self.payload)


class AuthorizedSession(BaseModel):
    session_id: str
    room_id: str
    workspace_id: str
    participant_id: str
    mode: Literal['audio', 'video'] = 'video'
    source_language: str = Field(default='vi', min_length=2, max_length=16)
    target_language: str = Field(default='zh-TW', min_length=2, max_length=16)


class RoomSnapshot(BaseModel):
    session_id: str
    room_id: str
    workspace_id: str
    status: SessionStatus
    mode: Literal['audio', 'video']
    source_language: str
    target_language: str
    participants: list[str]
    trace_id: str
