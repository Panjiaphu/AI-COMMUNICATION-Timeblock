from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.bff.session_store import BffSession
from app.core.config import Settings
from app.group_translation.provider import GroupTranslationProviderError, OpenAIGroupTranslationProvider
from app.integrations.timeblock.client import TimeblockIntegrationError


router = APIRouter()
_ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_LANGUAGES = {"vi", "zh-TW", "en"}


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _session(request: Request) -> BffSession:
    settings = _settings(request)
    session = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if not session:
        raise HTTPException(status_code=401, detail="session_required")
    if not session.direct_authorized:
        raise HTTPException(status_code=403, detail="direct_session_required")
    if not set(session.scope).intersection({"calls.read", "calls.answer", "calls.start"}):
        raise HTTPException(status_code=403, detail="scope_denied")
    return session


def _browser_origin(request: Request) -> None:
    settings = _settings(request)
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    parsed = urlparse(settings.public_base_url)
    expected = f"{parsed.scheme}://{parsed.netloc}".rstrip("/") if parsed.scheme and parsed.netloc else ""
    if supplied and expected and supplied == expected:
        return
    if not supplied and not settings.is_production and settings.allow_missing_bff_origin:
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")


def _room_id(value: object) -> str:
    raw = str(value or "").strip()
    for prefix in ("group-call:", "group-radio:"):
        if raw.startswith(prefix):
            raw = raw[len(prefix) :]
            break
    if not _ROOM_RE.fullmatch(raw):
        raise HTTPException(status_code=400, detail="invalid_room_id")
    return raw


def _room_namespace(value: object) -> str:
    raw = str(value or "").strip()
    return "group-radio" if raw.startswith("group-radio:") else "group-call"


async def _bootstrap(request: Request, session: BffSession, room_id: str, body: dict) -> dict:
    source = str(body.get("source_language") or "").strip()
    target = str(body.get("target_language") or "").strip()
    generation = str(body.get("generation") or "").strip()
    consent_version = str(body.get("consent_version") or "").strip()
    estimated_source_seconds = body.get("estimated_source_seconds", 300)
    speaker_id = str(body.get("speaker_id") or "").strip()
    reservation_key = str(body.get("reservation_key") or "").strip()
    if source not in _LANGUAGES or target not in _LANGUAGES or source == target:
        raise HTTPException(status_code=400, detail="invalid_language")
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/call-rooms/{room_id}/translation/session",
            session.timeblock_token,
            {
                "source_language": source,
                "target_language": target,
                "generation": generation,
                "consent_version": consent_version,
                "estimated_source_seconds": estimated_source_seconds,
                "speaker_id": speaker_id or None,
                "reservation_key": reservation_key or None,
            },
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    translation = result.get("translation") if isinstance(result, dict) else None
    if not isinstance(translation, dict):
        raise HTTPException(status_code=502, detail="timeblock_translation_contract_invalid")
    targets = translation.get("target_languages")
    if not isinstance(targets, list) or target not in targets:
        raise HTTPException(status_code=403, detail="target_language_not_in_plan")
    if not text_value(translation.get("quota_reservation_id")):
        raise HTTPException(status_code=502, detail="timeblock_translation_quota_contract_invalid")
    return translation


def text_value(value: object, maximum: int = 256) -> str:
    normalized = str(value or "").strip()
    return normalized if normalized and len(normalized) <= maximum else ""


@router.post("/api/group-translation/session")
async def create_group_translation_session(request: Request) -> JSONResponse:
    _browser_origin(request)
    session = _session(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_request")
    room_namespace = _room_namespace(body.get("room_id"))
    room_id = _room_id(body.get("room_id"))
    translation = await _bootstrap(request, session, room_id, body)
    target = str(body.get("target_language") or "").strip()
    provider = OpenAIGroupTranslationProvider(_settings(request))
    try:
        secret = await provider.create_client_secret(
            source_language=str(translation["source_language"]),
            target_language=target,
            principal_id=str(translation["participant_id"]),
        )
    except GroupTranslationProviderError as exc:
        reservation_id = text_value(translation.get("quota_reservation_id"), 128)
        if reservation_id:
            try:
                await request.app.state.timeblock_client.client_post(
                    f"/api/messaging/call-rooms/{room_id}/translation/usage/release",
                    session.timeblock_token,
                    {"quota_reservation_id": reservation_id},
                )
            except TimeblockIntegrationError:
                # The Timeblock TTL cleanup remains the final compensation path.
                pass
        status = 503 if str(exc) in {"group_translation_disabled", "group_translation_provider_not_configured", "group_translation_provider_unavailable"} else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return JSONResponse(
        {
            "provider": "openai-realtime-translate",
            "client_secret": secret.value,
            "expires_at": secret.expires_at,
            "provider_request_id": secret.request_id,
            "translation": {
                **translation,
                "target_language": target,
                "room_id": f"{room_namespace}:{room_id}",
            },
        },
        headers={"Cache-Control": "no-store, private, max-age=0", "Pragma": "no-cache"},
    )


@router.post("/api/group-translation/usage/release")
async def release_group_translation_usage(request: Request) -> JSONResponse:
    _browser_origin(request)
    session = _session(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_request")
    room_id = _room_id(body.get("room_id"))
    reservation_id = text_value(body.get("quota_reservation_id"), 128)
    if not reservation_id:
        raise HTTPException(status_code=400, detail="quota_reservation_required")
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/call-rooms/{room_id}/translation/usage/release",
            session.timeblock_token,
            {"quota_reservation_id": reservation_id},
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.post("/api/group-translation/consent")
async def update_group_translation_consent(request: Request) -> JSONResponse:
    _browser_origin(request)
    session = _session(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_request")
    try:
        conversation_id = int(body.get("conversation_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid_conversation_id") from exc
    payload = {
        "enabled": body.get("enabled", True),
        "target_languages": body.get("target_languages"),
        "policy_version": body.get("policy_version"),
    }
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/conversations/{conversation_id}/group-translation-consent",
            session.timeblock_token,
            payload,
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.post("/api/group-translation/events")
async def publish_group_translation_event(request: Request) -> JSONResponse:
    _browser_origin(request)
    session = _session(request)
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("event"), dict):
        raise HTTPException(status_code=400, detail="invalid_request")
    room_id = _room_id(body.get("room_id"))
    event = body["event"]
    if any(key in event for key in ("audio", "audio_base64", "raw_media", "media")):
        raise HTTPException(status_code=400, detail="raw_media_not_allowed")
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/call-rooms/{room_id}/translation/events",
            session.timeblock_token,
            event,
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.get("/api/group-translation/history/{room_id}")
async def group_translation_history(request: Request, room_id: str) -> JSONResponse:
    _browser_origin(request)
    session = _session(request)
    normalized_room_id = _room_id(room_id)
    try:
        result = await request.app.state.timeblock_client.client_get(
            f"/api/messaging/call-rooms/{normalized_room_id}/translation/history",
            session.timeblock_token,
            params={"limit": request.query_params.get("limit", "50")},
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})
