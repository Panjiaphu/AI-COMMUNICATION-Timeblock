from __future__ import annotations

import pytest

from app.translation.group_voice import (
    GroupVoiceTranslationContractError,
    build_distinct_target_requests,
    parse_group_voice_translation,
)


def _event(**overrides):
    payload = {
        "segment_id": "segment-1",
        "generation": "generation-1",
        "speaker_id": "member:1",
        "source_language": "vi",
        "target_language": "en",
        "state": "final",
        "original_text": "Xe số 3 đã tới kho.",
        "translated_text": "Truck three arrived at the warehouse.",
        "translation_status": "final",
        "confidence": 0.94,
    }
    payload.update(overrides)
    return payload


def test_final_event_is_tts_and_history_eligible():
    event = parse_group_voice_translation(_event())
    assert event.tts_eligible
    assert event.history_eligible
    assert event.confidence == 0.94


def test_partial_event_never_contains_translation_or_tts_eligible_text():
    event = parse_group_voice_translation(
        _event(state="partial", translated_text=None, translation_status="pending")
    )
    assert not event.tts_eligible
    assert not event.history_eligible


def test_corrected_event_replaces_final_translation_without_changing_segment():
    event = parse_group_voice_translation(
        _event(state="corrected", translated_text="Truck three reached the warehouse.")
    )
    assert event.segment_id == "segment-1"
    assert event.tts_eligible
    assert event.history_eligible


def test_distinct_target_routing_deduplicates_and_excludes_source():
    requests = build_distinct_target_requests(
        segment_id="segment-1",
        generation="generation-1",
        source_language="vi",
        target_languages=["vi", "zh-TW", "en", "zh-TW", "en"],
    )
    assert [request.target_language for request in requests] == ["zh-TW", "en"]
    assert [request.request_key for request in requests] == [
        "generation-1:segment-1:zh-TW",
        "generation-1:segment-1:en",
    ]


@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"state": "partial", "translated_text": "leak", "translation_status": "final"}, "partial_translation_must_remain_pending"),
        ({"state": "final", "translated_text": None, "translation_status": "final"}, "final_translation_text_required"),
        ({"translation_status": "unavailable", "translated_text": "leak"}, "unavailable_translation_has_text"),
        ({"confidence": 2}, "invalid_translation_confidence"),
        ({"source_language": "vi", "target_language": "vi"}, "source_target_must_differ"),
    ],
)
def test_event_parser_rejects_unsafe_lifecycle_values(overrides, error):
    with pytest.raises(GroupVoiceTranslationContractError, match=error):
        parse_group_voice_translation(_event(**overrides))


def test_router_rejects_unknown_target_language():
    with pytest.raises(GroupVoiceTranslationContractError, match="invalid_target_language"):
        build_distinct_target_requests(
            segment_id="segment-1",
            generation="generation-1",
            source_language="vi",
            target_languages=["fr"],
        )
