"""Authenticated BFF endpoints for Group Radio and its floor lease."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.bff.session_store import BffSession
from app.group_radio.floor import GroupRadioFloorError
from app.group_radio.retrieval import normalize_history_query
from app.integrations.timeblock.client import TimeblockIntegrationError


router = APIRouter()
_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def _session(request: Request) -> BffSession:
    settings = request.app.state.settings
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


def _origin(request: Request) -> None:
    settings = request.app.state.settings
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    parsed = urlparse(settings.public_base_url)
    expected = f"{parsed.scheme}://{parsed.netloc}".rstrip("/") if parsed.scheme and parsed.netloc else ""
    if supplied and expected and supplied == expected:
        return
    if not supplied and not settings.is_production and settings.allow_missing_bff_origin:
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")


def _id(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or len(normalized) > 128 or not _SESSION_RE.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"invalid_{field}")
    return normalized


def _floor(request: Request):
    return request.app.state.radio_floor


async def _timeblock(request: Request, session: BffSession, session_id: str, action: str = "authorize") -> dict:
    try:
        return await request.app.state.timeblock_client.client_post(
            f"/api/messaging/radio-sessions/{session_id}/{action}",
            session.timeblock_token,
            {},
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/group-radio/sessions")
async def create_session(request: Request) -> JSONResponse:
    _origin(request)
    session = _session(request)
    body = await request.json()
    try:
        conversation_id = int(body.get("conversation_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid_conversation_id") from exc
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/conversations/{conversation_id}/radio-sessions",
            session.timeblock_token,
            {},
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    radio_session = result.get("radio_session") if isinstance(result, dict) else None
    if isinstance(radio_session, dict) and radio_session.get("id"):
        try:
            request.app.state.radio_capacity.acquire(str(radio_session["id"]))
        except ValueError as exc:
            try:
                await request.app.state.timeblock_client.client_post(
                    f"/api/messaging/radio-sessions/{radio_session['id']}/end",
                    session.timeblock_token,
                    {},
                )
            except TimeblockIntegrationError:
                pass
            raise HTTPException(status_code=429, detail=str(exc)) from exc
    return JSONResponse(result, status_code=201, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.post("/api/group-radio/sessions/{session_id}/{action}")
async def session_action(request: Request, session_id: str, action: str) -> JSONResponse:
    _origin(request)
    session = _session(request)
    normalized = _id(session_id, "session_id")
    if action not in {"join", "leave", "end"}:
        raise HTTPException(status_code=404, detail="not_found")
    result = await _timeblock(request, session, normalized, action)
    if action in {"leave", "end"}:
        try:
            body = await request.json()
        except ValueError:
            body = {}
        principal = session.principal if isinstance(session.principal, dict) else {}
        participant_id = str(
            body.get("participant_id")
            or principal.get("participant_id")
            or f"{principal.get('type') or principal.get('actor_type') or 'member'}:{principal.get('id') or principal.get('actor_id') or ''}"
        ).strip()
        await _floor(request).leave(
            f"group-radio:{normalized}",
            lease_id=str(body.get("lease_id") or "").strip() or None,
            participant_id=participant_id or None,
        )
        if action == "end":
            request.app.state.radio_capacity.release(normalized)
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.get("/api/group-radio/sessions/{session_id}")
async def read_session(request: Request, session_id: str) -> JSONResponse:
    _origin(request)
    session = _session(request)
    normalized = _id(session_id, "session_id")
    try:
        result = await request.app.state.timeblock_client.client_get(
            f"/api/messaging/radio-sessions/{normalized}", session.timeblock_token
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.post("/api/group-radio/sessions/{session_id}/media")
async def media_session(request: Request, session_id: str) -> JSONResponse:
    """Proxy the membership-bound LiveKit audio grant without exposing BFF credentials."""

    _origin(request)
    session = _session(request)
    normalized = _id(session_id, "session_id")
    body = await request.json()
    media = str(body.get("media") or "audio").strip().lower() if isinstance(body, dict) else "audio"
    if media != "audio":
        raise HTTPException(status_code=409, detail="radio_audio_only")
    try:
        result = await request.app.state.timeblock_client.client_post(
            f"/api/messaging/radio-sessions/{normalized}/media/session",
            session.timeblock_token,
            {"media": "audio"},
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0", "Pragma": "no-cache"})


@router.post("/api/group-radio/floor/acquire")
async def acquire_floor(request: Request) -> JSONResponse:
    _origin(request)
    session = _session(request)
    body = await request.json()
    normalized = _id(body.get("session_id"), "session_id")
    await _timeblock(request, session, normalized)
    participant_id = str(body.get("participant_id") or "").strip()
    generation = str(body.get("generation") or "").strip()
    try:
        lease = await _floor(request).acquire(
            f"group-radio:{normalized}", participant_id, generation
        )
    except GroupRadioFloorError as exc:
        status = 409 if exc.code == "floor_busy" else 400
        raise HTTPException(status_code=status, detail=exc.code) from exc
    return JSONResponse(
        {
            "floor": {
                "room_id": lease.room_id,
                "participant_id": lease.participant_id,
                "generation": lease.generation,
                "lease_id": lease.lease_id,
                "state": lease.state,
                "expires_at": lease.expires_at.isoformat(),
                "max_burst_seconds": lease.max_burst_seconds,
            }
        },
        headers={"Cache-Control": "no-store, private, max-age=0"},
    )


@router.post("/api/group-radio/floor/heartbeat")
async def heartbeat_floor(request: Request) -> JSONResponse:
    _origin(request)
    session = _session(request)
    body = await request.json()
    normalized = _id(body.get("session_id"), "session_id")
    await _timeblock(request, session, normalized)
    try:
        lease = await _floor(request).heartbeat(
            f"group-radio:{normalized}", str(body.get("lease_id") or "")
        )
    except GroupRadioFloorError as exc:
        status = 409 if exc.code in {"burst_limit_exceeded", "floor_not_owned"} else 400
        raise HTTPException(status_code=status, detail=exc.code) from exc
    return JSONResponse({"floor": {"state": lease.state, "lease_id": lease.lease_id, "expires_at": lease.expires_at.isoformat()}}, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.post("/api/group-radio/floor/finalize")
async def finalize_floor(request: Request) -> JSONResponse:
    _origin(request)
    session = _session(request)
    body = await request.json()
    normalized = _id(body.get("session_id"), "session_id")
    await _timeblock(request, session, normalized)
    try:
        result = await _floor(request).finalize(
            f"group-radio:{normalized}", str(body.get("lease_id") or "")
        )
    except GroupRadioFloorError as exc:
        status = 409 if exc.code == "floor_not_owned" else 400
        raise HTTPException(status_code=status, detail=exc.code) from exc
    return JSONResponse({"floor": result}, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.get("/api/group-radio/floor/{session_id}")
async def floor_snapshot(request: Request, session_id: str) -> JSONResponse:
    _origin(request)
    session = _session(request)
    normalized = _id(session_id, "session_id")
    await _timeblock(request, session, normalized)
    return JSONResponse({"floor": await _floor(request).snapshot(f"group-radio:{normalized}")}, headers={"Cache-Control": "no-store, private, max-age=0"})


@router.get("/api/group-radio/history/search/{session_id}")
async def history_search(request: Request, session_id: str) -> JSONResponse:
    _origin(request)
    session = _session(request)
    try:
        query = normalize_history_query(
            _id(session_id, "session_id"),
            query=request.query_params.get("q", ""),
            target_language=request.query_params.get("target_language"),
            speaker_id=request.query_params.get("speaker_id"),
            state=request.query_params.get("state"),
            limit=request.query_params.get("limit", "50"),
            before_id=request.query_params.get("before_id"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    params = {"q": query.query, "limit": str(query.limit)}
    if query.target_language:
        params["target_language"] = query.target_language
    if query.speaker_id:
        params["speaker_id"] = query.speaker_id
    if query.state:
        params["state"] = query.state
    if query.before_id is not None:
        params["before_id"] = str(query.before_id)
    try:
        result = await request.app.state.timeblock_client.client_get(
            f"/api/messaging/call-rooms/{query.session_id}/translation/history/search",
            session.timeblock_token,
            params=params,
        )
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store, private, max-age=0"})
