from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.group_translation.provider import GroupTranslationProviderError
from app.models import GroupRadioBurst, GroupRadioProcessingJob
from tests.test_group_radio_floor_v3 import FakeAsyncRedis
from tests.test_group_v3_native import (
    AI_ENTITLEMENT,
    PUBLIC_ORIGIN,
    SCOPES,
    _future,
    _handoff_payload,
    _native_app,
)


class FailingRealtimeProvider:
    async def create_client_secret(self, **_values):
        raise GroupTranslationProviderError("group_translation_provider_unavailable")


def _set_identity(client: TestClient, app, session_id: str) -> None:
    client.cookies.set(app.state.settings.guilua_session_cookie, session_id)


def _set_translation_preferences(
    client: TestClient,
    space_id: str,
    *,
    spoken: str,
    target: str,
) -> None:
    headers = {"Origin": PUBLIC_ORIGIN}
    profile = client.put(
        f"/api/group/spaces/{space_id}/translation/profile",
        json={
            "spoken_language": spoken,
            "preferred_output_language": target,
            "auto_translate_enabled": True,
            "auto_read_enabled": False,
            "show_original_enabled": True,
        },
        headers=headers,
    )
    assert profile.status_code == 200
    consent = client.put(
        f"/api/group/spaces/{space_id}/translation/consent",
        json={"status": "granted", "policy_version": "group-translation-v3-2026-08-31"},
        headers=headers,
    )
    assert consent.status_code == 200


def test_two_identity_radio_releases_floor_before_provider_and_failure_is_terminal(tmp_path):
    app = _native_app(
        tmp_path,
        group_media_enabled=True,
        group_livekit_url="wss://group-v3.livekit.cloud",
        group_livekit_api_key="livekit-api-key",
        group_livekit_api_secret="livekit-api-secret",
        group_radio_v3_enabled=True,
        group_radio_redis_url="redis://group-radio.test:6379",
        group_translation_enabled=True,
        openai_api_key="render-server-key-never-sent-to-browser",
    )
    app.state.group_radio_floor._client = FakeAsyncRedis()
    app.state.openai_group_translation_provider = FailingRealtimeProvider()

    owner_principal = _handoff_payload("radio")["principal"]
    invitee_principal = {
        "type": "member",
        "id": "84",
        "user_id": "84",
        "display_name": "Tran An",
        "locale": "en",
    }
    owner_session = app.state.bff_session_store.create_group_session(
        principal=owner_principal,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="radio-owner-handoff",
        surface="radio",
        entitlement=AI_ENTITLEMENT,
    )
    invitee_session = app.state.bff_session_store.create_group_session(
        principal=invitee_principal,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="radio-invitee-handoff",
        surface="radio",
        entitlement={**AI_ENTITLEMENT, "billing_subject": "member:84:84"},
    )
    headers = {"Origin": PUBLIC_ORIGIN}

    with TestClient(app) as client:
        _set_identity(client, app, owner_session.session_id)
        space = client.post(
            "/api/group/spaces",
            json={"title": "Radio closure QA", "description": "Two identities"},
            headers={**headers, "Idempotency-Key": "radio-closure-space-1"},
        )
        assert space.status_code == 201
        space_id = space.json()["space"]["id"]
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
        invitee_membership_id = invitee.json()["membership"]["id"]
        radio = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions",
            json={"title": "Operations", "participant_membership_ids": [invitee_membership_id]},
            headers=headers,
        )
        assert radio.status_code == 201
        radio_id = radio.json()["session"]["id"]
        _set_translation_preferences(client, space_id, spoken="vi", target="vi")

        _set_identity(client, app, invitee_session.session_id)
        joined = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/join",
            headers=headers,
        )
        assert joined.status_code == 200
        _set_translation_preferences(client, space_id, spoken="en", target="en")

        _set_identity(client, app, owner_session.session_id)
        owner_floor = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/acquire",
            json={"source_language": "vi", "target_languages": ["zh-TW"]},
            headers=headers,
        )
        assert owner_floor.status_code == 201
        assert owner_floor.json()["burst"]["target_languages"] == ["en"]
        owner_token = owner_floor.json()["floor_token"]
        owner_burst_id = owner_floor.json()["burst"]["id"]

        _set_identity(client, app, invitee_session.session_id)
        busy = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/acquire",
            json={"source_language": "en", "target_languages": ["vi"]},
            headers=headers,
        )
        assert busy.status_code == 409
        assert busy.json()["detail"] == "group_radio_floor_busy"

        _set_identity(client, app, owner_session.session_id)
        stopped = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/stop",
            json={"floor_token": owner_token},
            headers=headers,
        )
        assert stopped.status_code == 200
        assert stopped.json()["floor_released_before_downstream"] is True
        assert stopped.json()["burst"]["state"] == "finalizing"

        _set_identity(client, app, invitee_session.session_id)
        next_floor = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/acquire",
            json={"source_language": "en", "target_languages": ["zh-TW"]},
            headers=headers,
        )
        assert next_floor.status_code == 201
        assert next_floor.json()["burst"]["target_languages"] == ["vi"]

        _set_identity(client, app, owner_session.session_id)
        provider_failed = client.post(
            f"/api/group/spaces/{space_id}/translation/client-secret",
            json={
                "runtime_kind": "radio",
                "runtime_id": owner_burst_id,
                "segment_id": owner_burst_id,
                "source_language": "vi",
                "target_language": "en",
                "estimated_target_seconds": 10,
            },
            headers={**headers, "Idempotency-Key": "radio-provider-failure-1"},
        )
        assert provider_failed.status_code == 503
        assert provider_failed.json()["detail"] == "group_translation_provider_unavailable"

        _set_identity(client, app, invitee_session.session_id)
        device_lost = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}/floor/device-lost",
            json={"floor_token": next_floor.json()["floor_token"]},
            headers=headers,
        )
        assert device_lost.status_code == 200
        assert device_lost.json()["floor_released_before_downstream"] is True
        assert device_lost.json()["private_audio_playback"] == "suppressed"
        snapshot = client.get(
            f"/api/group/spaces/{space_id}/radio/sessions/{radio_id}"
        )
        assert snapshot.status_code == 200
        assert snapshot.json()["floor"] is None

    with app.state.database.session() as db:
        burst = db.get(GroupRadioBurst, owner_burst_id)
        processing = db.scalar(
            select(GroupRadioProcessingJob).where(
                GroupRadioProcessingJob.burst_id == owner_burst_id
            )
        )
        assert burst is not None and burst.state == "final"
        assert burst.stop_reason == "group_translation_provider_unavailable"
        assert processing is not None and processing.status == "failed"
        assert processing.failure_code == "group_translation_provider_unavailable"
