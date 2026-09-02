from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping
from urllib.parse import urlparse

from app.core.config import Settings


class GroupHandoffV3Error(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class GroupHandoffV3:
    handoff_id: str
    surface: str
    source_origin: str
    target_origin: str
    principal: dict[str, str]
    launch_authorized: bool
    issued_at: str
    expires_at: str
    session_expires_at: str


def _text(value: object, field: str, *, maximum: int = 256) -> str:
    normalized = str(value or "").strip()
    if not normalized or len(normalized) > maximum:
        raise GroupHandoffV3Error(f"invalid_{field}")
    return normalized


def _future(value: object, field: str) -> str:
    text = _text(value, field, maximum=64)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GroupHandoffV3Error(f"invalid_{field}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise GroupHandoffV3Error(f"expired_{field}")
    return text


def _public_origin(settings: Settings) -> str:
    parsed = urlparse(settings.public_base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise GroupHandoffV3Error("invalid_target_origin")
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def parse_group_handoff_v3(
    payload: Mapping[str, object],
    settings: Settings,
) -> GroupHandoffV3:
    """Validate only Timeblock identity and transport claims.

    Group scopes, memberships, entitlement, quota and durable data are
    intentionally not accepted from Timeblock. They are AI-owned.
    """

    if str(payload.get("contract_version") or "") != "3":
        raise GroupHandoffV3Error("invalid_contract_version")
    if str(payload.get("authority") or "") not in {"timeblock", "timeblock-identity"}:
        raise GroupHandoffV3Error("invalid_authority")
    if str(payload.get("group_authority") or "ai-communication") != "ai-communication":
        raise GroupHandoffV3Error("invalid_group_authority")
    if str(payload.get("issuer") or "") != "timeblock":
        raise GroupHandoffV3Error("invalid_issuer")
    if str(payload.get("audience") or "") != settings.group_handoff_audience:
        raise GroupHandoffV3Error("invalid_audience")
    if payload.get("launch_authorized", True) is not True:
        raise GroupHandoffV3Error("group_launch_denied")

    handoff_id = _text(payload.get("handoff_id"), "handoff_id", maximum=128)
    # Timeblock is an identity/control-plane issuer and deliberately does not
    # select a Group capability.  The AI-owned application chooses the
    # initial Group surface after the generic handoff is redeemed.
    surface = "chat"
    source_origin = _text(
        payload.get("source_origin"), "source_origin", maximum=2048
    ).rstrip("/")
    if source_origin not in settings.timeblock_handoff_origins:
        raise GroupHandoffV3Error("invalid_source_origin")
    target_origin = _text(
        payload.get("target_origin"), "target_origin", maximum=2048
    ).rstrip("/")
    if target_origin != _public_origin(settings):
        raise GroupHandoffV3Error("invalid_target_origin")

    principal_value = payload.get("principal")
    if not isinstance(principal_value, Mapping):
        raise GroupHandoffV3Error("invalid_principal")
    principal_type = _text(
        principal_value.get("type"), "principal_type", maximum=16
    ).lower()
    if principal_type not in {"member", "business"}:
        raise GroupHandoffV3Error("invalid_principal_type")
    principal = {
        "type": principal_type,
        "id": _text(principal_value.get("id"), "principal_id", maximum=128),
        "user_id": _text(
            principal_value.get("user_id"), "principal_user_id", maximum=128
        ),
        "display_name": _text(
            principal_value.get("display_name"), "display_name", maximum=120
        ),
        "locale": _text(principal_value.get("locale"), "locale", maximum=8),
    }
    if principal["locale"] not in {"vi", "en", "zh-TW"}:
        raise GroupHandoffV3Error("invalid_locale")

    return GroupHandoffV3(
        handoff_id=handoff_id,
        surface=surface,
        source_origin=source_origin,
        target_origin=target_origin,
        principal=principal,
        launch_authorized=True,
        issued_at=_text(payload.get("issued_at"), "issued_at", maximum=64),
        expires_at=_future(payload.get("expires_at"), "expires_at"),
        session_expires_at=_future(
            payload.get("session_expires_at"), "session_expires_at"
        ),
    )
