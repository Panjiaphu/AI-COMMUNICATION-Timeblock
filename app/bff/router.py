from __future__ import annotations

from urllib.parse import urlencode
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from app.core.config import Settings
from app.integrations.timeblock.client import TimeblockIntegrationError
from app.bff.session_store import BffSession, SessionStore


router = APIRouter()


def _store(request: Request) -> SessionStore:
    return request.app.state.bff_session_store


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _cookie_options(settings: Settings) -> dict:
    return {
        "key": settings.guilua_session_cookie,
        "httponly": True,
        "secure": settings.is_production,
        "samesite": "lax",
        "max_age": settings.guilua_session_ttl_seconds,
        "path": "/",
    }


def _session(request: Request) -> BffSession:
    session = _store(request).get(request.cookies.get(_settings(request).guilua_session_cookie))
    if not session:
        raise HTTPException(status_code=401, detail="session_required")
    return session


def _require_scope(session: BffSession, scope: str) -> None:
    if scope not in session.scope:
        raise HTTPException(status_code=403, detail="scope_denied")


def _require_browser_origin(request: Request) -> None:
    settings = _settings(request)
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    parsed = urlparse(settings.public_base_url)
    expected = f"{parsed.scheme}://{parsed.netloc}".rstrip("/") if parsed.scheme and parsed.netloc else ""
    if supplied and supplied == expected:
        return
    if not supplied and not settings.is_production and settings.allow_missing_bff_origin:
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")


async def _json_payload(request: Request) -> dict:
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_json") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid_json")
    return payload


async def _client_get(request: Request, path: str, scope: str, params: dict | None = None) -> dict:
    session = _session(request)
    _require_scope(session, scope)
    try:
        return await request.app.state.timeblock_client.client_get(path, session.timeblock_token, params=params)
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def _client_post(request: Request, path: str, scope: str, payload: dict) -> dict:
    _require_browser_origin(request)
    session = _session(request)
    _require_scope(session, scope)
    try:
        return await request.app.state.timeblock_client.client_post(path, session.timeblock_token, payload)
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/api/session")
async def session_status(request: Request) -> JSONResponse:
    session = _store(request).get(request.cookies.get(_settings(request).guilua_session_cookie))
    if not session:
        return JSONResponse(
            {"authenticated": False, "authority": "timeblock"},
            headers={"Cache-Control": "no-store, private, max-age=0"},
        )
    return JSONResponse(
        {
            "authenticated": True,
            "authority": "timeblock",
            "principal": session.principal,
            "scope": list(session.scope),
            "expires_at": session.expires_at,
        },
        headers={"Cache-Control": "no-store, private, max-age=0"},
    )


@router.get("/api/session/start")
async def session_start(request: Request) -> RedirectResponse:
    settings = _settings(request)
    redirect_uri = f"{settings.public_base_url.rstrip('/')}/api/session/callback"
    pending = _store(request).create_pending(redirect_uri)
    query = urlencode(
        {
            "client_id": settings.guilua_client_id,
            "return_to": redirect_uri,
            "state": pending.state,
        }
    )
    return RedirectResponse(
        f"{settings.timeblock_app_url.rstrip('/')}/api/guilua/authorize?{query}",
        status_code=303,
    )


@router.get("/api/session/callback")
async def session_callback(request: Request, code: str = "", state: str = "") -> Response:
    pending = _store(request).consume_pending(state)
    if not pending:
        raise HTTPException(status_code=400, detail="invalid_state")
    if not code:
        raise HTTPException(status_code=400, detail="authorization_code_required")
    try:
        result = await request.app.state.timeblock_client.exchange_guilua_code(code, pending.redirect_uri)
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    token = str(result.get("access_token") or "")
    principal = result.get("principal") if isinstance(result.get("principal"), dict) else {}
    scope = result.get("scope") if isinstance(result.get("scope"), list) else []
    if not token or not principal:
        raise HTTPException(status_code=502, detail="invalid_timeblock_session")
    session = _store(request).create_session(
        timeblock_token=token,
        principal=principal,
        scope=[str(item) for item in scope],
        expires_at=str(result.get("expires_at") or ""),
    )
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(value=session.session_id, **_cookie_options(_settings(request)))
    return response


@router.post("/api/session/refresh")
async def session_refresh(request: Request) -> JSONResponse:
    _require_browser_origin(request)
    session = _session(request)
    try:
        result = await request.app.state.timeblock_client.refresh_guilua_session(session.timeblock_token)
    except TimeblockIntegrationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    token = str(result.get("access_token") or "")
    scope = result.get("scope") if isinstance(result.get("scope"), list) else list(session.scope)
    principal = result.get("principal") if isinstance(result.get("principal"), dict) else session.principal
    if not token:
        raise HTTPException(status_code=502, detail="invalid_timeblock_session")
    _store(request).replace_token(
        session.session_id,
        timeblock_token=token,
        principal=principal,
        scope=scope,
        expires_at=str(result.get("expires_at") or ""),
    )
    return JSONResponse({"ok": True, "principal": principal, "expires_at": result.get("expires_at")})


@router.post("/api/session/logout")
async def session_logout(request: Request) -> Response:
    _require_browser_origin(request)
    session = _store(request).get(request.cookies.get(_settings(request).guilua_session_cookie))
    if session:
        try:
            await request.app.state.timeblock_client.revoke_guilua_session(session.timeblock_token)
        except TimeblockIntegrationError:
            pass
        _store(request).delete(session.session_id)
    response = JSONResponse({"ok": True})
    response.delete_cookie(_settings(request).guilua_session_cookie, path="/")
    return response


@router.get("/api/assistant/history")
async def assistant_history(request: Request):
    return await _client_get(request, "/api/guilua/v2/assistant/history", "assistant.read", dict(request.query_params))


@router.get("/api/assistant/usage")
async def assistant_usage(request: Request):
    return await _client_get(request, "/api/guilua/v2/assistant/usage", "assistant.read")


@router.post("/api/assistant/analyze")
async def assistant_analyze(request: Request):
    payload = await _json_payload(request)
    return await _client_post(request, "/api/guilua/v2/assistant/analyze", "assistant.execute", payload)


@router.post("/api/translation/text")
async def translation_text(request: Request):
    return await _client_post(request, "/api/guilua/v2/translation/text", "assistant.translation", await _json_payload(request))


@router.get("/api/messaging/directory/me")
async def messaging_directory_me(request: Request):
    return await _client_get(request, "/api/guilua/v2/directory/me", "directory.read")


@router.get("/api/messaging/directory/search")
async def messaging_directory_search(request: Request):
    return await _client_get(request, "/api/guilua/v2/directory/search", "directory.read", dict(request.query_params))


@router.get("/api/messaging/connections")
async def messaging_connections(request: Request):
    return await _client_get(request, "/api/guilua/v2/connections", "connections.read")


@router.get("/api/messaging/presence/online")
async def messaging_presence_online(request: Request):
    return await _client_get(request, "/api/guilua/v2/presence/online", "presence.read", dict(request.query_params))


@router.post("/api/messaging/presence/heartbeat")
async def messaging_presence_heartbeat(request: Request):
    return await _client_post(request, "/api/guilua/v2/presence/heartbeat", "presence.write", await _json_payload(request))


@router.get("/api/messaging/notifications/summary")
async def messaging_notification_summary(request: Request):
    return await _client_get(request, "/api/guilua/v2/notifications/summary", "notifications.read")


@router.get("/api/messaging/conversations")
async def messaging_conversations(request: Request):
    return await _client_get(request, "/api/guilua/v2/conversations", "conversations.read", dict(request.query_params))


@router.get("/api/messaging/groups")
async def messaging_groups(request: Request):
    return await _client_get(request, "/api/guilua/v2/groups", "conversations.read")


@router.post("/api/messaging/conversations/direct")
async def messaging_direct_conversation(request: Request):
    return await _client_post(request, "/api/guilua/v2/conversations/direct", "conversations.write", await _json_payload(request))


@router.get("/api/messaging/conversations/{conversation_id}/messages")
async def messaging_messages(request: Request, conversation_id: int):
    return await _client_get(
        request,
        f"/api/guilua/v2/conversations/{conversation_id}/messages",
        "messages.read",
        dict(request.query_params),
    )


@router.post("/api/messaging/conversations/{conversation_id}/messages")
async def messaging_send(request: Request, conversation_id: int):
    return await _client_post(
        request,
        f"/api/guilua/v2/conversations/{conversation_id}/messages",
        "messages.send",
        await _json_payload(request),
    )
