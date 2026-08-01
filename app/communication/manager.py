from __future__ import annotations

import asyncio
import hashlib
import secrets
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from app.communication.schemas import AuthorizedSession, EventEnvelope, EventName, RoomSnapshot, SessionStatus
from app.core.config import Settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RoomManagerError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(slots=True)
class ConnectionState:
    connection_id: str
    participant_id: str
    websocket: WebSocket
    connected_at: datetime = field(default_factory=utcnow)
    last_seen: datetime = field(default_factory=utcnow)
    last_sequence_number: int = 0
    event_times: deque[datetime] = field(default_factory=deque)
    signaling_times: deque[datetime] = field(default_factory=deque)
    heartbeat_times: deque[datetime] = field(default_factory=deque)


@dataclass(slots=True)
class ParticipantState:
    participant_id: str
    active_connection_id: str | None
    joined_at: datetime = field(default_factory=utcnow)
    disconnected_at: datetime | None = None
    media_state: dict[str, bool] = field(default_factory=lambda: {'muted': False, 'camera_enabled': True})
    last_sequence_number: int = 0


@dataclass(slots=True)
class ReconnectState:
    token_hash: str
    session_id: str
    participant_id: str
    previous_connection_id: str
    expires_at: datetime
    used_at: datetime | None = None


@dataclass(slots=True)
class RoomState:
    session_id: str
    room_id: str
    workspace_id: str
    status: SessionStatus
    mode: str
    source_language: str
    target_language: str
    trace_id: str
    created_at: datetime = field(default_factory=utcnow)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    participants: dict[str, ParticipantState] = field(default_factory=dict)
    connections: dict[str, ConnectionState] = field(default_factory=dict)
    processed_events: dict[str, datetime] = field(default_factory=dict)


@dataclass(slots=True)
class ConnectionResult:
    connection: ConnectionState
    reconnect_token: str
    snapshot: RoomSnapshot
    reconnected: bool
    replaced_websocket: WebSocket | None = None


class RoomManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.rooms: dict[str, RoomState] = {}
        self.reconnect_tokens: dict[str, ReconnectState] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode('utf-8')).hexdigest()

    def _issue_reconnect_token(self, session_id: str, participant_id: str, connection_id: str) -> str:
        raw_token = secrets.token_urlsafe(32)
        token_hash = self._token_hash(raw_token)
        self.reconnect_tokens[token_hash] = ReconnectState(
            token_hash=token_hash,
            session_id=session_id,
            participant_id=participant_id,
            previous_connection_id=connection_id,
            expires_at=utcnow() + timedelta(seconds=self.settings.reconnect_token_seconds),
        )
        return raw_token

    def _snapshot(self, room: RoomState) -> RoomSnapshot:
        return RoomSnapshot(
            session_id=room.session_id,
            room_id=room.room_id,
            workspace_id=room.workspace_id,
            status=room.status,
            mode=room.mode,
            source_language=room.source_language,
            target_language=room.target_language,
            participants=sorted(room.participants),
            trace_id=room.trace_id,
        )

    async def connect(
        self,
        authorized: AuthorizedSession,
        websocket: WebSocket,
        trace_id: str,
        reconnect_token: str | None = None,
    ) -> ConnectionResult:
        replaced_websocket: WebSocket | None = None
        now = utcnow()
        async with self._lock:
            room = self.rooms.get(authorized.session_id)
            if room is None:
                room = RoomState(
                    session_id=authorized.session_id,
                    room_id=authorized.room_id,
                    workspace_id=authorized.workspace_id,
                    status=SessionStatus.CREATED,
                    mode=authorized.mode,
                    source_language=authorized.source_language,
                    target_language=authorized.target_language,
                    trace_id=trace_id,
                )
                self.rooms[authorized.session_id] = room
            elif room.workspace_id != authorized.workspace_id or room.room_id != authorized.room_id:
                raise RoomManagerError('session_boundary_mismatch')
            elif room.status in {SessionStatus.ENDING, SessionStatus.ENDED, SessionStatus.FAILED, SessionStatus.EXPIRED}:
                raise RoomManagerError('session_not_joinable')

            participant = room.participants.get(authorized.participant_id)
            reconnected = False
            if reconnect_token:
                token_state = self.reconnect_tokens.get(self._token_hash(reconnect_token))
                if token_state is None:
                    raise RoomManagerError('invalid_reconnect_token')
                if token_state.used_at is not None:
                    raise RoomManagerError('reconnect_token_used')
                if token_state.expires_at <= now:
                    raise RoomManagerError('reconnect_token_expired')
                if token_state.session_id != authorized.session_id or token_state.participant_id != authorized.participant_id:
                    raise RoomManagerError('reconnect_boundary_mismatch')
                token_state.used_at = now
                reconnected = True
                if participant and participant.active_connection_id:
                    old_connection = room.connections.pop(participant.active_connection_id, None)
                    if old_connection:
                        replaced_websocket = old_connection.websocket
            else:
                if participant and participant.active_connection_id in room.connections:
                    raise RoomManagerError('duplicate_participant')
                if participant is None and len(room.participants) >= self.settings.max_room_participants:
                    raise RoomManagerError('room_full')

            connection = ConnectionState(
                connection_id=str(uuid4()),
                participant_id=authorized.participant_id,
                websocket=websocket,
            )
            room.connections[connection.connection_id] = connection
            if participant is None:
                participant = ParticipantState(
                    participant_id=authorized.participant_id,
                    active_connection_id=connection.connection_id,
                )
                room.participants[authorized.participant_id] = participant
            else:
                participant.active_connection_id = connection.connection_id
                participant.disconnected_at = None
            room.status = SessionStatus.ACTIVE if room.connections else SessionStatus.CONNECTING
            room.started_at = room.started_at or now
            reconnect_token_out = self._issue_reconnect_token(
                authorized.session_id,
                authorized.participant_id,
                connection.connection_id,
            )
            snapshot = self._snapshot(room)

        await websocket.accept()
        if replaced_websocket is not None:
            try:
                await replaced_websocket.close(code=4001, reason='connection_replaced')
            except Exception:
                pass
        return ConnectionResult(connection, reconnect_token_out, snapshot, reconnected, replaced_websocket)

    async def disconnect(self, session_id: str, connection_id: str) -> ParticipantState | None:
        async with self._lock:
            room = self.rooms.get(session_id)
            if not room:
                return None
            connection = room.connections.pop(connection_id, None)
            if connection is None:
                return None
            participant = room.participants.get(connection.participant_id)
            if participant and participant.active_connection_id == connection_id:
                participant.active_connection_id = None
                participant.disconnected_at = utcnow()
                participant.last_sequence_number = max(participant.last_sequence_number, connection.last_sequence_number)
            if not room.connections and room.status not in {SessionStatus.ENDING, SessionStatus.ENDED}:
                room.status = SessionStatus.RECONNECTING
            return participant

    @staticmethod
    def _prune_window(values: deque[datetime], threshold: datetime) -> None:
        while values and values[0] < threshold:
            values.popleft()

    def _check_rate_limit(self, connection: ConnectionState, event: EventEnvelope, now: datetime) -> str | None:
        threshold = now - timedelta(seconds=self.settings.event_rate_limit_window_seconds)
        self._prune_window(connection.event_times, threshold)
        self._prune_window(connection.signaling_times, threshold)
        self._prune_window(connection.heartbeat_times, threshold)
        if len(connection.event_times) >= self.settings.event_rate_limit_count:
            return 'rate_limited'
        if event.event_name in {EventName.SIGNALING_OFFER, EventName.SIGNALING_ANSWER, EventName.SIGNALING_ICE}:
            if len(connection.signaling_times) >= self.settings.signaling_rate_limit_count:
                return 'signaling_rate_limited'
            connection.signaling_times.append(now)
        if event.event_name == EventName.HEARTBEAT:
            if len(connection.heartbeat_times) >= self.settings.heartbeat_rate_limit_count:
                return 'heartbeat_rate_limited'
            connection.heartbeat_times.append(now)
        connection.event_times.append(now)
        return None

    async def handle_event(self, event: EventEnvelope) -> tuple[bool, str | None]:
        now = utcnow()
        async with self._lock:
            room = self.rooms.get(event.session_id)
            if room is None:
                return False, 'unknown_session'
            connection = room.connections.get(event.connection_id)
            if connection is None or connection.participant_id != event.participant_id:
                return False, 'stale_connection'
            rate_error = self._check_rate_limit(connection, event, now)
            if rate_error:
                return False, rate_error
            event_key = str(event.event_id)
            if event_key in room.processed_events:
                return False, 'duplicate_event'
            if event.sequence_number <= connection.last_sequence_number:
                return False, 'out_of_order'
            connection.last_sequence_number = event.sequence_number
            connection.last_seen = now
            participant = room.participants[event.participant_id]
            participant.last_sequence_number = event.sequence_number
            room.processed_events[event_key] = now
            if event.event_name == EventName.MEDIA_MUTED:
                participant.media_state['muted'] = True
            elif event.event_name == EventName.MEDIA_UNMUTED:
                participant.media_state['muted'] = False
            elif event.event_name == EventName.CAMERA_ENABLED:
                participant.media_state['camera_enabled'] = True
            elif event.event_name == EventName.CAMERA_DISABLED:
                participant.media_state['camera_enabled'] = False
            elif event.event_name == EventName.SESSION_ENDING:
                room.status = SessionStatus.ENDING
            elif event.event_name == EventName.SESSION_ENDED:
                room.status = SessionStatus.ENDED
                room.ended_at = now
            return True, None

    async def get_target_connection(
        self, session_id: str, sender_participant_id: str, target_participant_id: str
    ) -> ConnectionState:
        async with self._lock:
            room = self.rooms.get(session_id)
            if not room:
                raise RoomManagerError('unknown_session')
            if sender_participant_id == target_participant_id:
                raise RoomManagerError('self_target')
            sender = room.participants.get(sender_participant_id)
            target = room.participants.get(target_participant_id)
            if sender is None or sender.active_connection_id not in room.connections:
                raise RoomManagerError('stale_sender')
            if target is None or target.active_connection_id not in room.connections:
                raise RoomManagerError('stale_target')
            return room.connections[target.active_connection_id]

    async def send_to_participant(
        self,
        session_id: str,
        sender_participant_id: str,
        target_participant_id: str,
        payload: dict[str, Any],
    ) -> None:
        target = await self.get_target_connection(session_id, sender_participant_id, target_participant_id)
        try:
            await target.websocket.send_json(payload)
        except Exception as exc:
            await self.disconnect(session_id, target.connection_id)
            raise RoomManagerError('target_send_failed') from exc

    async def broadcast(
        self,
        session_id: str,
        payload: dict[str, Any],
        exclude_connection_id: str | None = None,
    ) -> None:
        async with self._lock:
            room = self.rooms.get(session_id)
            targets = [
                connection
                for connection_id, connection in (room.connections.items() if room else [])
                if connection_id != exclude_connection_id
            ]
        stale: list[str] = []
        for connection in targets:
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                stale.append(connection.connection_id)
        for connection_id in stale:
            await self.disconnect(session_id, connection_id)

    async def cleanup(self) -> None:
        now = utcnow()
        stale_before = now - timedelta(seconds=self.settings.connection_stale_seconds)
        event_before = now - timedelta(seconds=self.settings.idempotency_cache_seconds)
        ended_before = now - timedelta(seconds=self.settings.ended_session_cache_seconds)
        close_targets: list[WebSocket] = []
        async with self._lock:
            for token_hash, token in list(self.reconnect_tokens.items()):
                if token.expires_at <= now or token.used_at is not None:
                    self.reconnect_tokens.pop(token_hash, None)
            for session_id, room in list(self.rooms.items()):
                for connection_id, connection in list(room.connections.items()):
                    if connection.last_seen < stale_before:
                        room.connections.pop(connection_id, None)
                        close_targets.append(connection.websocket)
                        participant = room.participants.get(connection.participant_id)
                        if participant and participant.active_connection_id == connection_id:
                            participant.active_connection_id = None
                            participant.disconnected_at = now
                room.processed_events = {
                    event_id: seen_at for event_id, seen_at in room.processed_events.items() if seen_at >= event_before
                }
                if not room.connections and room.status not in {SessionStatus.ENDED, SessionStatus.FAILED, SessionStatus.EXPIRED}:
                    has_reconnect = any(
                        token.session_id == session_id and token.used_at is None and token.expires_at > now
                        for token in self.reconnect_tokens.values()
                    )
                    if not has_reconnect:
                        room.status = SessionStatus.ENDED
                        room.ended_at = room.ended_at or now
                if room.status == SessionStatus.ENDED and room.ended_at and room.ended_at < ended_before:
                    self.rooms.pop(session_id, None)
        for websocket in close_targets:
            try:
                await websocket.close(code=4000, reason='connection_stale')
            except Exception:
                pass

    async def reset(self) -> None:
        async with self._lock:
            self.rooms.clear()
            self.reconnect_tokens.clear()
