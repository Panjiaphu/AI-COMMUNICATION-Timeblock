from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skip(reason="retired room-bound Group Contract V2; covered by test_group_v3_native")

from app.handoff.group import GroupHandoffError, parse_group_handoff
from app.integrations.timeblock.client import TimeblockClient, TimeblockIntegrationError


def valid_payload(**overrides):
    payload = {
        "contract_version": "2",
        "authority": "timeblock",
        "handoff_type": "group",
        "handoff_id": "a" * 32,
        "generation": "a" * 32,
        "surface": "group_video",
        "mode": "video",
        "session_token": "opaque-session-token",
        "session_id": "group:room-123",
        "room_id": "group-call:room-123",
        "participant_id": "member:42",
        "workspace_id": "conversation:7",
        "issuer": "timeblock",
        "audience": "communication-runtime",
        "source_language": "vi",
        "target_language": "zh-TW",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(),
        "runtime_url": "https://guilua.example",
        "websocket_url": "wss://guilua.example/ws/communication/group:room-123",
    }
    payload.update(overrides)
    return payload


def test_group_handoff_parser_accepts_v2_and_does_not_expose_token_in_state():
    handoff = parse_group_handoff(valid_payload())
    assert handoff.contract_version == "2"
    assert handoff.surface == "group_video"
    assert handoff.session_id == "group:room-123"
    assert handoff.session_token == "opaque-session-token"


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("authority", "ai-communication", "contract_mismatch"),
        ("handoff_type", "direct", "handoff_type_mismatch"),
        ("surface", "group_radio", "invalid_surface"),
        ("session_id", "direct:room-123", "invalid_session_id"),
        ("room_id", "call:room-123", "invalid_room_id"),
        ("websocket_url", "https://guilua.example/ws", "invalid_websocket_url"),
    ],
)
def test_group_handoff_parser_fails_closed(field, value, error):
    with pytest.raises(GroupHandoffError, match=error):
        parse_group_handoff(valid_payload(**{field: value}))


def test_group_handoff_parser_rejects_expired_or_secret_url():
    with pytest.raises(GroupHandoffError, match="handoff_expired"):
        parse_group_handoff(
            valid_payload(
                expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
            )
        )
    with pytest.raises(GroupHandoffError, match="secret_in_url"):
        parse_group_handoff(
            valid_payload(websocket_url="wss://guilua.example/ws?token=opaque-session-token")
        )


def test_timeblock_client_wraps_group_handoff_validation_error():
    client = TimeblockClient.__new__(TimeblockClient)
    parsed = client.parse_group_handoff(valid_payload())
    assert parsed.room_id == "group-call:room-123"
    with pytest.raises(TimeblockIntegrationError, match="timeblock_group_handoff_invalid"):
        client.parse_group_handoff(valid_payload(mode="audio"))


def test_group_handoff_script_is_origin_bound_and_memory_only():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    script = (root / "app/static/group-ui/group_handoff.js").read_text(encoding="utf-8")
    template = (root / "app/templates/communication.html").read_text(encoding="utf-8")
    assert "timeblock.group.communication.handoff.v2" in script
    assert "allowed_handoff_origins" in script
    assert "window.opener" in script
    assert "localStorage" not in script
    assert "sessionStorage" not in script
    assert "group_handoff.js" in template
