from __future__ import annotations

from typing import Any
from uuid import uuid4


AI_GROUP_SCOPES = (
    "group.spaces.read",
    "group.spaces.write",
    "group.messages.read",
    "group.messages.write",
    "group.media.use",
    "group.translation.use",
    "group.radio.use",
)


def ai_group_entitlement(principal: dict[str, Any]) -> dict[str, object]:
    return {
        "group_communication": True,
        "authorization_authority": "ai-communication",
        "billing_subject": (
            f"{principal.get('type', '')}:{principal.get('id', '')}:"
            f"{principal.get('user_id', '')}"
        )[:200],
    }


def canonical_group_principal(principal: dict[str, Any]) -> dict[str, str] | None:
    principal_type = str(principal.get("type") or "").strip()
    principal_id = str(principal.get("id") or "").strip()
    principal_user_id = str(principal.get("user_id") or "").strip()
    display_name = str(principal.get("display_name") or "").strip()
    if (
        principal_type not in {"member", "business"}
        or not principal_id
        or not principal_user_id
        or not display_name
    ):
        return None
    return {
        "type": principal_type,
        "id": principal_id[:128],
        "user_id": principal_user_id[:128],
        "display_name": display_name[:120],
        "locale": str(principal.get("locale") or "vi")
        if str(principal.get("locale") or "vi") in {"vi", "en", "zh-TW"}
        else "vi",
    }


def direct_group_grant_id() -> str:
    return f"direct-{uuid4()}"
