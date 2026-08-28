"""Provider-neutral Group Audio readiness contract.

Timeblock remains the authorization/data authority. AI-COMMUNICATION may
parse this manifest before a future provider-backed media session, but this
module deliberately does not import an SFU SDK or acquire browser media.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Mapping


GROUP_CALL_MEDIA_PROVIDER_REQUIRED = "GROUP_CALL_MEDIA_PROVIDER_REQUIRED"
GROUP_CALL_MEDIA_PROVIDER_CONTRACT_VERSION = "1"
SUPPORTED_MEDIA_MODES = frozenset({"audio", "video"})
REQUIRED_TOKEN_TRANSPORT = "server_memory_only"
REQUIRED_AUTHORIZATION = "timeblock_membership"
_STATES = frozenset({"gated", "ready"})
LIVEKIT_PROVIDER = "livekit-cloud"
_PARTICIPANT_RE = re.compile(r"^(member|business):[A-Za-z0-9_-]{1,128}$")


class GroupMediaProviderContractError(ValueError):
    """Raised when the Timeblock provider manifest is unsafe or incomplete."""


@dataclass(frozen=True, slots=True)
class GroupMediaSession:
    """Ephemeral provider session received from Timeblock in memory only."""

    provider: str
    provider_room_id: str
    server_url: str
    participant_id: str
    token: str
    expires_at: str
    room_expires_at: str
    media: str
    region: str
    max_participants: int
    token_ttl_seconds: int


def _session_text(payload: Mapping[str, object], key: str, *, maximum: int = 4096) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupMediaProviderContractError(f"missing_session_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupMediaProviderContractError(f"invalid_session_{key}")
    return value


def _future_iso(value: str, key: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GroupMediaProviderContractError(f"invalid_session_{key}") from exc
    if parsed.tzinfo is None or parsed <= datetime.now(timezone.utc):
        raise GroupMediaProviderContractError(f"expired_session_{key}")
    return value


def parse_group_media_session(payload: Mapping[str, object]) -> GroupMediaSession:
    """Validate the exact server response before a future LiveKit client uses it."""

    if not isinstance(payload, Mapping):
        raise GroupMediaProviderContractError("invalid_media_session")
    session = payload.get("session")
    if not isinstance(session, Mapping):
        raise GroupMediaProviderContractError("missing_media_session")
    provider = _session_text(session, "provider", maximum=64)
    if provider != LIVEKIT_PROVIDER:
        raise GroupMediaProviderContractError("unapproved_media_provider")
    provider_room_id = _session_text(session, "provider_room_id", maximum=128)
    server_url = _session_text(session, "server_url", maximum=512)
    if not server_url.startswith(("wss://", "ws://")):
        raise GroupMediaProviderContractError("invalid_session_server_url")
    participant_id = _session_text(session, "participant_id", maximum=160)
    if not _PARTICIPANT_RE.fullmatch(participant_id):
        raise GroupMediaProviderContractError("invalid_session_participant_id")
    token = _session_text(session, "token")
    expires_at = _future_iso(_session_text(session, "expires_at", maximum=128), "expires_at")
    room_expires_at = _future_iso(_session_text(session, "room_expires_at", maximum=128), "room_expires_at")
    media = _session_text(session, "media", maximum=16)
    if media not in SUPPORTED_MEDIA_MODES:
        raise GroupMediaProviderContractError("invalid_session_media")
    region = _session_text(session, "region", maximum=64)
    if region != "Singapore":
        raise GroupMediaProviderContractError("invalid_session_region")
    limits = session.get("limits")
    if not isinstance(limits, Mapping):
        raise GroupMediaProviderContractError("missing_session_limits")
    try:
        max_participants = int(limits.get("max_participants"))
        token_ttl_seconds = int(limits.get("token_ttl_seconds"))
        room_ttl_seconds = int(limits.get("room_ttl_seconds"))
    except (TypeError, ValueError) as exc:
        raise GroupMediaProviderContractError("invalid_session_limits") from exc
    if max_participants != 8 or token_ttl_seconds != 300 or room_ttl_seconds != 3600:
        raise GroupMediaProviderContractError("invalid_session_limits")
    if session.get("recording") is not False or session.get("raw_media_storage") is not False:
        raise GroupMediaProviderContractError("media_storage_policy_violation")
    return GroupMediaSession(
        provider=provider,
        provider_room_id=provider_room_id,
        server_url=server_url,
        participant_id=participant_id,
        token=token,
        expires_at=expires_at,
        room_expires_at=room_expires_at,
        media=media,
        region=region,
        max_participants=max_participants,
        token_ttl_seconds=token_ttl_seconds,
    )


@dataclass(frozen=True, slots=True)
class GroupMediaProviderContract:
    contract_version: str
    state: str
    provider: str
    error_code: str | None
    media_modes: tuple[str, ...]
    token_transport: str
    authorization: str

    @property
    def ready(self) -> bool:
        return self.state == "ready" and self.error_code is None


def _text(payload: Mapping[str, object], key: str, *, maximum: int = 128) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupMediaProviderContractError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupMediaProviderContractError(f"invalid_{key}")
    return value


def parse_group_media_provider_contract(
    payload: Mapping[str, object],
) -> GroupMediaProviderContract:
    """Validate a capability manifest without trusting provider identifiers."""

    if not isinstance(payload, Mapping):
        raise GroupMediaProviderContractError("invalid_media_provider_contract")
    version = _text(payload, "contract_version")
    if version != GROUP_CALL_MEDIA_PROVIDER_CONTRACT_VERSION:
        raise GroupMediaProviderContractError("media_provider_contract_mismatch")
    state = _text(payload, "state")
    if state not in _STATES:
        raise GroupMediaProviderContractError("invalid_media_provider_state")
    provider = _text(payload, "provider")
    token_transport = _text(payload, "token_transport")
    if token_transport != REQUIRED_TOKEN_TRANSPORT:
        raise GroupMediaProviderContractError("invalid_media_provider_token_transport")
    authorization = _text(payload, "authorization")
    if authorization != REQUIRED_AUTHORIZATION:
        raise GroupMediaProviderContractError("invalid_media_provider_authorization")
    modes = payload.get("media_modes")
    if not isinstance(modes, (list, tuple)) or not modes:
        raise GroupMediaProviderContractError("invalid_media_provider_modes")
    normalized_modes = tuple(str(item) for item in modes)
    if (
        len(set(normalized_modes)) != len(normalized_modes)
        or any(item not in SUPPORTED_MEDIA_MODES for item in normalized_modes)
    ):
        raise GroupMediaProviderContractError("invalid_media_provider_modes")
    error_code = payload.get("error_code")
    if error_code is not None and (
        not isinstance(error_code, str) or not error_code.strip()
    ):
        raise GroupMediaProviderContractError("invalid_media_provider_error_code")
    if state == "gated" and error_code != GROUP_CALL_MEDIA_PROVIDER_REQUIRED:
        raise GroupMediaProviderContractError("gated_media_provider_error_code_required")
    if state == "ready" and error_code is not None:
        raise GroupMediaProviderContractError("ready_media_provider_has_error")
    return GroupMediaProviderContract(
        contract_version=version,
        state=state,
        provider=provider,
        error_code=error_code,
        media_modes=normalized_modes,
        token_transport=token_transport,
        authorization=authorization,
    )


def require_ready_group_media_provider(
    payload: Mapping[str, object],
) -> GroupMediaProviderContract:
    """Fail closed until an owner-approved provider is advertised as ready."""

    contract = parse_group_media_provider_contract(payload)
    if not contract.ready:
        raise GroupMediaProviderContractError(
            contract.error_code or GROUP_CALL_MEDIA_PROVIDER_REQUIRED
        )
    return contract
