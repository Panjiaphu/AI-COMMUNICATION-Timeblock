from __future__ import annotations

import json
import time
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.handoff.v3 import GroupHandoffV3Error, parse_group_handoff_v3
from app.integrations.timeblock.client import TimeblockIntegrationError


router = APIRouter()

AI_GROUP_SCOPES = (
    "group.spaces.read",
    "group.spaces.write",
    "group.messages.read",
    "group.messages.write",
    "group.media.use",
    "group.translation.use",
    "group.radio.use",
)


def _ai_group_entitlement(principal: dict[str, str]) -> dict[str, object]:
    return {
        "group_communication": True,
        "authorization_authority": "ai-communication",
        "billing_subject": (
            f"{principal.get('type', '')}:{principal.get('id', '')}:"
            f"{principal.get('user_id', '')}"
        )[:200],
    }


def _public_origin(request: Request) -> str:
    parsed = urlparse(request.app.state.settings.public_base_url)
    return (
        f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        if parsed.scheme and parsed.netloc
        else ""
    )


def _require_exact_browser_origin(request: Request) -> None:
    settings = request.app.state.settings
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    cross_site = str(request.headers.get("sec-fetch-site") or "").lower() == "cross-site"
    expected = _public_origin(request)
    if supplied and expected and supplied == expected and not cross_site:
        return
    if (
        not supplied
        and not cross_site
        and not settings.is_production
        and settings.allow_missing_bff_origin
    ):
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")


def _cookie_options(request: Request, max_age: int) -> dict:
    settings = request.app.state.settings
    return {
        "key": settings.guilua_session_cookie,
        "httponly": True,
        "secure": settings.is_production,
        "samesite": "lax",
        "max_age": max(60, min(max_age, settings.guilua_session_ttl_seconds)),
        "path": "/",
    }


@router.post("/api/group-handoff/v3/consume")
async def consume_group_handoff_v3(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    if not settings.group_v3_enabled:
        raise HTTPException(status_code=503, detail="group_v3_disabled")
    _require_exact_browser_origin(request)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.group_handoff_max_bytes:
                raise HTTPException(status_code=413, detail="request_too_large")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid_content_length") from exc
    body = await request.body()
    if len(body) > settings.group_handoff_max_bytes:
        raise HTTPException(status_code=413, detail="request_too_large")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid_json") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid_json")

    handoff_code = str(payload.get("handoff_code") or "")
    source_origin = str(payload.get("source_origin") or "").strip().rstrip("/")
    if (
        not 48 <= len(handoff_code) <= 256
        or any(character.isspace() for character in handoff_code)
        or source_origin not in settings.timeblock_handoff_origins
    ):
        raise HTTPException(status_code=400, detail="invalid_group_handoff")

    target_origin = _public_origin(request)
    try:
        redeemed = await request.app.state.timeblock_client.redeem_group_handoff_v3(
            handoff_code,
            source_origin=source_origin,
            target_origin=target_origin,
            audience=settings.group_handoff_audience,
        )
        handoff = parse_group_handoff_v3(redeemed, settings)
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail="group_handoff_redeem_failed") from exc
    except GroupHandoffV3Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    entitlement = _ai_group_entitlement(handoff.principal)
    session = request.app.state.bff_session_store.grant_group_authorization(
        request.cookies.get(settings.guilua_session_cookie),
        principal=handoff.principal,
        scope=list(AI_GROUP_SCOPES),
        expires_at=handoff.session_expires_at,
        handoff_id=handoff.handoff_id,
        surface=handoff.surface,
        entitlement=entitlement,
    )
    max_age = max(60, int(session.expires_at - time.time()))
    response = JSONResponse(
        {
            "contract_version": "3",
            "authority": "ai-communication",
            "handoff_id": handoff.handoff_id,
            "surface": handoff.surface,
            "principal": handoff.principal,
            "entitlement": entitlement,
            "scope": list(AI_GROUP_SCOPES),
            "session_expires_at": handoff.session_expires_at,
        },
        headers={
            "Cache-Control": "no-store, private, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )
    response.set_cookie(value=session.session_id, **_cookie_options(request, max_age))
    return response
