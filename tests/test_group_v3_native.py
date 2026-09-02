from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.db import Base
from app.handoff.v3 import GroupHandoffV3Error, parse_group_handoff_v3
from app.integrations.timeblock.client import TimeblockIntegrationError
from app.main import create_app
from app.models import GroupMessage
from tests.test_group_radio_floor_v3 import FakeAsyncRedis


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
AI_ENTITLEMENT = {
    "group_communication": True,
    "authorization_authority": "ai-communication",
    "billing_subject": "member:42:42",
}


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
        "authority": "timeblock-identity",
        "group_authority": "ai-communication",
        "launch_authorized": True,
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
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": _future(90),
        "session_expires_at": _future(),
    }


def test_group_handoff_parser_uses_ai_owned_default_surface(tmp_path):
    handoff = parse_group_handoff_v3(_handoff_payload("plugin"), _settings(tmp_path))
    assert handoff.surface == "chat"


def test_group_handoff_parser_accepts_generic_payload_without_surface(tmp_path):
    payload = _handoff_payload("radio")
    payload.pop("surface")
    handoff = parse_group_handoff_v3(payload, _settings(tmp_path))
    assert handoff.surface == "chat"


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("contract_version", "2", "invalid_contract_version"),
        ("audience", "wrong-audience", "invalid_audience"),
        ("source_origin", "https://wrong.example", "invalid_source_origin"),
        ("principal", {}, "invalid_principal_type"),
        (
            "expires_at",
            (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
            "expired_expires_at",
        ),
    ],
)
def test_group_handoff_v3_fails_closed_on_malformed_identity_contract(
    tmp_path, field, value, error
):
    payload = _handoff_payload("chat")
    payload[field] = value
    with pytest.raises(GroupHandoffV3Error, match=error):
        parse_group_handoff_v3(payload, _settings(tmp_path))


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


class ReplayRejectingRedeemStub(RedeemStub):
    def __init__(self):
        self.used = False

    async def redeem_group_handoff_v3(self, handoff_code, **kwargs):
        if self.used:
            raise TimeblockIntegrationError("group_handoff_replayed")
        self.used = True
        return await super().redeem_group_handoff_v3(handoff_code, **kwargs)


def _native_app(tmp_path, **overrides):
    app = create_app(_settings(tmp_path, **overrides))
    Base.metadata.create_all(app.state.database.engine)
    return app


def test_handoff_consume_is_exact_origin_httponly_and_secret_free(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = RedeemStub()
    with TestClient(app) as client:
        denied = client.post(
            "/api/group-handoff/v3/consume",
            json={"handoff_code": "h" * 64, "source_origin": TIMEBLOCK_ORIGIN},
            headers={"Origin": "https://evil.example"},
        )
        assert denied.status_code == 403

        response = client.post(
            "/api/group-handoff/v3/consume",
            json={"handoff_code": "h" * 64, "source_origin": TIMEBLOCK_ORIGIN},
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
        assert session.json()["entitlement"]["authorization_authority"] == "ai-communication"
        assert "group.messages.write" in session.json()["scope"]


def test_handoff_receiver_rejects_replay_and_malformed_json(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = ReplayRejectingRedeemStub()
    body = {
        "handoff_code": "h" * 64,
        "source_origin": TIMEBLOCK_ORIGIN,
    }
    with TestClient(app) as client:
        first = client.post(
            "/api/group-handoff/v3/consume",
            json=body,
            headers={"Origin": PUBLIC_ORIGIN},
        )
        replay = client.post(
            "/api/group-handoff/v3/consume",
            json=body,
            headers={"Origin": PUBLIC_ORIGIN},
        )
        malformed = client.post(
            "/api/group-handoff/v3/consume",
            content=b"{",
            headers={"Origin": PUBLIC_ORIGIN, "Content-Type": "application/json"},
        )

    assert first.status_code == 200
    assert replay.status_code == 502
    assert replay.json()["detail"] == "group_handoff_redeem_failed"
    assert malformed.status_code == 400
    assert malformed.json()["detail"] == "invalid_json"


def test_handoff_consume_ignores_legacy_capability_selector(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = RedeemStub()
    with TestClient(app) as client:
        response = client.post(
            "/api/group-handoff/v3/consume",
            json={
                "handoff_code": "h" * 64,
                "source_origin": TIMEBLOCK_ORIGIN,
                "surface": "radio",
            },
            headers={"Origin": PUBLIC_ORIGIN},
        )
    assert response.status_code == 200
    assert response.json()["surface"] == "chat"


def test_native_space_and_message_are_idempotent_and_encrypted_at_rest(tmp_path):
    app = _native_app(tmp_path)
    session = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload()["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="handoff-v3-native-chat",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
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


def test_native_radio_floor_media_grant_stop_and_leave_are_end_to_end(tmp_path):
    app = _native_app(
        tmp_path,
        group_media_enabled=True,
        group_livekit_url="wss://group-v3.livekit.cloud",
        group_livekit_api_key="livekit-api-key",
        group_livekit_api_secret="livekit-api-secret",
        group_radio_v3_enabled=True,
        group_radio_redis_url="redis://group-radio.test:6379",
    )
    app.state.group_radio_floor._client = FakeAsyncRedis()
    session = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload("radio")["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="handoff-v3-native-radio",
        surface="radio",
        entitlement=AI_ENTITLEMENT,
    )
    headers = {"Origin": PUBLIC_ORIGIN}

    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        created_space = client.post(
            "/api/group/spaces",
            json={"title": "Dieu phoi radio", "description": "Native Radio V3"},
            headers={**headers, "Idempotency-Key": "radio-space-0001"},
        )
        assert created_space.status_code == 201
        space_id = created_space.json()["space"]["id"]

        invitee = client.post(
            f"/api/group/spaces/{space_id}/memberships",
            json={
                "principal_type": "member",
                "principal_id": "84",
                "principal_user_id": "84",
                "display_name": "Tran An",
                "role": "member",
            },
            headers=headers,
        )
        assert invitee.status_code == 201
        invitee_id = invitee.json()["membership"]["id"]

        created_radio = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions",
            json={"title": "Kenh van hanh", "participant_membership_ids": [invitee_id]},
            headers=headers,
        )
        assert created_radio.status_code == 201
        radio_id = created_radio.json()["session"]["id"]

        acquired = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/acquire",
            json={"source_language": "vi", "target_languages": []},
            headers=headers,
        )
        assert acquired.status_code == 201
        floor_token = acquired.json()["floor_token"]
        assert acquired.json()["burst"]["state"] == "talking"

        grant = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/media-grant",
            json={"mode": "talk", "floor_token": floor_token},
            headers=headers,
        )
        assert grant.status_code == 200
        assert grant.json()["grant"]["publish_mode"] == "talk"
        assert grant.json()["grant"]["provider"] == "livekit-cloud"

        stopped = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/stop",
            json={"floor_token": floor_token},
            headers=headers,
        )
        assert stopped.status_code == 200
        assert stopped.json()["floor_released_before_downstream"] is True
        assert stopped.json()["burst"]["state"] == "final"

        history = client.get(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/history"
        )
        assert history.status_code == 200
        assert history.json()["bursts"][0]["state"] == "final"

        left = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/leave",
            headers=headers,
        )
        assert left.status_code == 200
        assert left.json()["ended_for_all"] is False


def test_native_routes_and_ui_enforce_v3_safety_boundaries():
    app = create_app(Settings(app_env="test", debug=True))
    route_paths = set(app.openapi()["paths"])
    assert "/api/group-handoff/v3/consume" in route_paths
    assert "/api/group/spaces" in route_paths
    assert "/api/group/spaces/{space_id}/messages/{message_id}/translation" in route_paths
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
    assert "https://api.openai.com/v1/realtime/calls" in translation_js
    assert "/v1/realtime/translations/calls" not in translation_js
    connect_media = app_js[
        app_js.index("async function connectMedia") : app_js.index("async function connectRadio")
    ]
    assert connect_media.index('state.mediaSession.status !== "active"') < connect_media.index("connectWithGrant")
    assert "if (publish)" in app_js and "getUserMedia" in app_js
    assert "selectAudioOutput" in translation_js
    assert "private_audio_playback\": \"suppressed" in radio_router
    assert radio_router.index("group_radio_floor.release") < radio_router.index("stop_burst_after_floor_release")
    assert 'data-surface="chat-translation"' in app_js
    assert 'data-surface="radio-translation"' in app_js
    assert 'chatTranslation:' in i18n_js
    assert 'radioTranslation:' in i18n_js
    assert "const vi =" in i18n_js
    assert "const en =" in i18n_js
    assert "const zhTW =" in i18n_js
    assert "AI-COMMUNICATION lưu bền thành viên" in i18n_js
    assert "AI-COMMUNICATION durably stores memberships" in i18n_js
    assert "AI-COMMUNICATION 會持久保存成員資格" in i18n_js
    assert "Timeblock durably stores" not in i18n_js
    assert "Timeblock lưu bền" not in i18n_js
    assert 'group_v3_i18n.js?v=20260902-ownership-copy-1' in template


def test_generic_handoff_receiver_has_no_capability_selector_or_browser_secret_storage():
    root_receiver = (ROOT / "app/static/js/group_handoff_root_receiver.js").read_text(
        encoding="utf-8"
    )
    native_receiver = (ROOT / "app/static/group-ui/group_handoff_v3.js").read_text(
        encoding="utf-8"
    )
    assert "transport: \"postmessage-memory\"" in root_receiver
    assert 'body: JSON.stringify({ handoff_code: handoffCode, source_origin: sourceOrigin })' in root_receiver
    assert (
        'if (message.transport !== undefined && message.transport !== "postmessage-memory") return false;'
        in root_receiver
    )
    assert 'if (message.transport !== "postmessage-memory") return false;' in native_receiver
    assert 'const compatibleSurfaces = Object.freeze(["chat", "call", "video", "radio", "plugin"]);' in root_receiver
    assert "surface," in root_receiver
    assert "window.location.replace(\"/group\")" in root_receiver
    assert "surface: text(message.surface" not in root_receiver
    assert "surface: text(message.surface" not in native_receiver
    assert "runtimeConfig.initial_surface" not in native_receiver
    assert "localStorage" not in root_receiver + native_receiver
    assert "sessionStorage" not in root_receiver + native_receiver


def test_normal_group_path_can_select_surface_after_handoff(tmp_path):
    app = _native_app(tmp_path)
    session = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload("chat")["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="normal-group-navigation",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        response = client.get("/group/radio?lang=en")

    assert response.status_code == 200
    assert 'id="group-native-app"' in response.text
    assert '"initial_surface": "radio"' in response.text
    assert '"group_authorized": true' in response.text


def test_group_chat_translation_migration_is_single_head_and_reversible_source():
    migration = (
        ROOT / "alembic/versions/20260902_0018_group_v3_chat_translation.py"
    ).read_text(encoding="utf-8")
    assert 'revision = "20260902_0018"' in migration
    assert 'down_revision = "20260901_0017"' in migration
    assert 'op.create_table(\n        "group_chat_translations"' in migration
    assert 'op.add_column(\n        "group_messages"' in migration
    assert 'op.drop_table("group_chat_translations")' in migration
    assert 'op.drop_column("group_messages", "source_language")' in migration
