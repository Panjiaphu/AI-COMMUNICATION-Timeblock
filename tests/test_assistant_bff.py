from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.bff.session_store import (
    PendingAuthorizationCapacityExceeded,
    PendingAuthorizationRateLimited,
    SessionStore,
)
from app.core.config import Settings
from app.main import create_app


def test_session_store_never_exposes_timeblock_token_in_browser_record():
    store = SessionStore(session_ttl_seconds=3600, pending_ttl_seconds=120)
    session = store.create_session(
        timeblock_token="timeblock-secret-token",
        principal={"id": "1", "display_name": "Member"},
        scope=["identity.read"],
        expires_at="2099-01-01T00:00:00+00:00",
    )
    assert session.session_id != session.timeblock_token
    assert store.get(session.session_id).timeblock_token == "timeblock-secret-token"


def test_pending_authorizations_are_nonce_bound_and_memory_bounded():
    store = SessionStore(
        session_ttl_seconds=3600,
        pending_ttl_seconds=120,
        max_pending_entries=2,
        pending_rate_limit_count=10,
    )
    created = [
        store.create_pending(
            "https://guilua.example/api/session/callback",
            client_key=f"client-{index}",
        )
        for index in range(2)
    ]

    first_pending, first_nonce = created[0]
    second_pending, second_nonce = created[1]
    assert first_pending.browser_nonce_hash != first_nonce
    with pytest.raises(PendingAuthorizationCapacityExceeded):
        store.create_pending(
            "https://guilua.example/api/session/callback",
            client_key="client-3",
        )
    assert store.consume_pending(second_pending.state, first_nonce) is None
    assert store.consume_pending(first_pending.state, first_nonce) == first_pending
    assert store.consume_pending(second_pending.state, second_nonce) == second_pending

    limited = SessionStore(
        session_ttl_seconds=3600,
        pending_ttl_seconds=120,
        max_pending_entries=10,
        pending_rate_limit_count=2,
        pending_rate_limit_window_seconds=60,
    )
    limited.create_pending("https://guilua.example/callback", client_key="198.51.100.10")
    limited.create_pending("https://guilua.example/callback", client_key="198.51.100.10")
    with pytest.raises(PendingAuthorizationRateLimited):
        limited.create_pending("https://guilua.example/callback", client_key="198.51.100.10")


def test_production_mutations_require_same_origin():
    settings = Settings(
        app_env="production",
        debug=False,
        secret_key="production-secret-key-with-at-least-32-bytes",
        public_base_url="https://guilua.onrender.com",
        allowed_websocket_origins="https://guilua.onrender.com",
        allowed_timeblock_handoff_origins="https://timeblock-commercial-pro.onrender.com",
        allow_missing_bff_origin=False,
    )
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/session/logout")
    assert response.status_code == 403
    assert response.json()["detail"] == "origin_not_allowed"


class _SessionLifecycleClient:
    def __init__(self):
        self.exchanges = []
        self.refreshes = []
        self.revocations = []

    async def exchange_guilua_code(self, code, redirect_uri):
        self.exchanges.append((code, redirect_uri))
        return {
            "access_token": "timeblock-access-token-1",
            "principal": {"type": "member", "id": "42", "display_name": "Member"},
            "scope": ["identity.read", "assistant.read"],
            "expires_at": "2099-01-01T00:00:00+00:00",
        }

    async def refresh_guilua_session(self, token):
        self.refreshes.append(token)
        return {
            "access_token": "timeblock-access-token-2",
            "principal": {"type": "member", "id": "42", "display_name": "Member Updated"},
            "scope": ["identity.read", "assistant.read", "assistant.execute"],
            "expires_at": "2099-01-02T00:00:00+00:00",
        }

    async def revoke_guilua_session(self, token):
        self.revocations.append(token)


def test_session_start_callback_refresh_status_and_logout_lifecycle_remains_intact():
    origin = "https://guilua.onrender.com"
    settings = Settings(
        app_env="production",
        debug=False,
        secret_key="production-secret-key-with-at-least-32-bytes",
        public_base_url=origin,
        timeblock_app_url="https://timeblock.example",
        timeblock_api_url="https://timeblock.example",
        timeblock_api_key="server-api-key",
        allowed_websocket_origins=origin,
        allowed_timeblock_handoff_origins="https://timeblock.example",
        allow_missing_bff_origin=False,
        allow_missing_websocket_origin=False,
    )
    app = create_app(settings)
    authority = _SessionLifecycleClient()
    app.state.timeblock_client = authority

    with TestClient(app, base_url=origin) as client:
        anonymous = client.get("/api/session")
        assert anonymous.status_code == 200
        assert anonymous.json() == {"authenticated": False, "authority": "timeblock"}

        start = client.get("/api/session/start", follow_redirects=False)
        assert start.status_code == 303
        authorize_url = urlparse(start.headers["location"])
        authorize_query = parse_qs(authorize_url.query)
        assert f"{authorize_url.scheme}://{authorize_url.netloc}{authorize_url.path}" == (
            "https://timeblock.example/api/guilua/authorize"
        )
        assert authorize_query["client_id"] == ["guilua"]
        assert authorize_query["return_to"] == [f"{origin}/api/session/callback"]
        state = authorize_query["state"][0]
        assert client.cookies.get(settings.guilua_pending_authorization_cookie)

        callback = client.get(
            f"/api/session/callback?code=one-time-code&state={state}",
            follow_redirects=False,
        )
        assert callback.status_code == 303
        set_cookie = callback.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "secure" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "timeblock-access-token" not in set_cookie
        assert client.cookies.get(settings.guilua_pending_authorization_cookie)
        assert authority.exchanges == [
            ("one-time-code", f"{origin}/api/session/callback")
        ]

        authenticated = client.get("/api/session")
        assert authenticated.status_code == 200
        assert authenticated.json()["authenticated"] is True
        assert authenticated.json()["principal"]["display_name"] == "Member"
        assert "timeblock-access-token" not in authenticated.text

        refreshed = client.post("/api/session/refresh", headers={"Origin": origin})
        assert refreshed.status_code == 200
        assert refreshed.json()["principal"]["display_name"] == "Member Updated"
        assert authority.refreshes == ["timeblock-access-token-1"]
        refreshed_status = client.get("/api/session").json()
        assert "assistant.execute" in refreshed_status["scope"]
        assert "timeblock-access-token" not in str(refreshed_status)

        logout = client.post("/api/session/logout", headers={"Origin": origin})
        assert logout.status_code == 200
        assert logout.json() == {"ok": True}
        assert authority.revocations == ["timeblock-access-token-2"]
        assert client.get("/api/session").json() == {
            "authenticated": False,
            "authority": "timeblock",
        }


def test_session_callback_rejects_state_from_a_different_browser_context():
    origin = "https://guilua.onrender.com"
    settings = Settings(
        app_env="production",
        debug=False,
        secret_key="production-secret-key-with-at-least-32-bytes",
        public_base_url=origin,
        timeblock_app_url="https://timeblock.example",
        timeblock_api_url="https://timeblock.example",
        timeblock_api_key="server-api-key",
        allowed_websocket_origins=origin,
        allowed_timeblock_handoff_origins="https://timeblock.example",
        allow_missing_bff_origin=False,
        allow_missing_websocket_origin=False,
    )
    app = create_app(settings)
    authority = _SessionLifecycleClient()
    app.state.timeblock_client = authority

    with TestClient(app, base_url=origin) as attacker:
        start = attacker.get("/api/session/start", follow_redirects=False)
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]

        with TestClient(app, base_url=origin) as victim:
            swapped = victim.get(
                f"/api/session/callback?code=attacker-code&state={state}",
                follow_redirects=False,
            )
            assert swapped.status_code == 400
            assert swapped.json() == {"detail": "invalid_state"}
            assert victim.get("/api/session").json()["authenticated"] is False

        legitimate = attacker.get(
            f"/api/session/callback?code=attacker-code&state={state}",
            follow_redirects=False,
        )
        assert legitimate.status_code == 303
        assert authority.exchanges == [
            ("attacker-code", f"{origin}/api/session/callback")
        ]


def test_parallel_authorization_flows_in_one_browser_keep_the_same_binding_nonce():
    origin = "https://guilua.onrender.com"
    settings = Settings(
        app_env="production",
        debug=False,
        secret_key="production-secret-key-with-at-least-32-bytes",
        public_base_url=origin,
        timeblock_app_url="https://timeblock.example",
        timeblock_api_url="https://timeblock.example",
        timeblock_api_key="server-api-key",
        allowed_websocket_origins=origin,
        allowed_timeblock_handoff_origins="https://timeblock.example",
        allow_missing_bff_origin=False,
        allow_missing_websocket_origin=False,
    )
    app = create_app(settings)
    authority = _SessionLifecycleClient()
    app.state.timeblock_client = authority

    with TestClient(app, base_url=origin) as client:
        first = client.get("/api/session/start", follow_redirects=False)
        first_state = parse_qs(urlparse(first.headers["location"]).query)["state"][0]
        first_nonce = client.cookies.get(settings.guilua_pending_authorization_cookie)
        second = client.get("/api/session/start", follow_redirects=False)
        second_state = parse_qs(urlparse(second.headers["location"]).query)["state"][0]
        second_nonce = client.cookies.get(settings.guilua_pending_authorization_cookie)

        assert first_state != second_state
        assert first_nonce == second_nonce
        assert client.get(
            f"/api/session/callback?code=first-code&state={first_state}",
            follow_redirects=False,
        ).status_code == 303
        assert client.get(
            f"/api/session/callback?code=second-code&state={second_state}",
            follow_redirects=False,
        ).status_code == 303
        assert authority.exchanges == [
            ("first-code", f"{origin}/api/session/callback"),
            ("second-code", f"{origin}/api/session/callback"),
        ]
