"""Bounded, membership-aware retrieval query contract for Radio history."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RadioHistoryQuery:
    session_id: str
    query: str = ""
    target_language: str | None = None
    speaker_id: str | None = None
    state: str | None = None
    limit: int = 50
    before_id: int | None = None


def normalize_history_query(
    session_id: object,
    *,
    query: object = "",
    target_language: object = None,
    speaker_id: object = None,
    state: object = None,
    limit: object = 50,
    before_id: object = None,
) -> RadioHistoryQuery:
    normalized_session = str(session_id or "").strip()
    if not normalized_session or len(normalized_session) > 128:
        raise ValueError("invalid_session_id")
    normalized_query = str(query or "").strip()
    if len(normalized_query) > 200:
        raise ValueError("invalid_history_query")
    normalized_target = str(target_language or "").strip() or None
    if normalized_target and normalized_target not in {"vi", "zh-TW", "en"}:
        raise ValueError("invalid_target_language")
    normalized_speaker = str(speaker_id or "").strip() or None
    if normalized_speaker and len(normalized_speaker) > 160:
        raise ValueError("invalid_speaker_id")
    normalized_state = str(state or "").strip() or None
    if normalized_state and normalized_state not in {"final", "corrected"}:
        raise ValueError("invalid_history_state")
    try:
        normalized_limit = max(1, min(100, int(limit or 50)))
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_history_limit") from exc
    try:
        normalized_before = int(before_id) if before_id not in (None, "") else None
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_history_cursor") from exc
    return RadioHistoryQuery(
        session_id=normalized_session,
        query=normalized_query,
        target_language=normalized_target,
        speaker_id=normalized_speaker,
        state=normalized_state,
        limit=normalized_limit,
        before_id=normalized_before,
    )
