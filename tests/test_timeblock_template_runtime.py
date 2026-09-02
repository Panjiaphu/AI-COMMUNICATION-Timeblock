from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import QueryParams

from app.bff.session_store import BffSession
from app.core.config import Settings
from app.core.timeblock_i18n import translate
from app.core.timeblock_templates import RequestFacade
from app.main import create_app


def _settings() -> Settings:
    return Settings(
        app_env="test",
        debug=True,
        secret_key="test-secret-key",
        public_base_url="http://testserver",
        timeblock_app_url="https://timeblock.example",
        allowed_websocket_origins="http://testserver",
        allowed_timeblock_handoff_origins="https://timeblock.example",
    )


def _usage() -> dict:
    buckets = {
        name: {"used": 3, "limit": 20, "remaining": 17}
        for name in ("text", "image", "audio", "video", "speech")
    }
    return {
        "usage": {
            "used": 3,
            "limit": 20,
            "remaining": 17,
            "reset_at": "2026-08-26T00:00:00+08:00",
            "buckets": buckets,
        }
    }


@pytest.fixture
def runtime():
    settings = _settings()
    app = create_app(settings)
    app.state.timeblock_client = SimpleNamespace(
        client_get=AsyncMock(return_value=_usage()),
        revoke_guilua_session=AsyncMock(return_value={"ok": True}),
    )
    with TestClient(app, base_url="http://testserver") as client:
        yield app, client, settings


def _inject_session(app, client: TestClient, settings: Settings) -> BffSession:
    session = app.state.bff_session_store.create_session(
        timeblock_token="server-side-timeblock-token",
        principal={
            "id": "member-42",
            "type": "member",
            "role": "member",
            "display_name": "Runtime Member",
            "email": "member@example.test",
        },
        scope=["assistant.read", "assistant.execute", "messaging.read"],
        expires_at="2099-01-01T00:00:00+00:00",
    )
    assert isinstance(session, BffSession)
    # TestClient canonicalizes the host-only ``testserver`` domain to
    # ``testserver.local``. Match the cookie produced by a real callback so the
    # logout deletion is exercised against the same domain and path.
    client.cookies.set(
        settings.guilua_session_cookie,
        session.session_id,
        domain="testserver.local",
        path="/",
    )
    return session


@pytest.mark.parametrize("path", ["/", "/assistant", "/ai", "/translate", "/notifications"])
def test_unauthenticated_entrypoints_keep_the_existing_login_shell(runtime, path: str):
    _, client, _ = runtime

    response = client.get(path)

    assert response.status_code == 200
    assert 'class="assistant-auth-card"' in response.text
    assert 'href="/api/session/start"' in response.text
    assert 'id="assistant-app"' not in response.text
    assert "server-side-timeblock-token" not in response.text


def test_unauthenticated_settings_returns_to_the_login_shell(runtime):
    _, client, _ = runtime

    response = client.get("/app-settings?lang=en", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/?lang=en"


@pytest.mark.parametrize("locale", ["vi", "en", "zh-TW"])
def test_authenticated_assistant_renders_canonical_vendor_dom_and_locale(runtime, locale: str):
    app, client, settings = runtime
    _inject_session(app, client, settings)

    response = client.get(f"/assistant?lang={locale}&mode=messages&conversation=42")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert "camera=(self)" in response.headers["permissions-policy"]
    assert f'<html lang="{locale}">' in response.text
    assert 'class="assistant-page"' in response.text
    assert 'id="assistant-app"' in response.text
    assert f'data-locale="{locale}"' in response.text
    assert 'data-actor-type="member"' in response.text
    assert 'data-actor-id="member-42"' in response.text
    assert 'data-messaging-realtime-enabled="true"' in response.text
    assert 'data-messaging-mailbox-lock-enabled="true"' in response.text
    assert "data-group-ui-url" not in response.text
    assert 'data-communication-tab="groups"' in response.text
    assert 'data-communication-panel="groups"' in response.text
    assert 'src="/static/js/assistant_group_native_entry.js?v=20260902-group-native-1"' in response.text
    assert 'data-initial-mode="messages"' in response.text
    assert 'data-initial-conversation="42"' in response.text
    assert 'data-mode-tab="ai"' in response.text
    assert 'data-mode-panel="messages"' in response.text
    assert 'href="/static/css/assistant.css?' in response.text
    assert (
        'href="/static/css/assistant_runtime_adapter.css?v=20260902-group-native-1" '
        "data-guilua-assistant-runtime-adapter"
    ) in response.text
    assert 'src="/static/js/call-v1/bootstrap.js?' in response.text
    assert 'src="/static/js/messaging_contact_v1.js?' in response.text
    assert 'href="/static/manifest.webmanifest"' in response.text
    assert f"https://timeblock.example/market?lang={locale}" in response.text
    assert f'href="/app-settings?lang={locale}"' in response.text
    assert 'class="assistant-auth-card"' not in response.text
    assert ">17/20<" in response.text
    assert "server-side-timeblock-token" not in response.text
    assert translate("assistant.page_title", locale) in response.text
    app.state.timeblock_client.client_get.assert_awaited_with(
        "/api/assistant/usage",
        "server-side-timeblock-token",
    )


def test_authenticated_root_uses_the_same_canonical_vendor_workspace(runtime):
    app, client, settings = runtime
    _inject_session(app, client, settings)

    response = client.get("/?lang=vi")

    assert response.status_code == 200
    assert 'id="assistant-app"' in response.text
    assert 'data-initial-mode="ai"' in response.text
    assert 'class="assistant-auth-card"' not in response.text


def test_malformed_usage_payload_does_not_break_authenticated_shell(runtime):
    app, client, settings = runtime
    _inject_session(app, client, settings)
    app.state.timeblock_client.client_get = AsyncMock(return_value=[])

    response = client.get("/assistant?lang=vi")

    assert response.status_code == 200
    assert 'id="assistant-app"' in response.text
    assert "server-side-timeblock-token" not in response.text


def test_authenticated_legacy_deep_links_map_to_canonical_modes(runtime):
    app, client, settings = runtime
    _inject_session(app, client, settings)

    expected_modes = {
        "/ai": "ai",
        "/translate": "translate",
        "/notifications": "alerts",
        "/conversations/87": "messages",
    }
    for path, mode in expected_modes.items():
        response = client.get(path)
        assert response.status_code == 200
        assert f'data-initial-mode="{mode}"' in response.text
        if path.startswith("/conversations/"):
            assert 'data-initial-conversation="87"' in response.text


def test_authenticated_settings_renders_canonical_assets_and_local_back_link(runtime):
    app, client, settings = runtime
    _inject_session(app, client, settings)

    response = client.get("/app-settings?lang=en")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert "microphone=(self)" in response.headers["permissions-policy"]
    assert '<html lang="en">' in response.text
    assert 'class="tbv2-shell app-settings-page"' in response.text
    assert 'class="app-settings"' in response.text
    assert 'id="app-settings"' in response.text
    assert 'data-locale="en"' in response.text
    assert 'href="/static/css/app_settings.css"' in response.text
    assert 'src="/static/js/app_settings.js"' in response.text
    assert 'href="/assistant?lang=en"' in response.text
    assert 'href="/logout"' in response.text
    assert "https://timeblock.example/market?lang=en" in response.text
    assert 'href="/static/manifest.webmanifest"' in response.text
    assert 'class="assistant-auth-card"' not in response.text
    assert translate("assistant.settings.page_title", "en") in response.text


def test_local_logout_revokes_and_removes_the_opaque_bff_session(runtime):
    app, client, settings = runtime
    session = _inject_session(app, client, settings)

    response = client.get("/logout?lang=zh-TW", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/?lang=zh-TW"
    assert app.state.bff_session_store.get(session.session_id) is None
    assert client.cookies.get(settings.guilua_session_cookie) is None
    assert settings.guilua_session_cookie in response.headers["set-cookie"]
    app.state.timeblock_client.revoke_guilua_session.assert_awaited_once_with(
        "server-side-timeblock-token"
    )


def test_request_facade_keeps_local_routes_local_and_navigation_absolute():
    facade = RequestFacade(
        path="/assistant",
        endpoint="assistant.workspace",
        args=QueryParams("lang=vi"),
        timeblock_app_url="https://timeblock.example",
    )

    assert facade.blueprint == "assistant"
    assert facade.url_for("assistant.workspace", lang="vi") == "/assistant?lang=vi"
    assert facade.url_for("assistant.app_settings", lang="en") == "/app-settings?lang=en"
    assert facade.url_for("auth.logout") == "/logout"
    timeblock_navigation = {
        "home": "/",
        "business_auth.login": "/business/login",
        "utilities.index": "/utilities",
        "opportunities.index": "/opportunities",
        "flights.index": "/flights",
        "market.dashboard": "/market",
        "equities.dashboard": "/equities",
        "missions.list_missions": "/missions",
        "events.list_events": "/events",
        "shop.affiliate": "/shop/affiliate",
        "redeem_shop.list_products": "/redeem-shop",
        "block_ledger.public_explorer": "/blocks",
        "member.dashboard": "/member/dashboard",
    }
    for endpoint, path in timeblock_navigation.items():
        assert facade.url_for(endpoint, lang="zh-TW") == (
            f"https://timeblock.example{path}?lang=zh-TW"
        )
    assert facade.url_for("static", filename="js/assistant.js", v="locked") == (
        "/static/js/assistant.js?v=locked"
    )


@pytest.mark.parametrize("filename", ["../secret", "/absolute.js", "..\\secret"])
def test_request_facade_rejects_unsafe_static_paths(filename: str):
    facade = RequestFacade(
        path="/assistant",
        endpoint="assistant.workspace",
        args=QueryParams(),
        timeblock_app_url="https://timeblock.example",
    )

    with pytest.raises(ValueError, match="unsafe static filename"):
        facade.url_for("static", filename=filename)


def test_request_facade_rejects_unknown_template_endpoints():
    facade = RequestFacade(
        path="/assistant",
        endpoint="assistant.workspace",
        args=QueryParams(),
        timeblock_app_url="https://timeblock.example",
    )

    with pytest.raises(ValueError, match="unsupported Timeblock template endpoint"):
        facade.url_for("admin.secret_export")
