from __future__ import annotations

import secrets
from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from app.bff.session_store import BffSession


@dataclass(frozen=True, slots=True)
class GroupActor:
    principal_type: str
    principal_id: str
    principal_user_id: str
    display_name: str
    locale: str
    scope: frozenset[str]
    handoff_id: str
    surface: str
    entitlement: dict

    @property
    def key(self) -> str:
        return f"{self.principal_type}:{self.principal_id}:{self.principal_user_id}"


def require_group_actor(
    request: Request,
    *required_scopes: str,
) -> GroupActor:
    settings = request.app.state.settings
    if not settings.group_v3_enabled:
        raise HTTPException(status_code=503, detail="group_v3_disabled")
    session: BffSession | None = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if not session or session.session_kind != "group":
        raise HTTPException(status_code=401, detail="group_session_required")
    entitlement = session.entitlement or {}
    if entitlement.get("group_communication") is not True:
        raise HTTPException(status_code=403, detail="group_entitlement_required")
    granted = frozenset(session.scope)
    if not set(required_scopes).issubset(granted):
        raise HTTPException(status_code=403, detail="group_scope_denied")
    principal = session.principal
    principal_type = str(principal.get("type") or "")
    principal_id = str(principal.get("id") or "")
    principal_user_id = str(principal.get("user_id") or "")
    display_name = str(principal.get("display_name") or "")
    locale = str(principal.get("locale") or "vi")
    if (
        principal_type not in {"member", "business"}
        or not principal_id
        or not principal_user_id
        or not display_name
    ):
        raise HTTPException(status_code=401, detail="invalid_group_session")
    return GroupActor(
        principal_type=principal_type,
        principal_id=principal_id,
        principal_user_id=principal_user_id,
        display_name=display_name[:120],
        locale=locale if locale in {"vi", "en", "zh-TW"} else "vi",
        scope=granted,
        handoff_id=session.handoff_id,
        surface=session.surface,
        entitlement=dict(entitlement),
    )


def require_write_origin(request: Request) -> None:
    settings = request.app.state.settings
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    parsed = urlparse(settings.public_base_url)
    expected = (
        f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        if parsed.scheme and parsed.netloc
        else ""
    )
    cross_site = str(request.headers.get("sec-fetch-site") or "").lower() == "cross-site"
    if (
        supplied
        and expected
        and not cross_site
        and secrets.compare_digest(supplied, expected)
    ):
        return
    if (
        not supplied
        and not cross_site
        and not settings.is_production
        and settings.allow_missing_bff_origin
    ):
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")
