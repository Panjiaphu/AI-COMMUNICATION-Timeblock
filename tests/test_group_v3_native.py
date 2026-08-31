from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.db import Base
from app.main import create_app
from app.models import GroupMessage


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ORIGIN = "http://127.0.0.1:8000"
TIMEBLOCK_ORIGIN = "http://127.0.0.1:5000"
SCOPES = [
    "group.spaces.read",
    "group.spaces.write",
    "group.messages.read",
    "group.messages.write",
    "group.media.use",
    "group.translation.use",
    "group.radio.use",
]


def _settings(tmp_path, **overrides):
    values = {
        "app_env": "test",
        "debug": True,
        "public_base_url": PUBLIC_ORIGIN,
        "timeblock_app_url": TIMEBLOCK_ORIGIN,
        "allowed_timeblock_handoff_origins": TIMEBLOCK_ORIGIN,
        "group_v3_enabled": True,
        "database_url": f"sqlite:///{(tmp_path / 'group-v3.sqlite3').as_posix()}",
        "group_message_encryption_key": "ab" * 32,
        "group_media_enabled": False,
        "group_translation_enabled": False,
        "group_radio_v3_enabled": False,
    }
    values.update(overrides)
    return Settings(**values)


def _future(seconds=3600):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _handoff_payload(surface="chat"):
    return {
        "contract_version": "3",
        "authority": "timeblock",
        "handoff_id": "handoff-v3-000000000000000000000001",
        "surface": surface,
        "source_origin": TIMEBLOCK_ORIGIN,
        "target_origin": PUBLIC_ORIGIN,
        "issuer": "timeblock",
        "audience": "ai-communication-group-v3",
        "principal": {
            "type": "member",
            "id": "42",
            "user_id": "42",
            "display_name": "Nguyen Minh",
            "locale": "vi",
        },
        "entitlement": {
            "group_communication": True,
            "billing_authority": "timeblock",
            "billing_subject": "member:42",
            "plan_code": "member",
            "group_translation_quota": {
                "authority": "timeblock",
                "period": "monthly",
                "period_start": "2026-08-01",
                "period_end": "2026-09-01",
                "audio_limit_target_seconds": 3600,
                "audio_remaining_target_seconds": 1800,
                "video_limit_target_seconds": 1800,
                "video_remaining_target_seconds": 900,
            },
        },
        "scope": SCOPES,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": _future(90),
        "session_expires_at": _future(),
    }


class RedeemStub:
    async def redeem_group_handoff_v3(self, handoff_code, **kwargs):
        assert handoff_code == "h" * 64
        assert kwargs == {
            "source_origin": TIMEBLOCK_ORIGIN,
            "target_origin": PUBLIC_ORIGIN,
            "audience": "ai-communication-group-v3",
        }
        return _handoff_payload("chat")

    async def aclose(self):
        return None


def _native_app(tmp_path):
    app = create_app(_settings(tmp_path))
    Base.metadata.create_all(app.state.database.engine)
    return app


def test_handoff_consume_is_exact_origin_httponly_and_secret_free(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = RedeemStub()
    with TestClient(app) as client:
        denied = client.post(
            "/api/group-handoff/v3/consume",
            json={"handoff_code": "h" * 64, "source_origin": TIMEBLOCK_ORIGIN, "surface": "chat"},
            headers={"Origin": "https://evil.example"},
        )
        assert denied.status_code == 403

        response = client.post(
            "/api/group-handoff/v3/consume",
            json={"handoff_code": "h" * 64, "source_origin": TIMEBLOCK_ORIGIN, "surface": "chat"},
            headers={"Origin": PUBLIC_ORIGIN},
        )
        assert response.status_code == 200
        assert response.json()["authority"] == "ai-communication"
        assert "h" * 64 not in response.text
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie
        assert "Path=/" in cookie
        assert response.headers["Cache-Control"].startswith("no-store")

        session = client.get("/api/group/session")
        assert session.status_code == 200
        assert session.json()["surface"] == "chat"


def test_native_space_and_message_are_idempotent_and_encrypted_at_rest(tmp_path):
    app = _native_app(tmp_path)
    session = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload()["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="handoff-v3-native-chat",
        surface="chat",
        entitlement=_handoff_payload()["entitlement"],
    )
    headers = {"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "create-space-0001"}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        created = client.post(
            "/api/group/spaces",
            json={"title": "Dieu phoi kho van", "description": "Native V3"},
            headers=headers,
        )
        assert created.status_code == 201
        space_id = created.json()["space"]["id"]
        repeated = client.post(
            "/api/group/spaces",
            json={"title": "Dieu phoi kho van", "description": "Native V3"},
            headers=headers,
        )
        assert repeated.status_code == 200
        assert repeated.json()["idempotent"] is True
        assert repeated.json()["space"]["id"] == space_id

        message_headers = {"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "message-client-0001"}
        body = {
            "content": "Xe so 3 da toi cua so 2",
            "content_type": "text",
            "client_message_id": "client-message-0001",
        }
        sent = client.post(f"/api/group/spaces/{space_id}/messages", json=body, headers=message_headers)
        assert sent.status_code == 201
        assert sent.json()["message"]["content"] == body["content"]
        duplicate = client.post(f"/api/group/spaces/{space_id}/messages", json=body, headers=message_headers)
        assert duplicate.status_code == 200
        assert duplicate.json()["idempotent"] is True

    with app.state.database.session() as db:
        stored = db.scalar(select(GroupMessage))
        assert stored is not None
        assert body["content"].encode("utf-8") not in stored.content_ciphertext
        assert stored.encryption_version == "aes-256-gcm-v1"


def test_native_routes_and_ui_enforce_v3_safety_boundaries():
    app = create_app(Settings(app_env="test", debug=True))
    route_paths = set(app.openapi()["paths"])
    assert "/api/group-handoff/v3/consume" in route_paths
    assert "/api/group/spaces" in route_paths
    assert "/api/group-translation/session" not in route_paths

    template = (ROOT / "app/templates/group_communication_v3.html").read_text(encoding="utf-8")
    direct_template = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app/static/group-v3/group_v3_app.js").read_text(encoding="utf-8")
    translation_js = (ROOT / "app/static/group-v3/group_v3_translation.js").read_text(encoding="utf-8")
    i18n_js = (ROOT / "app/static/group-v3/group_v3_i18n.js").read_text(encoding="utf-8")
    radio_router = (ROOT / "app/group_v3/radio_router.py").read_text(encoding="utf-8")

    assert "group_v3_app.js" in template
    assert "group_v3_app.js" not in direct_template
    assert "group_handoff.js" not in direct_template
    assert "localStorage" not in app_js + translation_js
    assert "sessionStorage" not in app_js + translation_js
    assert "OPENAI_API_KEY" not in app_js + translation_js + template
    connect_media = app_js[
        app_js.index("async function connectMedia") : app_js.index("async function connectRadio")
    ]
    assert connect_media.index('state.mediaSession.status !== "active"') < connect_media.index("connectWithGrant")
    assert "if (publish)" in app_js and "getUserMedia" in app_js
    assert "selectAudioOutput" in translation_js
    assert "private_audio_playback\": \"suppressed" in radio_router
    assert radio_router.index("group_radio_floor.release") < radio_router.index("stop_burst_after_floor_release")
    assert "const vi =" in i18n_js
    assert "const en =" in i18n_js
    assert "const zhTW =" in i18n_js
