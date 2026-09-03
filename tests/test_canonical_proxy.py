from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, AsyncIterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.bff.proxy import (
    CANONICAL_PROXY_ROUTES,
    _DENIED_EXACT_PATHS,
    _DENIED_PATH_PREFIXES,
)
from app.core.config import Settings
from app.integrations.timeblock import client as timeblock_client_module
from app.integrations.timeblock.client import (
    TimeblockClient,
    TimeblockProxyResponse,
    TimeblockRequestTooLarge,
)
from app.main import create_app


_BFF_ORIGIN = "https://ai-communication.example"
_TIMEBLOCK_ORIGIN = "https://timeblock.example"


def _settings() -> Settings:
    return Settings(
        app_env="production",
        debug=False,
        secret_key="production-test-secret-with-at-least-32-bytes",
        public_base_url=_BFF_ORIGIN,
        timeblock_app_url=_TIMEBLOCK_ORIGIN,
        timeblock_api_url=_TIMEBLOCK_ORIGIN,
        timeblock_api_key="server-api-key",
        allowed_websocket_origins=_BFF_ORIGIN,
        allowed_timeblock_handoff_origins=_TIMEBLOCK_ORIGIN,
        allow_missing_bff_origin=False,
        allow_missing_websocket_origin=False,
    )


@dataclass(slots=True)
class RecordedProxyCall:
    method: str
    path: str
    token: str
    params: tuple[tuple[str, str], ...]
    body: bytes
    content_type: str
    forwarded_headers: dict[str, str]
    maximum_body_bytes: int
    stream_response: bool


class RecordingProxyClient:
    def __init__(
        self,
        *,
        status_code: int = 200,
        response_headers: dict[str, str] | None = None,
        response_body: bytes = b'{"ok":true}',
    ) -> None:
        self.status_code = status_code
        self.response_headers = response_headers or {"Content-Type": "application/json"}
        self.response_body = response_body
        self.calls: list[RecordedProxyCall] = []

    async def proxy_request(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: tuple[tuple[str, str], ...] = (),
        body: AsyncIterable[bytes] | None = None,
        content_type: str = "",
        forwarded_headers: dict[str, str] | None = None,
        maximum_body_bytes: int,
        stream_response: bool = False,
    ) -> TimeblockProxyResponse:
        raw_body = b""
        if body is not None:
            raw_body = b"".join([chunk async for chunk in body])
        self.calls.append(
            RecordedProxyCall(
                method=method,
                path=path,
                token=token,
                params=tuple(params),
                body=raw_body,
                content_type=content_type,
                forwarded_headers=dict(forwarded_headers or {}),
                maximum_body_bytes=maximum_body_bytes,
                stream_response=stream_response,
            )
        )

        async def response_stream() -> AsyncIterator[bytes]:
            yield self.response_body

        return TimeblockProxyResponse(
            status_code=self.status_code,
            headers=dict(self.response_headers),
            body=response_stream(),
        )


@contextmanager
def _authenticated_client(
    scopes: list[str],
    upstream: RecordingProxyClient | None = None,
):
    settings = _settings()
    app = create_app(settings)
    recorder = upstream or RecordingProxyClient()
    app.state.timeblock_client = recorder
    with TestClient(app, base_url=_BFF_ORIGIN) as browser:
        session = app.state.bff_session_store.create_session(
            timeblock_token="actor-session-token",
            principal={"type": "member", "id": "42", "display_name": "Member"},
            scope=scopes,
            expires_at="2099-01-01T00:00:00+00:00",
        )
        browser.cookies.set(settings.guilua_session_cookie, session.session_id)
        yield browser, recorder


def test_canonical_registry_is_unique_explicit_and_excludes_privileged_paths():
    route_keys = [(spec.method, spec.path) for spec in CANONICAL_PROXY_ROUTES]

    assert len(route_keys) == 120
    assert len(route_keys) == len(set(route_keys))
    assert {method for method, _path in route_keys} <= {
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    }
    assert not any("{proxy_path:path}" in path for _method, path in route_keys)
    assert not any(path in _DENIED_EXACT_PATHS for _method, path in route_keys)
    assert not any(
        path.startswith(prefix)
        for _method, path in route_keys
        for prefix in _DENIED_PATH_PREFIXES
    )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/assistant/notifications/cleanup-media"),
        ("POST", "/api/assistant/notifications/evaluate-scheduled"),
        ("POST", "/api/assistant/notifications/missed-calls/process-scheduled"),
        ("GET", "/api/assistant/notifications/admin/monitoring"),
        ("GET", "/api/admin/users"),
        ("GET", "/api/not-allowlisted"),
    ],
)
def test_denied_and_unknown_paths_are_not_proxy_routes(method: str, path: str):
    app = create_app(_settings())
    with TestClient(app, base_url=_BFF_ORIGIN) as browser:
        response = browser.request(method, path, headers={"Origin": _BFF_ORIGIN})
    assert response.status_code == 404


def test_proxy_requires_an_opaque_session_before_upstream_access():
    app = create_app(_settings())
    recorder = RecordingProxyClient()
    app.state.timeblock_client = recorder
    with TestClient(app, base_url=_BFF_ORIGIN) as browser:
        response = browser.get("/api/assistant/history")

    assert response.status_code == 401
    assert response.json()["detail"] == "session_required"
    assert recorder.calls == []


def test_proxy_rejects_missing_scope_and_accepts_scope_any():
    with _authenticated_client(["assistant.read"]) as (browser, recorder):
        denied = browser.post(
            "/api/assistant/analyze/text",
            headers={"Origin": _BFF_ORIGIN},
            json={"text": "hello"},
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "scope_denied"
        assert recorder.calls == []

    with _authenticated_client(["calls.answer"]) as (browser, recorder):
        allowed = browser.get("/api/messaging/ice-servers")
        assert allowed.status_code == 200
        assert len(recorder.calls) == 1


def test_mutations_require_exact_origin_and_reject_cross_site_fetch():
    with _authenticated_client(["assistant.execute"]) as (browser, recorder):
        missing = browser.post("/api/assistant/analyze/text", json={"text": "hello"})
        wrong = browser.post(
            "/api/assistant/analyze/text",
            headers={"Origin": "https://attacker.example"},
            json={"text": "hello"},
        )
        cross_site = browser.post(
            "/api/assistant/analyze/text",
            headers={"Origin": _BFF_ORIGIN, "Sec-Fetch-Site": "cross-site"},
            json={"text": "hello"},
        )
        allowed = browser.post(
            "/api/assistant/analyze/text",
            headers={"Origin": f"{_BFF_ORIGIN}/", "Sec-Fetch-Site": "same-origin"},
            json={"text": "hello"},
        )

    assert [missing.status_code, wrong.status_code, cross_site.status_code] == [403, 403, 403]
    assert allowed.status_code == 200
    assert len(recorder.calls) == 1


def test_canonical_path_and_duplicate_query_parameters_are_preserved():
    with _authenticated_client(["messages.read"]) as (browser, recorder):
        response = browser.get(
            "/api/messaging/conversations/42/messages"
            "?before=cursor-1&label=one&label=two"
        )

    assert response.status_code == 200
    call = recorder.calls[0]
    assert call.method == "GET"
    assert call.path == "/api/messaging/conversations/42/messages"
    assert call.params == (
        ("before", "cursor-1"),
        ("label", "one"),
        ("label", "two"),
    )
    assert call.token == "actor-session-token"


@pytest.mark.parametrize("locale", ["vi", "en", "zh-TW"])
def test_contact_i18n_proxy_adds_the_selected_locale_when_client_fetch_has_no_query(
    locale: str,
):
    with _authenticated_client(["directory.read"]) as (browser, recorder):
        browser.cookies.set("locale", locale)
        response = browser.get("/api/messaging/contact-v1/i18n")

    assert response.status_code == 200
    assert len(recorder.calls) == 1
    assert recorder.calls[0].params == (("lang", locale),)


def test_contact_i18n_proxy_preserves_an_explicit_locale_query():
    with _authenticated_client(["directory.read"]) as (browser, recorder):
        browser.cookies.set("locale", "vi")
        response = browser.get("/api/messaging/contact-v1/i18n?lang=zh-TW")

    assert response.status_code == 200
    assert recorder.calls[0].params == (("lang", "zh-TW"),)


def test_bff_preserves_upstream_binary_status_and_safe_headers():
    upstream = RecordingProxyClient(
        status_code=206,
        response_headers={
            "Content-Type": "application/octet-stream",
            "Content-Range": "bytes 0-3/8",
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
        },
        response_body=b"\x00\x01\xfe\xff",
    )
    with _authenticated_client(["media.read"], upstream) as (browser, _recorder):
        response = browser.get("/api/messaging/media/9/download")

    assert response.status_code == 206
    assert response.content == b"\x00\x01\xfe\xff"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-range"] == "bytes 0-3/8"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["cache-control"] == "private, no-store"


_MULTIPART_BOUNDARY = "timeblock-test-boundary"
_MULTIPART_BODY = (
    f"--{_MULTIPART_BOUNDARY}\r\n"
    'Content-Disposition: form-data; name="text"\r\n\r\n'
    "hello\r\n"
    f"--{_MULTIPART_BOUNDARY}\r\n"
    'Content-Disposition: form-data; name="file"; filename="voice.bin"\r\n'
    "Content-Type: application/octet-stream\r\n\r\n"
).encode() + b"\x00\x01\xffvoice" + f"\r\n--{_MULTIPART_BOUNDARY}--\r\n".encode()


@pytest.mark.parametrize(
    ("path", "scopes", "content_type", "payload"),
    [
        (
            "/api/assistant/analyze/text",
            ["assistant.execute"],
            "application/json",
            b'{"text":"xin chao","nested":{"ok":true}}',
        ),
        (
            "/translator/api/text",
            ["assistant.translation"],
            "application/x-www-form-urlencoded",
            b"text=xin+chao&source_language=vi&target_language=en",
        ),
        (
            "/api/messaging/conversations/7/messages",
            ["messages.send"],
            f"multipart/form-data; boundary={_MULTIPART_BOUNDARY}",
            _MULTIPART_BODY,
        ),
        (
            "/api/messaging/calls/call-1/translation/audio",
            ["calls.read", "assistant.translation"],
            "application/octet-stream",
            b"\x00\x01\x02raw-audio\xff",
        ),
    ],
)
def test_json_form_multipart_and_raw_bodies_are_forwarded_unchanged(
    path: str,
    scopes: list[str],
    content_type: str,
    payload: bytes,
):
    with _authenticated_client(scopes) as (browser, recorder):
        response = browser.post(
            path,
            headers={"Origin": _BFF_ORIGIN, "Content-Type": content_type},
            content=payload,
        )

    assert response.status_code == 200
    call = recorder.calls[0]
    assert call.path == path
    assert call.content_type == content_type
    assert call.body == payload


@pytest.mark.parametrize(
    ("method", "path", "scopes"),
    [
        ("PUT", "/api/assistant/notifications/preferences", ["notifications.write"]),
        ("PATCH", "/translator/api/history/9", ["assistant.translation"]),
        ("DELETE", "/api/internal-messages/alerts/9", ["notifications.write"]),
    ],
)
def test_put_patch_and_delete_are_forwarded_with_unmodified_bodies(
    method: str,
    path: str,
    scopes: list[str],
):
    payload = b'{"enabled":false,"reason":"member-request"}'
    with _authenticated_client(scopes) as (browser, recorder):
        response = browser.request(
            method,
            path,
            headers={"Origin": _BFF_ORIGIN, "Content-Type": "application/json"},
            content=payload,
        )

    assert response.status_code == 200
    call = recorder.calls[0]
    assert call.method == method
    assert call.path == path
    assert call.body == payload


def test_default_request_size_cap_rejects_before_upstream_access():
    oversized = b"x" * ((1024 * 1024) + 1)
    with _authenticated_client(["assistant.execute"]) as (browser, recorder):
        response = browser.post(
            "/api/assistant/analyze/text",
            headers={"Origin": _BFF_ORIGIN, "Content-Type": "application/octet-stream"},
            content=oversized,
        )

    assert response.status_code == 413
    assert response.json()["detail"] == "request_too_large"
    assert recorder.calls == []


def test_streamed_request_size_cap_counts_chunks_without_content_length():
    async def request_chunks() -> AsyncIterator[bytes]:
        yield b"a" * 6
        yield b"b" * 5

    async def consume() -> None:
        async for _chunk in TimeblockClient._bounded_body(request_chunks(), 10):
            pass

    with pytest.raises(TimeblockRequestTooLarge, match="request_too_large"):
        asyncio.run(consume())


@pytest.mark.parametrize(
    ("path", "scopes", "headers", "expected", "stream_response"),
    [
        (
            "/api/messaging/calls/call-1/action",
            ["calls.end"],
            {
                "Idempotency-Key": "idem-1",
                "X-Timeblock-Call-V1-Request-ID": "call-request-1",
                "Last-Event-ID": "must-not-forward",
                "User-Agent": "must-not-forward",
            },
            {
                "Idempotency-Key": "idem-1",
                "X-Timeblock-Call-V1-Request-ID": "call-request-1",
            },
            False,
        ),
        (
            "/api/messaging/events/stream",
            ["messages.read"],
            {
                "Last-Event-ID": "event-9",
                "User-Agent": "must-not-forward",
            },
            {"Last-Event-ID": "event-9"},
            True,
        ),
        (
            "/api/assistant/notifications/push/subscriptions",
            ["push.manage"],
            {
                "Idempotency-Key": "idem-push",
                "X-Timeblock-Call-V1-Request-ID": "must-not-forward",
                "User-Agent": "Timeblock-PWA/1.0",
            },
            {
                "Idempotency-Key": "idem-push",
                "User-Agent": "Timeblock-PWA/1.0",
            },
            False,
        ),
    ],
)
def test_browser_request_header_forwarding_is_route_specific(
    path: str,
    scopes: list[str],
    headers: dict[str, str],
    expected: dict[str, str],
    stream_response: bool,
):
    response_headers = (
        {"Content-Type": "text/event-stream"}
        if stream_response
        else {"Content-Type": "application/json"}
    )
    response_body = b"event: ready\ndata: {}\n\n" if stream_response else b'{"ok":true}'
    upstream = RecordingProxyClient(
        response_headers=response_headers,
        response_body=response_body,
    )
    method = "GET" if stream_response else "POST"
    request_headers = {
        **headers,
        "Authorization": "Bearer browser-secret",
        "X-Not-Allowlisted": "do-not-forward",
    }
    if method != "GET":
        request_headers["Origin"] = _BFF_ORIGIN

    with _authenticated_client(scopes, upstream) as (browser, recorder):
        response = browser.request(method, path, headers=request_headers, content=b"{}")

    assert response.status_code == 200
    call = recorder.calls[0]
    assert call.forwarded_headers == expected
    assert call.stream_response is stream_response


def _install_mock_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient
    created_clients: list[httpx.AsyncClient] = []

    def async_client_factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        client = original_async_client(*args, **kwargs)
        created_clients.append(client)
        return client

    monkeypatch.setattr(timeblock_client_module.httpx, "AsyncClient", async_client_factory)
    return created_clients


class _BinaryStream(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"\x00\x01\xfe\xff"


def test_transport_preserves_binary_status_safe_headers_and_strips_browser_authority(monkeypatch):
    captured: dict[str, Any] = {}

    async def upstream(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["query"] = tuple(request.url.params.multi_items())
        captured["headers"] = dict(request.headers)
        captured["body"] = await request.aread()
        return httpx.Response(
            206,
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Disposition": 'attachment; filename="voice.bin"',
                "Content-Length": "4",
                "Content-Range": "bytes 0-3/8",
                "Accept-Ranges": "bytes",
                "Retry-After": "3",
                "X-Timeblock-Speech-Model": "tts-model",
                "Set-Cookie": "authority=forbidden",
                "Access-Control-Allow-Origin": "*",
                "WWW-Authenticate": 'Bearer realm="upstream"',
                "X-Upstream-Secret": "forbidden",
            },
            stream=_BinaryStream(),
        )

    created_clients = _install_mock_transport(monkeypatch, upstream)
    client = TimeblockClient(_settings())

    async def request_body() -> AsyncIterator[bytes]:
        yield b"raw-"
        yield b"payload"

    async def exercise():
        result = await client.proxy_request(
            "POST",
            "/api/assistant/analyze/audio",
            "actor-session-token",
            params=(("tag", "one"), ("tag", "two")),
            body=request_body(),
            content_type="application/octet-stream",
            forwarded_headers={
                "Idempotency-Key": "idem-transport",
                "Authorization": "Bearer browser-secret",
                "Cookie": "browser=cookie",
                "Origin": "https://attacker.example",
                "Access-Control-Allow-Origin": "*",
                "Set-Cookie": "browser=forbidden",
                "X-Not-Allowlisted": "forbidden",
            },
            maximum_body_bytes=1024,
        )
        payload = b"".join([chunk async for chunk in result.body])
        return result, payload

    result, payload = asyncio.run(exercise())

    assert result.status_code == 206
    assert payload == b"\x00\x01\xfe\xff"
    assert result.headers == {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="voice.bin"',
        "content-range": "bytes 0-3/8",
        "accept-ranges": "bytes",
        "retry-after": "3",
        "x-timeblock-speech-model": "tts-model",
        "content-length": "4",
    }
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/assistant/analyze/audio"
    assert captured["query"] == (("tag", "one"), ("tag", "two"))
    assert captured["body"] == b"raw-payload"
    assert captured["headers"]["authorization"] == "Bearer server-api-key"
    assert captured["headers"]["x-timeblock-client-session"] == "actor-session-token"
    assert captured["headers"]["idempotency-key"] == "idem-transport"
    assert "cookie" not in captured["headers"]
    assert "origin" not in captured["headers"]
    assert "access-control-allow-origin" not in captured["headers"]
    assert "set-cookie" not in captured["headers"]
    assert "x-not-allowlisted" not in captured["headers"]
    assert created_clients[0].is_closed


class _CloseAwareSseStream(httpx.AsyncByteStream):
    def __init__(self) -> None:
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"id: 1\nevent: ready\ndata: {}\n\n"
        yield b"id: 2\nevent: heartbeat\ndata: {}\n\n"

    async def aclose(self) -> None:
        self.closed = True


def test_sse_consumer_cancellation_closes_upstream_response_and_client(monkeypatch):
    stream = _CloseAwareSseStream()

    async def upstream(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream", "Cache-Control": "no-store"},
            stream=stream,
        )

    created_clients = _install_mock_transport(monkeypatch, upstream)
    client = TimeblockClient(_settings())

    async def exercise() -> tuple[bytes, TimeblockProxyResponse]:
        result = await client.proxy_request(
            "GET",
            "/api/messaging/events/stream",
            "actor-session-token",
            forwarded_headers={"Last-Event-ID": "event-8"},
            maximum_body_bytes=1024,
            stream_response=True,
        )
        first = await anext(result.body)
        await result.body.aclose()
        return first, result

    first, result = asyncio.run(exercise())

    assert first.startswith(b"id: 1")
    assert result.status_code == 200
    assert result.headers["content-type"] == "text/event-stream"
    assert stream.closed
    assert created_clients[0].is_closed
    assert created_clients[0].timeout.read is None
