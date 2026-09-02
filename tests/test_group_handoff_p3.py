from datetime import datetime, timedelta, timezone

import pytest

from app.handoff.group import GroupHandoffError, parse_group_handoff

pytestmark = pytest.mark.skip(
    reason="retired room-bound Group Contract V2; AI Group V3 owns authorization and data"
)


def payload(**overrides):
    value = {
        "contract_version": "2",
        "authority": "timeblock",
        "handoff_type": "group",
        "handoff_id": "h" * 32,
        "generation": "g" * 32,
        "surface": "group_call",
        "mode": "audio",
        "session_token": "opaque-token",
        "session_id": "group:room-1",
        "room_id": "group-call:room-1",
        "participant_id": "member:1",
        "workspace_id": "conversation:1",
        "issuer": "timeblock",
        "audience": "communication-runtime",
        "source_language": "vi",
        "target_language": "zh-TW",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(),
        "runtime_url": "https://guilua.example",
        "websocket_url": "wss://guilua.example/ws/communication/group:room-1",
        "language_profile": {
            "spoken_language": "vi",
            "preferred_output_language": "zh-TW",
            "secondary_language": "en",
            "auto_detect_enabled": False,
            "auto_translate": True,
            "auto_read_translation": True,
            "show_original": True,
            "show_translation": True,
            "tts_voice_profile": "calm",
        },
        "translation_plan": {
            "source_language": "vi",
            "target_languages": ["en", "zh-TW"],
            "translation_count": 2,
            "strategy": "once_per_distinct_target",
        },
    }
    value.update(overrides)
    return value


def test_group_handoff_parser_accepts_profile_and_distinct_target_plan():
    handoff = parse_group_handoff(payload())
    assert handoff.language_profile.auto_read_translation is True
    assert handoff.language_profile.tts_voice_profile == "calm"
    assert handoff.translation_plan.target_languages == ("en", "zh-TW")


@pytest.mark.parametrize(
    "profile",
    [
        {"spoken_language": "ja"},
        {
            "spoken_language": "vi",
            "preferred_output_language": "zh-TW",
            "secondary_language": None,
            "auto_detect_enabled": False,
            "auto_translate": 1,
            "auto_read_translation": False,
            "show_original": True,
            "show_translation": True,
            "tts_voice_profile": "default",
        },
    ],
)
def test_group_handoff_profile_fails_closed(profile):
    with pytest.raises(GroupHandoffError, match="language_profile"):
        parse_group_handoff(payload(language_profile=profile))


def test_group_handoff_translation_plan_rejects_duplicate_targets():
    with pytest.raises(GroupHandoffError, match="translation_plan"):
        parse_group_handoff(
            payload(
                translation_plan={
                    "source_language": "vi",
                    "target_languages": ["zh-TW", "zh-TW"],
                    "translation_count": 2,
                    "strategy": "once_per_distinct_target",
                }
            )
        )


def test_group_translation_preferences_surface_is_profile_read_only():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    template = (root / "app/templates/group_translation_preferences.html").read_text(
        encoding="utf-8"
    )
    script = (root / "app/static/group-ui/group_ui.js").read_text(encoding="utf-8")
    assert 'data-group-profile-source="timeblock"' in template
    assert 'data-group-profile-field="preferred_output_language"' in template
    assert "group:handoff-ready" in script
    assert "applyLanguageProfile" in script
    assert "disabled" in template
