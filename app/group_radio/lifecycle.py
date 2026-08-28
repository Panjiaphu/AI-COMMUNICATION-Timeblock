"""Radio teardown and resource-zero contract."""

from __future__ import annotations

from dataclasses import dataclass, field


RADIO_RESOURCES = frozenset(
    {"mic", "remote_audio", "provider", "floor", "tts", "stt", "timers", "listeners"}
)


@dataclass(slots=True)
class RadioResourceLedger:
    """Provider-neutral registry that makes teardown observable and idempotent."""

    generation: str
    _resources: dict[str, set[str]] = field(default_factory=dict)
    terminated: bool = False

    def __post_init__(self) -> None:
        self.generation = str(self.generation or "").strip()
        if not self.generation:
            raise ValueError("generation_required")
        self._resources = {name: set() for name in RADIO_RESOURCES}

    def register(self, kind: str, handle: str) -> bool:
        if self.terminated or kind not in RADIO_RESOURCES:
            return False
        normalized = str(handle or "").strip()
        if not normalized:
            return False
        self._resources[kind].add(normalized)
        return True

    def release(self, kind: str, handle: str) -> bool:
        if kind not in RADIO_RESOURCES:
            return False
        normalized = str(handle or "").strip()
        if normalized not in self._resources[kind]:
            return False
        self._resources[kind].remove(normalized)
        return True

    def terminate(self) -> dict[str, object]:
        if not self.terminated:
            # Mark first so late callbacks cannot register new resources.
            self.terminated = True
            for handles in self._resources.values():
                handles.clear()
        return self.snapshot()

    def snapshot(self) -> dict[str, object]:
        counts = {kind: len(handles) for kind, handles in self._resources.items()}
        return {
            "generation": self.generation,
            "terminated": self.terminated,
            "resources": counts,
            "resource_zero": all(value == 0 for value in counts.values()),
        }


@dataclass(slots=True)
class RadioRoomCapacity:
    max_rooms: int = 20
    active: set[str] = field(default_factory=set)

    def acquire(self, session_id: str) -> bool:
        normalized = str(session_id or "").strip()
        if not normalized:
            raise ValueError("session_id_required")
        if normalized in self.active:
            return True
        if len(self.active) >= self.max_rooms:
            raise ValueError("radio_room_capacity_exceeded")
        self.active.add(normalized)
        return True

    def release(self, session_id: str) -> bool:
        self.active.discard(str(session_id or "").strip())
        return True

    def snapshot(self) -> dict[str, object]:
        return {"active_rooms": len(self.active), "max_rooms": self.max_rooms}
