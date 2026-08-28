"""Group Video session state and cleanup contract.

This module deliberately has no media, WebRTC, SFU, or provider dependency.
It gives the future runtime one deterministic state machine and one
idempotency identity while the P4 provider gate remains closed.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum


class GroupVideoSessionError(ValueError):
    """Raised when a Group Video session violates the P6 contract."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class GroupVideoState(str, Enum):
    """User-visible lifecycle states owned by the provider-neutral runtime."""

    INVITED = "invited"
    RINGING = "ringing"
    JOINING = "joining"
    JOIN_FAILED = "join_failed"
    JOINED = "joined"
    RECONNECTING = "reconnecting"
    LEAVING = "leaving"
    ENDED = "ended"


_ALLOWED_TRANSITIONS: dict[GroupVideoState, frozenset[GroupVideoState]] = {
    GroupVideoState.INVITED: frozenset(
        {GroupVideoState.RINGING, GroupVideoState.ENDED}
    ),
    GroupVideoState.RINGING: frozenset(
        {GroupVideoState.JOINING, GroupVideoState.ENDED}
    ),
    GroupVideoState.JOINING: frozenset(
        {
            GroupVideoState.JOINED,
            GroupVideoState.JOIN_FAILED,
            GroupVideoState.ENDED,
        }
    ),
    GroupVideoState.JOIN_FAILED: frozenset(
        {GroupVideoState.JOINING, GroupVideoState.ENDED}
    ),
    GroupVideoState.JOINED: frozenset(
        {
            GroupVideoState.RECONNECTING,
            GroupVideoState.LEAVING,
            GroupVideoState.ENDED,
        }
    ),
    GroupVideoState.RECONNECTING: frozenset(
        {
            GroupVideoState.JOINED,
            GroupVideoState.JOIN_FAILED,
            GroupVideoState.LEAVING,
            GroupVideoState.ENDED,
        }
    ),
    GroupVideoState.LEAVING: frozenset({GroupVideoState.ENDED}),
    GroupVideoState.ENDED: frozenset(),
}

_MEDIA_ALLOWED_STATES = frozenset(
    {
        GroupVideoState.JOINING,
        GroupVideoState.JOINED,
        GroupVideoState.RECONNECTING,
    }
)


def _state(value: GroupVideoState | str) -> GroupVideoState:
    if isinstance(value, GroupVideoState):
        return value
    if isinstance(value, str):
        try:
            return GroupVideoState(value)
        except ValueError as exc:
            raise GroupVideoSessionError("invalid_group_video_state") from exc
    raise GroupVideoSessionError("invalid_group_video_state")


def _identity(value: str, code: str, *, prefix: str | None = None) -> str:
    if not isinstance(value, str):
        raise GroupVideoSessionError(code)
    value = value.strip()
    if not value or len(value) > 128:
        raise GroupVideoSessionError(code)
    if prefix is not None and not value.startswith(prefix):
        raise GroupVideoSessionError(code)
    return value


@dataclass(frozen=True, slots=True)
class GroupVideoSession:
    """The minimal state needed for safe local/provider cleanup.

    ``application_room_id`` is the Timeblock authorization anchor. A future
    provider session identifier must never replace it as the access boundary.
    """

    session_id: str
    application_room_id: str
    participant_id: str
    generation: str
    state: GroupVideoState = GroupVideoState.INVITED
    media_acquired: bool = False

    def __post_init__(self) -> None:
        session_id = _identity(self.session_id, "invalid_session_id")
        room_id = _identity(
            self.application_room_id,
            "invalid_application_room_id",
            prefix="group-call:",
        )
        participant_id = _identity(self.participant_id, "invalid_participant_id")
        if not (
            participant_id.startswith("member:")
            or participant_id.startswith("business:")
        ):
            raise GroupVideoSessionError("invalid_participant_id")
        generation = _identity(self.generation, "invalid_generation")
        state = _state(self.state)
        if not isinstance(self.media_acquired, bool):
            raise GroupVideoSessionError("invalid_media_flag")
        if state not in _MEDIA_ALLOWED_STATES and self.media_acquired:
            raise GroupVideoSessionError("media_forbidden_in_state")
        object.__setattr__(self, "session_id", session_id)
        object.__setattr__(self, "application_room_id", room_id)
        object.__setattr__(self, "participant_id", participant_id)
        object.__setattr__(self, "generation", generation)
        object.__setattr__(self, "state", state)


def can_acquire_group_video_media(state: GroupVideoState | str) -> bool:
    """Return whether camera/microphone acquisition is allowed by lifecycle."""

    return _state(state) in _MEDIA_ALLOWED_STATES


def apply_group_video_state(
    session: GroupVideoSession,
    next_state: GroupVideoState | str,
) -> GroupVideoSession:
    """Apply one legal transition and clear local media on terminal paths."""

    if not isinstance(session, GroupVideoSession):
        raise GroupVideoSessionError("invalid_group_video_session")
    current = _state(session.state)
    target = _state(next_state)
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise GroupVideoSessionError(
            f"invalid_transition:{current.value}->{target.value}"
        )
    if target is GroupVideoState.JOINED and not session.media_acquired:
        raise GroupVideoSessionError("media_required_before_joined")
    return replace(
        session,
        state=target,
        media_acquired=(session.media_acquired and target in _MEDIA_ALLOWED_STATES),
    )


def acquire_group_video_media(session: GroupVideoSession) -> GroupVideoSession:
    """Mark local media acquired only after the join intent reaches JOINING."""

    if not isinstance(session, GroupVideoSession):
        raise GroupVideoSessionError("invalid_group_video_session")
    if not can_acquire_group_video_media(session.state):
        raise GroupVideoSessionError("media_forbidden_in_state")
    return replace(session, media_acquired=True)


def release_group_video_media(session: GroupVideoSession) -> GroupVideoSession:
    """Idempotently mark local media released during any cleanup path."""

    if not isinstance(session, GroupVideoSession):
        raise GroupVideoSessionError("invalid_group_video_session")
    if not session.media_acquired:
        return session
    return replace(session, media_acquired=False)


def group_video_request_key(
    application_room_id: str,
    participant_id: str,
    generation: str,
) -> str:
    """Build an idempotency key scoped to room, participant, and join attempt."""

    room_id = _identity(
        application_room_id,
        "invalid_application_room_id",
        prefix="group-call:",
    )
    participant = _identity(participant_id, "invalid_participant_id")
    if not (
        participant.startswith("member:") or participant.startswith("business:")
    ):
        raise GroupVideoSessionError("invalid_participant_id")
    attempt = _identity(generation, "invalid_generation")
    return f"group-video:{room_id}:{participant}:{attempt}"
