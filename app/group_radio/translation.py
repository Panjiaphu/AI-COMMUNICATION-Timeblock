"""Radio burst translation contracts.

The provider adapter remains the existing Group Translation broker.  This
module only enforces Radio-specific burst identity and recipient routing so a
partial transcript can never be persisted or queued for TTS.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


RADIO_TRANSLATION_STATES = frozenset({"partial", "final", "corrected"})
RADIO_TRANSLATION_STATUSES = frozenset({"pending", "final", "unavailable"})
RADIO_LANGUAGES = frozenset({"vi", "zh-TW", "en"})
RADIO_MAX_BURST_SECONDS = 30.0


class RadioTranslationContractError(ValueError):
    """Raised when a Radio translation event is unsafe to route."""


@dataclass(frozen=True, slots=True)
class RadioTranslationBurst:
    session_id: str
    segment_id: str
    generation: str
    speaker_id: str
    source_language: str
    target_language: str
    state: str
    original_text: str
    translated_text: str | None
    translation_status: str
    source_duration_seconds: float

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


def _text(payload: Mapping[str, object], key: str, maximum: int = 4096) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise RadioTranslationContractError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise RadioTranslationContractError(f"invalid_{key}")
    return value


def _language(payload: Mapping[str, object], key: str) -> str:
    value = _text(payload, key, 16)
    if value not in RADIO_LANGUAGES:
        raise RadioTranslationContractError(f"invalid_{key}")
    return value


def parse_radio_translation_burst(
    payload: Mapping[str, object], *, session_id: str
) -> RadioTranslationBurst:
    if not isinstance(payload, Mapping):
        raise RadioTranslationContractError("invalid_radio_translation_event")
    normalized_session = str(session_id or "").strip()
    if not normalized_session or len(normalized_session) > 128:
        raise RadioTranslationContractError("invalid_session_id")
    segment_id = _text(payload, "segment_id", 128)
    generation = _text(payload, "generation", 128)
    speaker_id = _text(payload, "speaker_id", 160)
    source_language = _language(payload, "source_language")
    target_language = _language(payload, "target_language")
    if source_language == target_language:
        raise RadioTranslationContractError("source_target_must_differ")
    state = _text(payload, "state", 16)
    status = _text(payload, "translation_status", 16)
    if state not in RADIO_TRANSLATION_STATES:
        raise RadioTranslationContractError("invalid_translation_state")
    if status not in RADIO_TRANSLATION_STATUSES:
        raise RadioTranslationContractError("invalid_translation_status")
    original_text = _text(payload, "original_text")
    translated = payload.get("translated_text")
    if translated is not None and not isinstance(translated, str):
        raise RadioTranslationContractError("invalid_translated_text")
    translated_text = translated.strip() if isinstance(translated, str) else None
    if translated_text == "":
        translated_text = None
    if state == "partial" and (translated_text is not None or status != "pending"):
        raise RadioTranslationContractError("partial_translation_must_remain_pending")
    if state in {"final", "corrected"} and status == "final" and not translated_text:
        raise RadioTranslationContractError("final_translation_text_required")
    if status == "unavailable" and translated_text is not None:
        raise RadioTranslationContractError("unavailable_translation_has_text")
    duration = payload.get("source_duration_seconds", 1)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        raise RadioTranslationContractError("invalid_source_duration_seconds")
    if duration <= 0 or duration > RADIO_MAX_BURST_SECONDS:
        raise RadioTranslationContractError("invalid_source_duration_seconds")
    return RadioTranslationBurst(
        session_id=normalized_session,
        segment_id=segment_id,
        generation=generation,
        speaker_id=speaker_id,
        source_language=source_language,
        target_language=target_language,
        state=state,
        original_text=original_text,
        translated_text=translated_text,
        translation_status=status,
        source_duration_seconds=float(duration),
    )


def distinct_target_languages(
    source_language: str, target_languages: Sequence[str]
) -> tuple[str, ...]:
    """Return targets once, in plan order, excluding the spoken language."""

    if source_language not in RADIO_LANGUAGES:
        raise RadioTranslationContractError("invalid_source_language")
    if isinstance(target_languages, (str, bytes)):
        raise RadioTranslationContractError("invalid_target_languages")
    result: list[str] = []
    seen: set[str] = set()
    for target in target_languages:
        if target not in RADIO_LANGUAGES:
            raise RadioTranslationContractError("invalid_target_language")
        if target == source_language or target in seen:
            continue
        seen.add(target)
        result.append(target)
    return tuple(result)


def recipient_tts_key(burst: RadioTranslationBurst) -> str | None:
    """Stable dedupe key; only final/corrected provider output is speakable."""

    if not burst.tts_eligible:
        return None
    return f"{burst.session_id}:{burst.generation}:{burst.segment_id}:{burst.target_language}"
