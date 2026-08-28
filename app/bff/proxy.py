from __future__ import annotations

import secrets
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.bff.session_store import BffSession
from app.integrations.timeblock.client import (
    TimeblockIntegrationError,
    TimeblockRequestTooLarge,
)


_SMALL_BODY_BYTES = 1 * 1024 * 1024
_MEDIA_BODY_BYTES = 32 * 1024 * 1024
_MESSAGING_MEDIA_BODY_BYTES = 96 * 1024 * 1024
_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

_DENIED_EXACT_PATHS = {
    "/api/assistant/notifications/cleanup-media",
    "/api/assistant/notifications/evaluate-scheduled",
    "/api/assistant/notifications/missed-calls/process-scheduled",
}
_DENIED_PATH_PREFIXES = (
    "/api/admin",
    "/api/assistant/notifications/admin",
)


@dataclass(frozen=True, slots=True)
class ProxyRouteSpec:
    method: str
    path: str
    scope_all: tuple[str, ...] = ()
    scope_any: tuple[str, ...] = ()
    maximum_body_bytes: int = _SMALL_BODY_BYTES
    sse: bool = False
    forward_call_request_id: bool = False
    forward_last_event_id: bool = False
    forward_user_agent: bool = False


def _spec(
    method: str,
    path: str,
    *scope_all: str,
    scope_any: tuple[str, ...] = (),
    maximum_body_bytes: int = _SMALL_BODY_BYTES,
    sse: bool = False,
    forward_call_request_id: bool = False,
    forward_last_event_id: bool = False,
    forward_user_agent: bool = False,
) -> ProxyRouteSpec:
    return ProxyRouteSpec(
        method=method,
        path=path,
        scope_all=tuple(scope_all),
        scope_any=scope_any,
        maximum_body_bytes=maximum_body_bytes,
        sse=sse,
        forward_call_request_id=forward_call_request_id,
        forward_last_event_id=forward_last_event_id,
        forward_user_agent=forward_user_agent,
    )


# These are browser-visible compatibility routes only. There is deliberately no
# catch-all proxy: adding a new Timeblock capability requires an explicit entry,
# scope decision, size limit, and review here.
CANONICAL_PROXY_ROUTES: tuple[ProxyRouteSpec, ...] = (
    # Assistant
    _spec("GET", "/api/assistant/history", "assistant.read"),
    _spec("GET", "/api/assistant/usage", "assistant.read"),
    _spec("GET", "/api/assistant/media/{media_id:int}", "assistant.media"),
    _spec("GET", "/api/assistant/context/market", "assistant.read"),
    _spec("GET", "/api/assistant/context/equities", "assistant.read"),
    _spec("POST", "/api/assistant/analyze", "assistant.execute", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/api/assistant/analyze/text", "assistant.execute"),
    _spec("POST", "/api/assistant/analyze/image", "assistant.execute", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/api/assistant/analyze/audio", "assistant.execute", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/api/assistant/analyze/video", "assistant.execute", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/api/assistant/analyze/web", "assistant.execute"),
    _spec("POST", "/api/assistant/analyze/market", "assistant.execute"),
    _spec("POST", "/api/assistant/analyze/equities", "assistant.execute"),
    _spec("POST", "/api/assistant/images/generate", "assistant.execute"),
    _spec("POST", "/api/assistant/speech", "assistant.speech"),

    # Messaging directory, contact, friendship, and presence
    _spec("GET", "/api/messaging/directory/me", "directory.read"),
    _spec("GET", "/api/messaging/directory/me/qr.png", "directory.read"),
    _spec("GET", "/api/messaging/directory/search", "directory.read"),
    _spec("POST", "/api/messaging/directory/qr/resolve", "directory.read"),
    _spec("GET", "/api/messaging/contact-v1/i18n", "directory.read"),
    _spec("GET", "/api/messaging/contact-v1/me", "directory.read"),
    _spec("POST", "/api/messaging/contact-v1/avatars", "directory.read"),
    _spec("GET", "/api/messaging/blocks", "connections.read"),
    _spec("POST", "/api/messaging/directory/me/avatar", "media.write", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("DELETE", "/api/messaging/directory/me/avatar", "media.write"),
    _spec("GET", "/api/messaging/directory/{public_id}/avatar", "directory.read", "media.read"),
    _spec("GET", "/api/messaging/connections", "connections.read"),
    _spec("POST", "/api/messaging/connections/request", "connections.write"),
    _spec("POST", "/api/messaging/connections/{friendship_id:int}/accept", "connections.write"),
    _spec("POST", "/api/messaging/connections/{friendship_id:int}/reject", "connections.write"),
    _spec("POST", "/api/messaging/connections/{friendship_id:int}/cancel", "connections.write"),
    _spec("DELETE", "/api/messaging/connections/{friendship_id:int}", "connections.write"),
    _spec("POST", "/api/messaging/users/{owner_type}/{owner_id}/block", "connections.write"),
    _spec("DELETE", "/api/messaging/users/{owner_type}/{owner_id}/block", "connections.write"),
    _spec("POST", "/api/messaging/users/{owner_type}/{owner_id}/restrict", "connections.write"),
    _spec("DELETE", "/api/messaging/users/{owner_type}/{owner_id}/restrict", "connections.write"),
    _spec("GET", "/api/messaging/presence/online", "presence.read"),
    _spec("POST", "/api/messaging/presence/heartbeat", "presence.write"),
    _spec("GET", "/api/messaging/notifications/summary", "notifications.read"),

    # Conversations, messages, media, and realtime events
    _spec("GET", "/api/messaging/conversations", "conversations.read"),
    _spec("POST", "/api/messaging/conversations", "conversations.write"),
    _spec("POST", "/api/messaging/conversations/direct", "conversations.write"),
    _spec("GET", "/api/messaging/groups", "conversations.read"),
    _spec("POST", "/api/messaging/groups", "conversations.write"),
    _spec("GET", "/api/messaging/conversations/{conversation_id:int}/messages", "messages.read"),
    _spec(
        "POST",
        "/api/messaging/conversations/{conversation_id:int}/messages",
        "messages.send",
        maximum_body_bytes=_MESSAGING_MEDIA_BODY_BYTES,
    ),
    _spec("GET", "/api/messaging/conversations/{conversation_id:int}/pinned-messages", "messages.read"),
    _spec("DELETE", "/api/messaging/conversations/{conversation_id:int}", "conversations.write"),
    _spec("POST", "/api/messaging/conversations/{conversation_id:int}/reset", "conversations.write"),
    _spec("POST", "/api/messaging/conversations/{conversation_id:int}/read", "messages.read"),
    _spec("PATCH", "/api/messaging/conversations/{conversation_id:int}/preferences", "conversations.write"),
    _spec("POST", "/api/messaging/conversations/{conversation_id:int}/lock", "conversations.write"),
    _spec("POST", "/api/messaging/conversations/{conversation_id:int}/unlock", "conversations.write"),
    _spec("GET", "/api/messaging/conversations/{conversation_id:int}/ai/context", "messages.read"),
    _spec("PATCH", "/api/messaging/messages/{message_id:int}", "messages.edit"),
    _spec("DELETE", "/api/messaging/messages/{message_id:int}", "messages.delete"),
    _spec("POST", "/api/messaging/messages/{message_id:int}/reactions", "messages.react"),
    _spec("DELETE", "/api/messaging/messages/{message_id:int}/reactions/{reaction:path}", "messages.react"),
    _spec("POST", "/api/messaging/messages/{message_id:int}/delivered", "messages.read"),
    _spec("POST", "/api/messaging/messages/{message_id:int}/read", "messages.read"),
    _spec("POST", "/api/messaging/messages/{message_id:int}/pin", "messages.pin"),
    _spec("DELETE", "/api/messaging/messages/{message_id:int}/pin", "messages.pin"),
    _spec("GET", "/api/messaging/media/{attachment_id:int}", "media.read"),
    _spec("GET", "/api/messaging/media/{attachment_id:int}/download", "media.read"),
    _spec("GET", "/api/messaging/events", "messages.read"),
    _spec(
        "GET",
        "/api/messaging/events/stream",
        "messages.read",
        sse=True,
        forward_last_event_id=True,
    ),

    # Group-call rooms. Timeblock remains the membership/call-record authority.
    _spec("GET", "/api/messaging/conversations/{conversation_id:int}/call-rooms", "calls.read"),
    _spec("POST", "/api/messaging/conversations/{conversation_id:int}/call-rooms", "calls.start"),
    _spec("GET", "/api/messaging/groups/{conversation_id:int}/call-rooms", "calls.read"),
    _spec("POST", "/api/messaging/groups/{conversation_id:int}/call-rooms", "calls.start"),
    _spec("GET", "/api/messaging/call-rooms/{room_id}", "calls.read"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/media/session", "calls.read"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/participants", "calls.start"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/invite", "calls.start"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/join", "calls.answer"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/leave", "calls.end"),
    _spec("POST", "/api/messaging/call-rooms/{room_id}/end", "calls.end"),

    # Direct Call V1, TURN, signaling, lifecycle, and translation sidecar
    _spec("GET", "/api/messaging/ice-servers", scope_any=("calls.start", "calls.answer")),
    _spec(
        "POST",
        "/api/messaging/conversations/{conversation_id:int}/calls",
        "calls.start",
        forward_call_request_id=True,
    ),
    _spec("GET", "/api/messaging/calls", "calls.read"),
    _spec("GET", "/api/messaging/calls/{call_id}", "calls.read"),
    _spec("POST", "/api/messaging/calls/{call_id}/heartbeat", "calls.read", forward_call_request_id=True),
    _spec(
        "POST",
        "/api/messaging/calls/{call_id}/signal",
        scope_any=("calls.start", "calls.answer"),
        forward_call_request_id=True,
    ),
    _spec(
        "POST",
        "/api/messaging/calls/{call_id}/action",
        scope_any=("calls.answer", "calls.end"),
        forward_call_request_id=True,
    ),
    _spec("POST", "/api/messaging/calls/{call_id}/telemetry", "calls.read", forward_call_request_id=True),
    _spec("POST", "/api/messaging/calls/{call_id}/translation/text", "calls.read", "assistant.translation"),
    _spec(
        "POST",
        "/api/messaging/calls/{call_id}/translation/audio",
        "calls.read",
        "assistant.translation",
        maximum_body_bytes=_MEDIA_BODY_BYTES,
    ),
    _spec(
        "POST",
        "/api/messaging/calls/{call_id}/translation/speech",
        "calls.read",
        "assistant.translation",
        "assistant.speech",
    ),
    _spec("POST", "/api/messaging/calls/{call_id}/translation/preferences", "calls.read", "assistant.translation"),
    _spec("GET", "/api/messaging/calls/{call_id}/translation/history", "calls.read", "assistant.translation"),
    _spec("GET", "/api/messaging/calls/{call_id}/translation/quota", "calls.read", "assistant.translation"),

    # Live Translate
    _spec("GET", "/translator/api/usage", "assistant.translation"),
    _spec("GET", "/translator/api/history", "assistant.translation"),
    _spec("GET", "/translator/api/history/{history_id:int}", "assistant.translation"),
    _spec("PATCH", "/translator/api/history/{history_id:int}", "assistant.translation"),
    _spec("DELETE", "/translator/api/history/{history_id:int}", "assistant.translation"),
    _spec("POST", "/translator/api/speech", "assistant.translation", "assistant.speech"),
    _spec("POST", "/translator/api/text", "assistant.translation"),
    _spec("POST", "/translator/api/image", "assistant.translation", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/translator/api/audio", "assistant.translation", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/translator/api/video", "assistant.translation", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec("POST", "/translator/api/transcribe", "assistant.translation", maximum_body_bytes=_MEDIA_BODY_BYTES),
    _spec(
        "POST",
        "/translator/api/conversation-audio",
        "assistant.translation",
        maximum_body_bytes=_MEDIA_BODY_BYTES,
    ),

    # In-app notification inbox and actor-owned alerts
    _spec("GET", "/api/internal-messages/inbox", "notifications.read"),
    _spec("POST", "/api/internal-messages/inbox/read-all", "notifications.write"),
    _spec("POST", "/api/internal-messages/inbox/{message_id:int}/read", "notifications.write"),
    _spec("POST", "/api/internal-messages/send", "messages.send"),
    _spec("GET", "/api/internal-messages/alerts", "notifications.read"),
    _spec("POST", "/api/internal-messages/alerts", "notifications.write"),
    _spec("DELETE", "/api/internal-messages/alerts/{alert_id:int}", "notifications.write"),
    _spec("POST", "/api/internal-messages/alerts/evaluate", "notifications.write"),

    # Notification/settings API. Scheduler and admin paths are intentionally absent.
    _spec("GET", "/api/assistant/notifications/preferences", "notifications.read"),
    _spec("PUT", "/api/assistant/notifications/preferences", "notifications.write"),
    _spec("GET", "/api/assistant/notifications/push/public-key", "notifications.read"),
    _spec("GET", "/api/assistant/notifications/push/subscriptions", "push.manage"),
    _spec(
        "POST",
        "/api/assistant/notifications/push/subscriptions",
        "push.manage",
        forward_user_agent=True,
    ),
    _spec("DELETE", "/api/assistant/notifications/push/subscriptions/{subscription_id:int}", "push.manage"),
    _spec("POST", "/api/assistant/notifications/push/subscriptions/revoke-current", "push.manage"),
    _spec("POST", "/api/assistant/notifications/push/test", "push.manage"),
    _spec("GET", "/api/assistant/notifications/exchange-rates", "notifications.read"),
)


def _session(request: Request) -> BffSession:
    settings = request.app.state.settings
    session = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if not session:
        raise HTTPException(status_code=401, detail="session_required")
    return session


def _require_scopes(session: BffSession, spec: ProxyRouteSpec) -> None:
    granted = set(session.scope)
    if not set(spec.scope_all).issubset(granted):
        raise HTTPException(status_code=403, detail="scope_denied")
    if spec.scope_any and not granted.intersection(spec.scope_any):
        raise HTTPException(status_code=403, detail="scope_denied")


def _require_exact_browser_origin(request: Request) -> None:
    settings = request.app.state.settings
    supplied = str(request.headers.get("origin") or "").strip().rstrip("/")
    parsed = urlparse(settings.public_base_url)
    expected = (
        f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        if parsed.scheme and parsed.netloc
        else ""
    )
    cross_site = str(request.headers.get("sec-fetch-site") or "").lower() == "cross-site"
    if supplied and expected and not cross_site and secrets.compare_digest(supplied, expected):
        return
    if (
        not supplied
        and not cross_site
        and not settings.is_production
        and settings.allow_missing_bff_origin
    ):
        return
    raise HTTPException(status_code=403, detail="origin_not_allowed")


def _safe_path(path: str) -> str:
    decoded = unquote(path)
    if (
        not path.startswith("/")
        or "\x00" in decoded
        or "\\" in decoded
        or any(segment in {".", ".."} for segment in decoded.split("/"))
    ):
        raise HTTPException(status_code=400, detail="invalid_proxy_path")
    if path in _DENIED_EXACT_PATHS or any(path.startswith(prefix) for prefix in _DENIED_PATH_PREFIXES):
        raise HTTPException(status_code=404, detail="not_found")
    return path


def _bounded_header(request: Request, name: str, maximum: int) -> str:
    value = str(request.headers.get(name) or "")
    if not value:
        return ""
    if len(value) > maximum or "\r" in value or "\n" in value:
        raise HTTPException(status_code=400, detail="invalid_forward_header")
    return value


def _forwarded_headers(request: Request, spec: ProxyRouteSpec) -> dict[str, str]:
    headers: dict[str, str] = {}
    if request.method in _BODY_METHODS:
        idempotency_key = _bounded_header(request, "idempotency-key", 256)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
    if spec.forward_call_request_id:
        request_id = _bounded_header(request, "x-timeblock-call-v1-request-id", 128)
        if request_id:
            headers["X-Timeblock-Call-V1-Request-ID"] = request_id
    if spec.forward_last_event_id:
        event_id = _bounded_header(request, "last-event-id", 128)
        if event_id:
            headers["Last-Event-ID"] = event_id
    if spec.forward_user_agent:
        user_agent = _bounded_header(request, "user-agent", 512)
        if user_agent:
            headers["User-Agent"] = user_agent
    return headers


def _content_length(request: Request, maximum: int) -> None:
    raw = str(request.headers.get("content-length") or "").strip()
    if not raw:
        return
    try:
        value = int(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_content_length") from exc
    if value < 0:
        raise HTTPException(status_code=400, detail="invalid_content_length")
    if value > maximum:
        raise HTTPException(status_code=413, detail="request_too_large")


async def _proxy_request(request: Request, spec: ProxyRouteSpec) -> StreamingResponse:
    session = _session(request)
    _require_scopes(session, spec)
    if request.method in _BODY_METHODS:
        _require_exact_browser_origin(request)
        _content_length(request, spec.maximum_body_bytes)

    content_type = ""
    body = None
    if request.method in _BODY_METHODS:
        content_type = _bounded_header(request, "content-type", 512)
        body = request.stream()

    try:
        result = await request.app.state.timeblock_client.proxy_request(
            request.method,
            _safe_path(request.url.path),
            session.timeblock_token,
            params=tuple(request.query_params.multi_items()),
            body=body,
            content_type=content_type,
            forwarded_headers=_forwarded_headers(request, spec),
            maximum_body_bytes=spec.maximum_body_bytes,
            stream_response=spec.sse,
        )
    except TimeblockRequestTooLarge as exc:
        raise HTTPException(status_code=413, detail="request_too_large") from exc
    except TimeblockIntegrationError as exc:
        status_code = 503 if str(exc) == "timeblock_not_configured" else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return StreamingResponse(
        result.body,
        status_code=result.status_code,
        headers=result.headers,
    )


def _handler(spec: ProxyRouteSpec):
    async def canonical_proxy(request: Request) -> StreamingResponse:
        return await _proxy_request(request, spec)

    return canonical_proxy


def register_canonical_proxy_routes(router: APIRouter) -> None:
    for index, spec in enumerate(CANONICAL_PROXY_ROUTES):
        router.add_api_route(
            spec.path,
            _handler(spec),
            methods=[spec.method],
            name=f"canonical_proxy_{index}_{spec.method.lower()}",
            include_in_schema=False,
        )
