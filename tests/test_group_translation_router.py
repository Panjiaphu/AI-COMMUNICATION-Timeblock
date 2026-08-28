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
                    "target_language": payload.get("target_language") or "zh-TW",
                    "generation": payload.get("generation") or "server-generation",
                    "expires_at": "2099-01-01T00:00:00+00:00",
                    "strategy": "once_per_distinct_target",
                    "consent_version": payload.get("consent_version") or "consent-1",
                    "quota_reservation_id": "reservation-1",
                    "reserved_target_seconds": 300,
                    "estimated_cost_usd": 0.17,
                    "quota": {"remaining_target_minutes": 55},
                }
            }
        if path.endswith("/group-translation-consent"):
            return {"consent": {"status": "active", "consent_version": "consent-1"}, "quota": {"remaining_target_minutes": 60}}
        if path.endswith("/usage/release"):
            return {"status": "released", "reservation_id": payload.get("quota_reservation_id")}
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
                "consent_version": "consent-1",
                "speaker_id": "member:42",
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
                "consent_version": "consent-1",
            },
        )
    assert response.status_code == 503
    assert response.json()["detail"] == "group_translation_disabled"


def test_group_translation_release_forwards_reservation():
    app = create_app(_settings())
    client_backend = StubTimeblockClient()
    app.state.timeblock_client = client_backend
    with _client(app) as client:
        response = client.post(
            "/api/group-translation/usage/release",
            json={"room_id": "group-call:room-1", "quota_reservation_id": "reservation-1"},
        )
    assert response.status_code == 200
    assert response.json()["status"] == "released"


def test_group_translation_consent_forwards_to_timeblock():
    app = create_app(_settings())
    app.state.timeblock_client = StubTimeblockClient()
    with _client(app) as client:
        response = client.post(
            "/api/group-translation/consent",
            json={"conversation_id": 7, "target_languages": ["zh-TW"]},
        )
    assert response.status_code == 200
    assert response.json()["consent"]["status"] == "active"


def test_group_translation_tts_queue_is_loaded_and_final_only():
    from pathlib import Path

    root = Path(__file__).parents[1]
    queue = (root / "app/static/group-ui/group_translation_tts_queue.js").read_text(encoding="utf-8")
    client = (root / "app/static/group-ui/group_translation_client.js").read_text(encoding="utf-8")
    assert "GroupTranslationTTSQueue" in queue
    assert "AUTOPLAY_BLOCKED" in queue
    assert "quota_reservation_id" in client
    assert "this.audio.autoplay = false" in client
