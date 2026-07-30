from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from app.communication.schemas import EventEnvelope


@dataclass(slots=True)
class ConnectionState:
    connection_id: str
    participant_id: str
    websocket: WebSocket
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_sequence: int = 0


@dataclass(slots=True)
class RoomState:
    session_id: str
    room_id: str
    workspace_id: str
    status: str = "connecting"
    connections: dict[str, ConnectionState] = field(default_factory=dict)
    processed_events: dict[str, datetime] = field(default_factory=dict)


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, workspace_id: str, participant_id: str, websocket: WebSocket) -> ConnectionState:
        await websocket.accept()
        async with self._lock:
            room = self.rooms.setdefault(
                session_id,
                RoomState(session_id=session_id, room_id=f"room-{session_id}", workspace_id=workspace_id),
            )
            connection = ConnectionState(
                connection_id=str(uuid4()),
                participant_id=participant_id,
                websocket=websocket,
            )
            room.connections[connection.connection_id] = connection
            room.status = "active"
            return connection

    async def disconnect(self, session_id: str, connection_id: str) -> None:
        async with self._lock:
            room = self.rooms.get(session_id)
            if not room:
                return
            room.connections.pop(connection_id, None)
            if not room.connections:
                room.status = "ended"

    async def handle_event(self, event: EventEnvelope) -> tuple[bool, str | None]:
        room = self.rooms.get(event.session_id)
        if room is None:
            return False, "unknown_session"
        connection = room.connections.get(event.connection_id)
        if connection is None or connection.participant_id != event.participant_id:
            return False, "stale_connection"
        event_key = str(event.event_id)
        if event_key in room.processed_events:
            return False, "duplicate_event"
        if event.sequence_number <= connection.last_sequence:
            return False, "out_of_order"
        connection.last_sequence = event.sequence_number
        connection.last_seen = datetime.now(timezone.utc)
        room.processed_events[event_key] = connection.last_seen
        return True, None

    async def broadcast(self, session_id: str, payload: dict[str, Any], exclude_connection_id: str | None = None) -> None:
        room = self.rooms.get(session_id)
        if not room:
            return
        stale: list[str] = []
        for connection_id, connection in list(room.connections.items()):
            if connection_id == exclude_connection_id:
                continue
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                stale.append(connection_id)
        for connection_id in stale:
            await self.disconnect(session_id, connection_id)

    async def cleanup(self) -> None:
        now = datetime.now(timezone.utc)
        stale_before = now - timedelta(seconds=120)
        event_before = now - timedelta(seconds=1800)
        async with self._lock:
            for session_id, room in list(self.rooms.items()):
                for connection_id, connection in list(room.connections.items()):
                    if connection.last_seen < stale_before:
                        room.connections.pop(connection_id, None)
                room.processed_events = {
                    event_id: seen_at for event_id, seen_at in room.processed_events.items() if seen_at >= event_before
                }
                if not room.connections and room.status == "ended":
                    self.rooms.pop(session_id, None)


room_manager = RoomManager()
