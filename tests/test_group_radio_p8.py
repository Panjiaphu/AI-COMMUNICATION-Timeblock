import pytest

from app.group_radio.translation import (
    RadioTranslationContractError,
    distinct_target_languages,
    parse_radio_translation_burst,
    recipient_tts_key,
)


def _event(**overrides):
    payload = {
        "segment_id": "segment-1",
        "generation": "generation-1",
        "speaker_id": "member:1",
        "source_language": "vi",
        "target_language": "en",
        "state": "final",
        "original_text": "Xin chao",
        "translated_text": "Hello",
        "translation_status": "final",
        "source_duration_seconds": 3,
    }
    payload.update(overrides)
    return payload


def test_radio_translation_accepts_final_and_builds_recipient_dedupe_key():
    burst = parse_radio_translation_burst(_event(), session_id="a" * 32)
    assert burst.tts_eligible is True
    assert burst.history_eligible is True
    assert recipient_tts_key(burst) == "a" * 32 + ":generation-1:segment-1:en"


def test_radio_partial_never_enters_tts_or_history():
    burst = parse_radio_translation_burst(
        _event(state="partial", translated_text=None, translation_status="pending"),
        session_id="a" * 32,
    )
    assert burst.tts_eligible is False
    assert burst.history_eligible is False
    assert recipient_tts_key(burst) is None


def test_radio_burst_and_targets_are_bounded_and_deduplicated():
    assert distinct_target_languages("vi", ["en", "en", "zh-TW", "vi"]) == ("en", "zh-TW")
    with pytest.raises(RadioTranslationContractError, match="invalid_source_duration_seconds"):
        parse_radio_translation_burst(_event(source_duration_seconds=31), session_id="a" * 32)
    with pytest.raises(RadioTranslationContractError, match="partial_translation_must_remain_pending"):
        parse_radio_translation_burst(_event(state="partial", translated_text="Hello"), session_id="a" * 32)
