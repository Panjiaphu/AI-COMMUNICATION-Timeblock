"""Single-owner Group Radio floor lease.

The floor is intentionally ephemeral and process-local.  Timeblock remains
the authority for room membership; this manager only arbitrates one active
speaker per runtime instance and provides deterministic release/expiry hooks.
"""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GroupRadioFloorError(RuntimeError):
    def __init__(self, code: str):
        self.code = str(code)
        super().__init__(self.code)


@dataclass(frozen=True, slots=True)
class FloorLease:
    room_id: str
    participant_id: str
    generation: str
    lease_id: str
    state: str
    acquired_at: datetime
    expires_at: datetime
    max_burst_seconds: int

    @property
    def remaining_seconds(self) -> int:
        return max(0, int((self.expires_at - utcnow()).total_seconds()))


class RadioFloorManager:
    """Concurrency-safe floor arbitration with idempotent release."""

    def __init__(self, *, lease_seconds: int = 15, max_burst_seconds: int = 30):
        self.lease_seconds = max(5, min(120, int(lease_seconds)))
        self.max_burst_seconds = max(5, min(300, int(max_burst_seconds)))
        self._leases: dict[str, FloorLease] = {}
        self._released: dict[str, str] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _identity(value: str, field: str) -> str:
        normalized = str(value or "").strip()
        if not normalized or len(normalized) > 160:
            raise GroupRadioFloorError(f"invalid_{field}")
        return normalized

    def _purge_expired_locked(self, now: datetime) -> None:
        for room_id, lease in list(self._leases.items()):
            if lease.expires_at <= now:
                self._leases.pop(room_id, None)
                self._released[lease.lease_id] = "expired"

    async def acquire(self, room_id: str, participant_id: str, generation: str) -> FloorLease:
        room = self._identity(room_id, "room_id")
        participant = self._identity(participant_id, "participant_id")
        attempt = self._identity(generation, "generation")
        async with self._lock:
            now = utcnow()
            self._purge_expired_locked(now)
            existing = self._leases.get(room)
            if existing:
                if existing.participant_id == participant and existing.generation == attempt:
                    return existing
                raise GroupRadioFloorError("floor_busy")
            lease = FloorLease(
                room_id=room,
                participant_id=participant,
                generation=attempt,
                lease_id=secrets.token_urlsafe(18),
                state="TALKING",
                acquired_at=now,
                expires_at=now + timedelta(seconds=self.lease_seconds),
                max_burst_seconds=self.max_burst_seconds,
            )
            self._leases[room] = lease
            return lease

    async def heartbeat(self, room_id: str, lease_id: str) -> FloorLease:
        room = self._identity(room_id, "room_id")
        lease = self._identity(lease_id, "lease_id")
        async with self._lock:
            now = utcnow()
            self._purge_expired_locked(now)
            current = self._leases.get(room)
            if not current or current.lease_id != lease:
                raise GroupRadioFloorError("floor_not_owned")
            if (now - current.acquired_at).total_seconds() >= current.max_burst_seconds:
                raise GroupRadioFloorError("burst_limit_exceeded")
            updated = FloorLease(
                room_id=current.room_id,
                participant_id=current.participant_id,
                generation=current.generation,
                lease_id=current.lease_id,
                state=current.state,
                acquired_at=current.acquired_at,
                expires_at=now + timedelta(seconds=self.lease_seconds),
                max_burst_seconds=current.max_burst_seconds,
            )
            self._leases[room] = updated
            return updated

    async def finalize(self, room_id: str, lease_id: str) -> dict:
        """Release the floor before downstream STT/translation/TTS work."""

        room = self._identity(room_id, "room_id")
        lease = self._identity(lease_id, "lease_id")
        async with self._lock:
            current = self._leases.get(room)
            if not current:
                if self._released.get(lease):
                    return {"status": "released", "lease_id": lease, "room_id": room}
                raise GroupRadioFloorError("floor_not_owned")
            if current.lease_id != lease:
                raise GroupRadioFloorError("floor_not_owned")
            self._leases.pop(room, None)
            self._released[lease] = "released"
            return {
                "status": "released",
                "state": "FINALIZING_BURST",
                "lease_id": lease,
                "room_id": room,
                "participant_id": current.participant_id,
                "generation": current.generation,
                "burst_seconds": max(0.0, (utcnow() - current.acquired_at).total_seconds()),
            }

    async def leave(self, room_id: str, lease_id: str | None = None) -> dict:
        room = self._identity(room_id, "room_id")
        async with self._lock:
            current = self._leases.get(room)
            if not current:
                return {"status": "ready", "room_id": room}
            if lease_id and current.lease_id != str(lease_id).strip():
                raise GroupRadioFloorError("floor_not_owned")
            self._leases.pop(room, None)
            self._released[current.lease_id] = "left"
            return {"status": "ready", "room_id": room, "lease_id": current.lease_id}

    async def snapshot(self, room_id: str) -> dict:
        room = self._identity(room_id, "room_id")
        async with self._lock:
            self._purge_expired_locked(utcnow())
            current = self._leases.get(room)
            if not current:
                return {"room_id": room, "state": "READY", "active": False}
            return {
                "room_id": room,
                "state": current.state,
                "active": True,
                "participant_id": current.participant_id,
                "generation": current.generation,
                "lease_id": current.lease_id,
                "expires_at": current.expires_at.isoformat(),
                "remaining_seconds": current.remaining_seconds,
            }

    async def cleanup(self) -> int:
        async with self._lock:
            before = len(self._leases)
            self._purge_expired_locked(utcnow())
            return before - len(self._leases)

    async def reset(self) -> None:
        async with self._lock:
            self._leases.clear()
            self._released.clear()
