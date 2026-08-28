from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping


class GroupHandoffError(ValueError):
    """Raised when a browser handoff is not a valid Contract V2 envelope."""


@dataclass(frozen=True, slots=True)
class GroupHandoff:
    contract_version: str
    authority: str
    handoff_type: str
    handoff_id: str
    generation: str
    surface: str
    mode: str
    session_token: str
    session_id: str
    room_id: str
    participant_id: str
    workspace_id: str
    issuer: str
    audience: str
    source_language: str
    target_language: str
    expires_at: str
    runtime_url: str
    websocket_url: str


_REQUIRED = (
    "contract_version",
    "authority",
    "handoff_type",
    "handoff_id",
    "generation",
    "surface",
    "mode",
    "session_token",
    "session_id",
    "room_id",
    "participant_id",
    "workspace_id",
    "issuer",
    "audience",
    "source_language",
    "target_language",
    "expires_at",
    "runtime_url",
    "websocket_url",
)


def _text(payload: Mapping[str, object], key: str, *, maximum: int = 4096) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupHandoffError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupHandoffError(f"invalid_{key}")
    return value


def _expires_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GroupHandoffError("invalid_expires_at") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise GroupHandoffError("handoff_expired")
    return value


def parse_group_handoff(payload: Mapping[str, object]) -> GroupHandoff:
    """Validate, but never persist, a Timeblock Group Call/Video handoff."""

    if not isinstance(payload, Mapping):
        raise GroupHandoffError("invalid_handoff")
    values = {key: _text(payload, key) for key in _REQUIRED}
    if values["contract_version"] != "2" or values["authority"] != "timeblock":
        raise GroupHandoffError("contract_mismatch")
    if values["handoff_type"] != "group":
        raise GroupHandoffError("handoff_type_mismatch")
    if values["surface"] not in {"group_call", "group_video"}:
        raise GroupHandoffError("invalid_surface")
    expected_mode = "video" if values["surface"] == "group_video" else "audio"
    if values["mode"] != expected_mode:
        raise GroupHandoffError("mode_mismatch")
    if not values["session_id"].startswith("group:"):
        raise GroupHandoffError("invalid_session_id")
    if not values["room_id"].startswith("group-call:"):
        raise GroupHandoffError("invalid_room_id")
    if not values["participant_id"].startswith(("member:", "business:")):
        raise GroupHandoffError("invalid_participant_id")
    if not values["workspace_id"].startswith("conversation:"):
        raise GroupHandoffError("invalid_workspace_id")
    if not values["websocket_url"].startswith(("ws://", "wss://")):
        raise GroupHandoffError("invalid_websocket_url")
    if values["session_token"] in values["websocket_url"]:
        raise GroupHandoffError("secret_in_url")
    values["expires_at"] = _expires_at(values["expires_at"])
    return GroupHandoff(**values)
