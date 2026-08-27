from __future__ import annotations

from urllib.parse import urlencode
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from app.bff.proxy import register_canonical_proxy_routes
from app.bff.session_store import (
    BffSession,
    PendingAuthorizationCapacityExceeded,
    PendingAuthorizationRateLimited,
    SessionStore,
)
from app.core.config import Settings
from app.integrations.timeblock.client import TimeblockIntegrationError


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


def _pending_cookie_options(settings: Settings) -> dict:
    return {
        "key": settings.guilua_pending_authorization_cookie,
        "httponly": True,
        "secure": settings.is_production,
        "samesite": "lax",
        "max_age": settings.guilua_pending_authorization_ttl_seconds,
        "path": "/api/session",
    }


def _session(request: Request) -> BffSession:
    session = _store(request).get(request.cookies.get(_settings(request).guilua_session_cookie))
    if not session:
        raise HTTPException(status_code=401, detail="session_required")
    return session


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
async def session_start(request: Request) -> Response:
    settings = _settings(request)
    redirect_uri = f"{settings.public_base_url.rstrip('/')}/api/session/callback"
    browser_nonce = request.cookies.get(settings.guilua_pending_authorization_cookie)
    client_key = request.client.host if request.client else "unknown"
    try:
        pending, browser_nonce = _store(request).create_pending(
            redirect_uri,
            browser_nonce=browser_nonce,
            client_key=client_key,
        )
    except PendingAuthorizationRateLimited as exc:
        return JSONResponse(
            {"detail": "authorization_rate_limited"},
            status_code=429,
            headers={"Retry-After": str(exc.retry_after)},
        )
    except PendingAuthorizationCapacityExceeded as exc:
        return JSONResponse(
            {"detail": "authorization_capacity_reached"},
            status_code=429,
            headers={"Retry-After": str(exc.retry_after)},
        )
    query = urlencode(
        {
            "client_id": settings.guilua_client_id,
            "return_to": redirect_uri,
            "state": pending.state,
        }
    )
    response = RedirectResponse(
        f"{settings.timeblock_app_url.rstrip('/')}/api/guilua/authorize?{query}",
        status_code=303,
    )
    response.set_cookie(value=browser_nonce, **_pending_cookie_options(settings))
    return response


@router.get("/api/session/callback")
async def session_callback(request: Request, code: str = "", state: str = "") -> Response:
    if not code:
        raise HTTPException(status_code=400, detail="authorization_code_required")
    settings = _settings(request)
    browser_nonce = request.cookies.get(settings.guilua_pending_authorization_cookie)
    pending = _store(request).consume_pending(state, browser_nonce)
    if not pending:
        return JSONResponse({"detail": "invalid_state"}, status_code=400)
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
    response.set_cookie(value=session.session_id, **_cookie_options(settings))
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


register_canonical_proxy_routes(router)
