from __future__ import annotations

import hashlib
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
    session_kind: str = "direct"
    handoff_id: str = ""
    surface: str = ""
    entitlement: dict[str, Any] | None = None


@dataclass(slots=True)
class PendingAuthorization:
    state: str
    redirect_uri: str
    browser_nonce_hash: str
    expires_at: float


class PendingAuthorizationRateLimited(RuntimeError):
    def __init__(self, retry_after: int):
        super().__init__("authorization_rate_limited")
        self.retry_after = max(1, int(retry_after))


class PendingAuthorizationCapacityExceeded(RuntimeError):
    def __init__(self, retry_after: int):
        super().__init__("authorization_capacity_reached")
        self.retry_after = max(1, int(retry_after))


class SessionStore:
    """Small bounded process-local store for opaque browser sessions.

    Guilua must not become a durable identity store. A Render restart expires
    these sessions and the browser is required to authorize again through
    Timeblock. Only the opaque session ID is sent to the browser.
    """

    def __init__(
        self,
        *,
        session_ttl_seconds: int,
        pending_ttl_seconds: int,
        max_entries: int = 10_000,
        max_pending_entries: int = 2_000,
        pending_rate_limit_count: int = 12,
        pending_rate_limit_window_seconds: int = 60,
    ):
        self.session_ttl_seconds = max(300, int(session_ttl_seconds))
        self.pending_ttl_seconds = max(60, int(pending_ttl_seconds))
        self.max_entries = max(100, int(max_entries))
        self.max_pending_entries = max(1, int(max_pending_entries))
        self.pending_rate_limit_count = max(1, int(pending_rate_limit_count))
        self.pending_rate_limit_window_seconds = max(
            1, int(pending_rate_limit_window_seconds)
        )
        self._sessions: dict[str, BffSession] = {}
        self._pending: dict[str, PendingAuthorization] = {}
        self._pending_attempts: dict[str, list[float]] = {}
        self._lock = RLock()

    @staticmethod
    def _nonce_hash(value: str) -> str:
        return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()

    def _enforce_bounds(self) -> None:
        if len(self._sessions) > self.max_entries:
            ordered_sessions = sorted(self._sessions.values(), key=lambda item: item.expires_at)
            for item in ordered_sessions[: len(self._sessions) - self.max_entries]:
                self._sessions.pop(item.session_id, None)
        maximum_rate_keys = max(100, self.max_pending_entries)
        if len(self._pending_attempts) > maximum_rate_keys:
            ordered_keys = sorted(
                self._pending_attempts,
                key=lambda key: self._pending_attempts[key][-1]
                if self._pending_attempts[key]
                else 0,
            )
            for key in ordered_keys[: len(self._pending_attempts) - maximum_rate_keys]:
                self._pending_attempts.pop(key, None)

    def _purge(self) -> None:
        now = time.time()
        self._sessions = {
            key: value for key, value in self._sessions.items() if value.expires_at > now
        }
        self._pending = {
            key: value for key, value in self._pending.items() if value.expires_at > now
        }
        rate_cutoff = now - self.pending_rate_limit_window_seconds
        self._pending_attempts = {
            key: [attempt for attempt in attempts if attempt > rate_cutoff]
            for key, attempts in self._pending_attempts.items()
            if any(attempt > rate_cutoff for attempt in attempts)
        }
        self._enforce_bounds()

    def _session_expiry(self, expires_at: str) -> float:
        local_expiry = time.time() + self.session_ttl_seconds
        try:
            parsed = datetime.fromisoformat(str(expires_at).replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return min(local_expiry, parsed.timestamp())
        except (TypeError, ValueError, OverflowError):
            return local_expiry

    def create_pending(
        self,
        redirect_uri: str,
        *,
        browser_nonce: str | None = None,
        client_key: str = "unknown",
    ) -> tuple[PendingAuthorization, str]:
        with self._lock:
            self._purge()
            now = time.time()
            rate_key = str(client_key or "unknown")[:256]
            attempts = self._pending_attempts.setdefault(rate_key, [])
            if len(attempts) >= self.pending_rate_limit_count:
                retry_after = self.pending_rate_limit_window_seconds - int(
                    now - attempts[0]
                )
                raise PendingAuthorizationRateLimited(retry_after)
            attempts.append(now)
            if len(self._pending) >= self.max_pending_entries:
                earliest_expiry = min(item.expires_at for item in self._pending.values())
                raise PendingAuthorizationCapacityExceeded(int(earliest_expiry - now) + 1)
            state = secrets.token_urlsafe(32)
            supplied_nonce = str(browser_nonce or "")
            if not 32 <= len(supplied_nonce) <= 256:
                supplied_nonce = secrets.token_urlsafe(32)
            pending = PendingAuthorization(
                state=state,
                redirect_uri=redirect_uri,
                browser_nonce_hash=self._nonce_hash(supplied_nonce),
                expires_at=now + self.pending_ttl_seconds,
            )
            self._pending[state] = pending
            self._enforce_bounds()
            return pending, supplied_nonce

    def consume_pending(self, state: str, browser_nonce: str | None) -> PendingAuthorization | None:
        with self._lock:
            self._purge()
            state_key = str(state or "")
            pending = self._pending.get(state_key)
            supplied_hash = self._nonce_hash(str(browser_nonce or ""))
            if (
                not pending
                or pending.expires_at <= time.time()
                or not browser_nonce
                or not secrets.compare_digest(pending.browser_nonce_hash, supplied_hash)
            ):
                return None
            self._pending.pop(state_key, None)
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
                session_kind="direct",
            )
            self._sessions[session_id] = session
            self._enforce_bounds()
            return session

    def create_group_session(
        self,
        *,
        principal: dict[str, Any],
        scope: list[str],
        expires_at: str,
        handoff_id: str,
        surface: str,
        entitlement: dict[str, Any],
    ) -> BffSession:
        with self._lock:
            self._purge()
            session_id = secrets.token_urlsafe(32)
            session = BffSession(
                session_id=session_id,
                timeblock_token="",
                principal=dict(principal),
                scope=tuple(scope),
                expires_at=self._session_expiry(expires_at),
                session_kind="group",
                handoff_id=str(handoff_id),
                surface=str(surface),
                entitlement=dict(entitlement),
            )
            self._sessions[session_id] = session
            self._enforce_bounds()
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
                session_kind=current.session_kind,
                handoff_id=current.handoff_id,
                surface=current.surface,
                entitlement=dict(current.entitlement or {}),
            )
            self._sessions[session_id] = updated
            return updated

    def delete(self, session_id: str | None) -> None:
        with self._lock:
            self._sessions.pop(str(session_id or ""), None)
