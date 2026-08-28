from __future__ import annotations

from app.core.config import Settings
from app.group_translation.provider import TranslationClientSecret
from app.main import create_app
from fastapi.testclient import TestClient


class StubTimeblockClient:
    async def client_post(self, path, token, payload):
        if path.endswith("/translation/session"):
            return {
                "translation": {
                    "room_id": "group-call:room-1",
                    "conversation_id": 7,
                    "participant_id": "member:42",
                    "source_language": "vi",
                    "target_languages": ["zh-TW"],
                    "generation": payload.get("generation") or "server-generation",
                    "expires_at": "2099-01-01T00:00:00+00:00",
                    "strategy": "once_per_distinct_target",
                }
            }
        return {"accepted": True, "persisted": True}

    async def client_get(self, path, token, *, params=None):
        return {"items": []}


def _settings(**overrides):
    values = {
        "app_env": "test",
        "debug": True,
        "secret_key": "group-translation-test-secret-long-enough",
        "public_base_url": "http://testserver",
        "timeblock_app_url": "http://timeblock.test",
        "timeblock_api_url": "http://timeblock.test",
        "timeblock_api_key": "server-key",
        "allowed_websocket_origins": "http://testserver",
        "allowed_timeblock_handoff_origins": "http://timeblock.test",
        "allow_missing_bff_origin": True,
        "allow_missing_websocket_origin": True,
        "group_translation_enabled": True,
        "openai_api_key": "server-openai-key",
    }
    values.update(overrides)
    return Settings(**values)


def _client(app):
    session = app.state.bff_session_store.create_session(
        timeblock_token="actor-token",
        principal={"type": "member", "id": "42"},
        scope=["calls.read"],
        expires_at="2099-01-01T00:00:00+00:00",
    )
    client = TestClient(app)
    client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
    return client


def test_group_translation_broker_issues_ephemeral_secret_without_forwarding_api_key(monkeypatch):
    app = create_app(_settings())
    app.state.timeblock_client = StubTimeblockClient()

    async def fake_secret(self, **kwargs):
        assert kwargs["principal_id"] == "member:42"
        return TranslationClientSecret(value="ephemeral-secret", expires_at=123)

    monkeypatch.setattr(
        "app.group_translation.provider.OpenAIGroupTranslationProvider.create_client_secret",
        fake_secret,
    )
    with _client(app) as client:
        response = client.post(
            "/api/group-translation/session",
            json={
                "room_id": "group-call:room-1",
                "generation": "gen-1",
                "source_language": "vi",
                "target_language": "zh-TW",
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["client_secret"] == "ephemeral-secret"
    assert "server-openai-key" not in response.text


def test_group_translation_broker_fails_closed_when_disabled():
    app = create_app(_settings(group_translation_enabled=False))
    app.state.timeblock_client = StubTimeblockClient()
    with _client(app) as client:
        response = client.post(
            "/api/group-translation/session",
            json={
                "room_id": "room-1",
                "generation": "gen-1",
                "source_language": "vi",
                "target_language": "zh-TW",
            },
        )
    assert response.status_code == 503
    assert response.json()["detail"] == "group_translation_disabled"
