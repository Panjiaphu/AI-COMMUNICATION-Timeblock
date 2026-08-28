from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping


class GroupHandoffError(ValueError):
    """Raised when a browser handoff is not a valid Contract V2 envelope."""


@dataclass(frozen=True, slots=True)
class GroupTranslationProfile:
    spoken_language: str
    preferred_output_language: str
    secondary_language: str | None
    auto_detect_enabled: bool
    auto_translate: bool
    auto_read_translation: bool
    show_original: bool
    show_translation: bool
    tts_voice_profile: str


@dataclass(frozen=True, slots=True)
class GroupTranslationPlan:
    source_language: str
    target_languages: tuple[str, ...]
    translation_count: int
    strategy: str


@dataclass(frozen=True, slots=True)
class GroupHandoff:
    contract_version: str
    authority: str
    handoff_type: str
    handoff_id: str
    generation: str
    surface: str
    mode: str
    session_token: str
    session_id: str
    room_id: str
    participant_id: str
    workspace_id: str
    issuer: str
    audience: str
    source_language: str
    target_language: str
    expires_at: str
    runtime_url: str
    websocket_url: str
    language_profile: GroupTranslationProfile | None = None
    translation_plan: GroupTranslationPlan | None = None


_REQUIRED = (
    "contract_version",
    "authority",
    "handoff_type",
    "handoff_id",
    "generation",
    "surface",
    "mode",
    "session_token",
    "session_id",
    "room_id",
    "participant_id",
    "workspace_id",
    "issuer",
    "audience",
    "source_language",
    "target_language",
    "expires_at",
    "runtime_url",
    "websocket_url",
)


def _text(payload: Mapping[str, object], key: str, *, maximum: int = 4096) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupHandoffError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupHandoffError(f"invalid_{key}")
    return value


def _expires_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GroupHandoffError("invalid_expires_at") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise GroupHandoffError("handoff_expired")
    return value


_LANGUAGES = {"vi", "zh-TW", "en"}
_VOICE_PROFILES = {"default", "calm", "bright"}


def _profile_bool(payload: Mapping[str, object], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise GroupHandoffError(f"invalid_language_profile_{key}")
    return value


def _parse_language_profile(value: object) -> GroupTranslationProfile | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise GroupHandoffError("invalid_language_profile")
    spoken = value.get("spoken_language")
    output = value.get("preferred_output_language")
    secondary = value.get("secondary_language")
    if not isinstance(spoken, str) or not isinstance(output, str):
        raise GroupHandoffError("invalid_language_profile_language")
    if spoken not in _LANGUAGES or output not in _LANGUAGES:
        raise GroupHandoffError("invalid_language_profile_language")
    if secondary is not None and (
        not isinstance(secondary, str) or secondary not in _LANGUAGES
    ):
        raise GroupHandoffError("invalid_language_profile_language")
    if secondary in {spoken, output}:
        secondary = None
    voice = value.get("tts_voice_profile")
    if voice not in _VOICE_PROFILES:
        raise GroupHandoffError("invalid_language_profile_voice")
    return GroupTranslationProfile(
        spoken_language=spoken,
        preferred_output_language=output,
        secondary_language=secondary,
        auto_detect_enabled=_profile_bool(value, "auto_detect_enabled"),
        auto_translate=_profile_bool(value, "auto_translate"),
        auto_read_translation=_profile_bool(value, "auto_read_translation"),
        show_original=_profile_bool(value, "show_original"),
        show_translation=_profile_bool(value, "show_translation"),
        tts_voice_profile=voice,
    )


def _parse_translation_plan(value: object) -> GroupTranslationPlan | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise GroupHandoffError("invalid_translation_plan")
    source = value.get("source_language")
    targets = value.get("target_languages")
    count = value.get("translation_count")
    if not isinstance(source, str) or source not in _LANGUAGES or not isinstance(targets, (list, tuple)):
        raise GroupHandoffError("invalid_translation_plan")
    normalized = tuple(str(item) for item in targets)
    if any(item not in _LANGUAGES or item == source for item in normalized):
        raise GroupHandoffError("invalid_translation_plan")
    if len(set(normalized)) != len(normalized) or not isinstance(count, int) or count != len(normalized):
        raise GroupHandoffError("invalid_translation_plan")
    if value.get("strategy") != "once_per_distinct_target":
        raise GroupHandoffError("invalid_translation_plan")
    return GroupTranslationPlan(
        source_language=source,
        target_languages=normalized,
        translation_count=count,
        strategy="once_per_distinct_target",
    )


def parse_group_handoff(payload: Mapping[str, object]) -> GroupHandoff:
    """Validate, but never persist, a Timeblock Group Call/Video handoff."""

    if not isinstance(payload, Mapping):
        raise GroupHandoffError("invalid_handoff")
    values = {key: _text(payload, key) for key in _REQUIRED}
    if values["contract_version"] != "2" or values["authority"] != "timeblock":
        raise GroupHandoffError("contract_mismatch")
    if values["handoff_type"] != "group":
        raise GroupHandoffError("handoff_type_mismatch")
    if values["surface"] not in {"group_call", "group_video"}:
        raise GroupHandoffError("invalid_surface")
    expected_mode = "video" if values["surface"] == "group_video" else "audio"
    if values["mode"] != expected_mode:
        raise GroupHandoffError("mode_mismatch")
    if not values["session_id"].startswith("group:"):
        raise GroupHandoffError("invalid_session_id")
    if not values["room_id"].startswith("group-call:"):
        raise GroupHandoffError("invalid_room_id")
    if not values["participant_id"].startswith(("member:", "business:")):
        raise GroupHandoffError("invalid_participant_id")
    if not values["workspace_id"].startswith("conversation:"):
        raise GroupHandoffError("invalid_workspace_id")
    if not values["websocket_url"].startswith(("ws://", "wss://")):
        raise GroupHandoffError("invalid_websocket_url")
    if values["session_token"] in values["websocket_url"]:
        raise GroupHandoffError("secret_in_url")
    values["expires_at"] = _expires_at(values["expires_at"])
    values["language_profile"] = _parse_language_profile(payload.get("language_profile"))
    values["translation_plan"] = _parse_translation_plan(payload.get("translation_plan"))
    return GroupHandoff(**values)
