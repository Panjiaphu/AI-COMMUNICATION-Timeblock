from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class GroupEvent:
    event_id: str
    event_type: str
    space_id: str
    resource_id: str

    def as_dict(self) -> dict[str, str]:
        return {
            "event_id": self.event_id,
            "type": self.event_type,
            "space_id": self.space_id,
            "resource_id": self.resource_id,
        }


class GroupEventBroker:
    """Process-local fan-out for non-secret Group invalidation events.

    PostgreSQL remains the source of truth. Events only tell authorized clients
    to re-read a space through the normal Group APIs.
    """

    def __init__(self, *, queue_size: int = 32) -> None:
        self._queue_size = max(1, queue_size)
        self._subscribers: dict[str, set[asyncio.Queue[GroupEvent]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def subscribe(self, space_id: str) -> AsyncIterator[asyncio.Queue[GroupEvent]]:
        queue: asyncio.Queue[GroupEvent] = asyncio.Queue(maxsize=self._queue_size)
        async with self._lock:
            self._subscribers[space_id].add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(space_id)
                if subscribers is not None:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(space_id, None)

    async def publish(
        self,
        space_id: str,
        event_type: str,
        *,
        resource_id: Any = "",
    ) -> None:
        event = GroupEvent(
            event_id=uuid4().hex,
            event_type=str(event_type or "group.changed")[:80],
            space_id=str(space_id),
            resource_id=str(resource_id or "")[:80],
        )
        async with self._lock:
            subscribers = tuple(self._subscribers.get(space_id, ()))
        for queue in subscribers:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass
