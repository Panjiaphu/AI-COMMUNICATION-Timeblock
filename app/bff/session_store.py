from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from typing import Any


@dataclass(slots=True)
class BffSession:
    session_id: str
    timeblock_token: str
    principal: dict[str, Any]
    scope: tuple[str, ...]
    expires_at: float


@dataclass(slots=True)
class PendingAuthorization:
    state: str
    redirect_uri: str
    expires_at: float


class SessionStore:
    """Small bounded process-local store for opaque browser sessions.

    Guilua must not become a durable identity store. A Render restart expires
    these sessions and the browser is required to authorize again through
    Timeblock. Only the opaque session ID is sent to the browser.
    """

    def __init__(self, *, session_ttl_seconds: int, pending_ttl_seconds: int, max_entries: int = 10_000):
        self.session_ttl_seconds = max(300, int(session_ttl_seconds))
        self.pending_ttl_seconds = max(60, int(pending_ttl_seconds))
        self.max_entries = max(100, int(max_entries))
        self._sessions: dict[str, BffSession] = {}
        self._pending: dict[str, PendingAuthorization] = {}
        self._lock = RLock()

    def _purge(self) -> None:
        now = time.time()
        self._sessions = {
            key: value for key, value in self._sessions.items() if value.expires_at > now
        }
        self._pending = {
            key: value for key, value in self._pending.items() if value.expires_at > now
        }
        if len(self._sessions) > self.max_entries:
            ordered = sorted(self._sessions.values(), key=lambda item: item.expires_at)
            for item in ordered[: len(self._sessions) - self.max_entries]:
                self._sessions.pop(item.session_id, None)

    def _session_expiry(self, expires_at: str) -> float:
        local_expiry = time.time() + self.session_ttl_seconds
        try:
            parsed = datetime.fromisoformat(str(expires_at).replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return min(local_expiry, parsed.timestamp())
        except (TypeError, ValueError, OverflowError):
            return local_expiry

    def create_pending(self, redirect_uri: str) -> PendingAuthorization:
        with self._lock:
            self._purge()
            state = secrets.token_urlsafe(32)
            pending = PendingAuthorization(
                state=state,
                redirect_uri=redirect_uri,
                expires_at=time.time() + self.pending_ttl_seconds,
            )
            self._pending[state] = pending
            return pending

    def consume_pending(self, state: str) -> PendingAuthorization | None:
        with self._lock:
            self._purge()
            pending = self._pending.pop(str(state or ""), None)
            if not pending or pending.expires_at <= time.time():
                return None
            return pending

    def create_session(self, *, timeblock_token: str, principal: dict[str, Any], scope: list[str], expires_at: str) -> BffSession:
        with self._lock:
            self._purge()
            session_id = secrets.token_urlsafe(32)
            session = BffSession(
                session_id=session_id,
                timeblock_token=timeblock_token,
                principal=dict(principal),
                scope=tuple(scope),
                expires_at=self._session_expiry(expires_at),
            )
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str | None) -> BffSession | None:
        with self._lock:
            self._purge()
            session = self._sessions.get(str(session_id or ""))
            if not session or session.expires_at <= time.time():
                return None
            return session

    def replace_token(self, session_id: str, *, timeblock_token: str, principal: dict[str, Any], scope: list[str], expires_at: str = '') -> BffSession | None:
        with self._lock:
            current = self._sessions.get(session_id)
            if not current:
                return None
            updated = BffSession(
                session_id=current.session_id,
                timeblock_token=timeblock_token,
                principal=dict(principal),
                scope=tuple(scope),
                expires_at=self._session_expiry(expires_at),
            )
            self._sessions[session_id] = updated
            return updated

    def delete(self, session_id: str | None) -> None:
        with self._lock:
            self._sessions.pop(str(session_id or ""), None)
