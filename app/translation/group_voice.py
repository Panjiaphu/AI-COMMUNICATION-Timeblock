"""Group voice-translation event and routing contracts.

This is a control/data contract for the future realtime pipeline. It does not
open a microphone, call an STT/translation provider, or persist history. The
runtime may display partial transcript state, but only final/corrected events
are eligible for TTS and durable history reconciliation.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


SUPPORTED_LANGUAGES = frozenset({"vi", "zh-TW", "en"})
VOICE_TRANSLATION_STATES = frozenset({"partial", "final", "corrected"})
TRANSLATION_STATUSES = frozenset({"pending", "final", "unavailable"})


class GroupVoiceTranslationContractError(ValueError):
    """Raised when a voice translation event violates the lifecycle contract."""


@dataclass(frozen=True, slots=True)
class GroupVoiceTranslationEvent:
    segment_id: str
    generation: str
    speaker_id: str
    source_language: str
    target_language: str
    state: str
    original_text: str
    translated_text: str | None
    translation_status: str
    confidence: float | None

    @property
    def tts_eligible(self) -> bool:
        return (
            self.state in {"final", "corrected"}
            and self.translation_status == "final"
            and bool(self.translated_text)
        )

    @property
    def history_eligible(self) -> bool:
        return self.state in {"final", "corrected"}


@dataclass(frozen=True, slots=True)
class GroupVoiceTranslationRequest:
    segment_id: str
    generation: str
    source_language: str
    target_language: str
    request_key: str


def _text(payload: Mapping[str, object], key: str, *, maximum: int = 4096) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupVoiceTranslationContractError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupVoiceTranslationContractError(f"invalid_{key}")
    return value


def _language(payload: Mapping[str, object], key: str) -> str:
    value = _text(payload, key, maximum=16)
    if value not in SUPPORTED_LANGUAGES:
        raise GroupVoiceTranslationContractError(f"invalid_{key}")
    return value


def parse_group_voice_translation(
    payload: Mapping[str, object],
) -> GroupVoiceTranslationEvent:
    """Validate partial/final/corrected events without trusting client state."""

    if not isinstance(payload, Mapping):
        raise GroupVoiceTranslationContractError("invalid_voice_translation_event")
    segment_id = _text(payload, "segment_id", maximum=128)
    generation = _text(payload, "generation", maximum=128)
    speaker_id = _text(payload, "speaker_id", maximum=128)
    source_language = _language(payload, "source_language")
    target_language = _language(payload, "target_language")
    if source_language == target_language:
        raise GroupVoiceTranslationContractError("source_target_must_differ")
    state = _text(payload, "state", maximum=16)
    if state not in VOICE_TRANSLATION_STATES:
        raise GroupVoiceTranslationContractError("invalid_voice_translation_state")
    original_text = _text(payload, "original_text")
    status = _text(payload, "translation_status", maximum=16)
    if status not in TRANSLATION_STATUSES:
        raise GroupVoiceTranslationContractError("invalid_translation_status")
    translated_value = payload.get("translated_text")
    if translated_value is not None and not isinstance(translated_value, str):
        raise GroupVoiceTranslationContractError("invalid_translated_text")
    translated_text = translated_value.strip() if isinstance(translated_value, str) else None
    if translated_text == "":
        translated_text = None
    if state == "partial" and (translated_text is not None or status != "pending"):
        raise GroupVoiceTranslationContractError("partial_translation_must_remain_pending")
    if state in {"final", "corrected"} and status == "final" and not translated_text:
        raise GroupVoiceTranslationContractError("final_translation_text_required")
    if status == "unavailable" and translated_text is not None:
        raise GroupVoiceTranslationContractError("unavailable_translation_has_text")
    confidence = payload.get("confidence")
    if confidence is not None and (
        not isinstance(confidence, (int, float)) or isinstance(confidence, bool)
        or confidence < 0 or confidence > 1
    ):
        raise GroupVoiceTranslationContractError("invalid_translation_confidence")
    return GroupVoiceTranslationEvent(
        segment_id=segment_id,
        generation=generation,
        speaker_id=speaker_id,
        source_language=source_language,
        target_language=target_language,
        state=state,
        original_text=original_text,
        translated_text=translated_text,
        translation_status=status,
        confidence=float(confidence) if confidence is not None else None,
    )


def build_distinct_target_requests(
    *,
    segment_id: str,
    generation: str,
    source_language: str,
    target_languages: Sequence[str],
) -> tuple[GroupVoiceTranslationRequest, ...]:
    """Build one router request per distinct target language, preserving order."""

    if not segment_id or not generation:
        raise GroupVoiceTranslationContractError("invalid_translation_request_identity")
    if source_language not in SUPPORTED_LANGUAGES:
        raise GroupVoiceTranslationContractError("invalid_source_language")
    if isinstance(target_languages, (str, bytes)):
        raise GroupVoiceTranslationContractError("invalid_target_languages")
    requests: list[GroupVoiceTranslationRequest] = []
    seen: set[str] = set()
    for target in target_languages:
        if target not in SUPPORTED_LANGUAGES:
            raise GroupVoiceTranslationContractError("invalid_target_language")
        if target == source_language:
            continue
        if target in seen:
            continue
        seen.add(target)
        requests.append(
            GroupVoiceTranslationRequest(
                segment_id=segment_id,
                generation=generation,
                source_language=source_language,
                target_language=target,
                request_key=f"{generation}:{segment_id}:{target}",
            )
        )
    return tuple(requests)
