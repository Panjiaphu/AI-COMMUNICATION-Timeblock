from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.handoff.group_media import (
    GROUP_CALL_MEDIA_PROVIDER_REQUIRED,
    GroupMediaProviderContractError,
    parse_group_media_session,
    parse_group_media_provider_contract,
    require_ready_group_media_provider,
)


def _manifest(**overrides):
    payload = {
        "contract_version": "1",
        "state": "gated",
        "provider": "unconfigured",
        "error_code": GROUP_CALL_MEDIA_PROVIDER_REQUIRED,
        "media_modes": ["audio", "video"],
        "token_transport": "server_memory_only",
        "authorization": "timeblock_membership",
    }
    payload.update(overrides)
    return payload


def test_gated_manifest_is_parseable_but_not_ready():
    contract = parse_group_media_provider_contract(_manifest())
    assert contract.provider == "unconfigured"
    assert contract.media_modes == ("audio", "video")
    assert not contract.ready
    with pytest.raises(GroupMediaProviderContractError, match=GROUP_CALL_MEDIA_PROVIDER_REQUIRED):
        require_ready_group_media_provider(_manifest())


def test_ready_manifest_requires_no_error_and_preserves_transport_boundary():
    contract = require_ready_group_media_provider(
        _manifest(state="ready", provider="approved-sfu", error_code=None)
    )
    assert contract.ready
    assert contract.token_transport == "server_memory_only"
    assert contract.authorization == "timeblock_membership"


def test_livekit_media_session_is_strictly_ephemeral_and_policy_bound():
    now = datetime.now(timezone.utc)
    payload = {
        "session": {
            "provider": "livekit-cloud",
            "provider_room_id": "tb-gc-opaque",
            "server_url": "wss://project.livekit.cloud",
            "participant_id": "member:42",
            "token": "short-lived-token",
            "expires_at": (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
            "room_expires_at": (now + timedelta(seconds=3600)).isoformat().replace("+00:00", "Z"),
            "media": "video",
            "region": "Singapore",
            "limits": {
                "max_participants": 8,
                "max_rooms": 20,
                "room_ttl_seconds": 3600,
                "token_ttl_seconds": 300,
            },
            "recording": False,
            "raw_media_storage": False,
        }
    }
    session = parse_group_media_session(payload)
    assert session.provider == "livekit-cloud"
    assert session.media == "video"
    assert session.max_participants == 8
    assert session.max_rooms == 20
    assert session.token_ttl_seconds == 300

    payload["session"]["recording"] = True
    with pytest.raises(GroupMediaProviderContractError, match="media_storage_policy_violation"):
        parse_group_media_session(payload)


@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"contract_version": "2"}, "contract_mismatch"),
        ({"state": "gated", "error_code": None}, "gated_media_provider_error_code_required"),
        ({"state": "ready", "error_code": "provider_down"}, "ready_media_provider_has_error"),
        ({"media_modes": ["audio", "audio"]}, "invalid_media_provider_modes"),
        ({"token_transport": "url"}, "invalid_media_provider_token_transport"),
        ({"authorization": "client_role"}, "invalid_media_provider_authorization"),
    ],
)
def test_manifest_rejects_unsafe_or_ambiguous_values(overrides, error):
    with pytest.raises(GroupMediaProviderContractError, match=error):
        parse_group_media_provider_contract(_manifest(**overrides))
