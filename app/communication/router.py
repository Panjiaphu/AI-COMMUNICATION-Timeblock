from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from app.communication.manager import RoomManagerError
from app.communication.schemas import EventEnvelope, EventName
from app.integrations.timeblock.client import TimeblockIntegrationError

logger = logging.getLogger('guilua.communication')
router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parents[1] / 'templates')


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def server_event(event_name: str, session_id: str, connection_id: str, trace_id: str, **payload) -> dict:
    return {
        'event_name': event_name,
        'event_version': 1,
        'event_id': str(uuid4()),
        'session_id': session_id,
        'connection_id': connection_id,
        'trace_id': trace_id,
        'timestamp': now_iso(),
        **payload,
    }


async def send_error(
    websocket: WebSocket,
    *,
    code: str,
    session_id: str,
    connection_id: str,
    trace_id: str,
) -> None:
    await websocket.send_json(server_event('error', session_id, connection_id, trace_id, code=code))


def log_event(result: str, **fields) -> None:
    logger.info('communication_runtime', extra={'result': result, **fields})


@router.get('/', response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name='home.html', context={})


@router.get('/communication', response_class=HTMLResponse)
async def communication(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name='communication.html', context={})


@router.websocket('/ws/communication/{session_id}')
async def communication_socket(websocket: WebSocket, session_id: str) -> None:
    settings = websocket.app.state.settings
    manager = websocket.app.state.room_manager
    origin = websocket.headers.get('origin')
    trace_id = websocket.query_params.get('trace_id') or str(uuid4())
    participant_id = websocket.query_params.get('participant_id', '')
    token = websocket.query_params.get('token', '')
    reconnect_token = websocket.query_params.get('reconnect_token')

    if not origin and not settings.allow_missing_websocket_origin:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='origin_required')
        return
    if origin and origin not in settings.websocket_origins:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='origin_not_allowed')
        return
    if not token or not participant_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='authorization_required')
        return

    try:
        if reconnect_token:
            authorized = await websocket.app.state.timeblock_client.refresh_session(session_id, token, participant_id)
        else:
            authorized = await websocket.app.state.timeblock_client.authorize_session(session_id, token, participant_id)
        result = await manager.connect(authorized, websocket, trace_id, reconnect_token)
    except (TimeblockIntegrationError, RoomManagerError) as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=str(exc))
        log_event('connection_rejected', trace_id=trace_id, session_id=session_id, participant_id=participant_id, error_code=str(exc))
        return

    connection = result.connection
    log_event(
        'participant_reconnected' if result.reconnected else 'participant_joined',
        trace_id=trace_id,
        session_id=session_id,
        room_id=result.snapshot.room_id,
        workspace_id=result.snapshot.workspace_id,
        participant_id=authorized.participant_id,
        connection_id=connection.connection_id,
        event_name='session.authorized',
        event_version=1,
        deployment_version=settings.deployment_version,
    )
    await websocket.send_json(
        server_event(
            'session.authorized',
            session_id,
            connection.connection_id,
            trace_id,
            participant_id=authorized.participant_id,
            reconnect_token=result.reconnect_token,
            reconnected=result.reconnected,
            snapshot=result.snapshot.model_dump(mode='json'),
        )
    )
    await manager.broadcast(
        session_id,
        server_event(
            'participant.reconnected' if result.reconnected else 'participant.joined',
            session_id,
            connection.connection_id,
            trace_id,
            participant_id=authorized.participant_id,
        ),
        exclude_connection_id=connection.connection_id,
    )

    try:
        while True:
            raw_text = await websocket.receive_text()
            if len(raw_text.encode('utf-8')) > settings.max_event_bytes:
                await send_error(websocket, code='event_too_large', session_id=session_id, connection_id=connection.connection_id, trace_id=trace_id)
                continue
            try:
                raw_event = json.loads(raw_text)
                event = EventEnvelope.model_validate(raw_event)
            except (json.JSONDecodeError, ValidationError):
                await send_error(websocket, code='invalid_event', session_id=session_id, connection_id=connection.connection_id, trace_id=trace_id)
                continue
            if (
                event.session_id != session_id
                or event.connection_id != connection.connection_id
                or event.participant_id != authorized.participant_id
            ):
                await send_error(websocket, code='event_binding_failed', session_id=session_id, connection_id=connection.connection_id, trace_id=trace_id)
                continue
            accepted, error = await manager.handle_event(event)
            if not accepted:
                await send_error(websocket, code=error or 'event_rejected', session_id=session_id, connection_id=connection.connection_id, trace_id=trace_id)
                log_event('event_rejected', trace_id=trace_id, session_id=session_id, participant_id=authorized.participant_id, connection_id=connection.connection_id, event_name=event.event_name, event_version=event.event_version, error_code=error)
                continue
            if event.event_name == EventName.HEARTBEAT:
                await websocket.send_json(server_event('connection.ack', session_id, connection.connection_id, trace_id, acknowledged_event_id=str(event.event_id)))
                continue
            if event.event_name in {EventName.SIGNALING_OFFER, EventName.SIGNALING_ANSWER, EventName.SIGNALING_ICE}:
                payload = event.typed_payload()
                try:
                    await manager.send_to_participant(
                        session_id,
                        authorized.participant_id,
                        payload.target_participant_id,
                        event.model_dump(mode='json'),
                    )
                except RoomManagerError as exc:
                    await send_error(websocket, code=exc.code, session_id=session_id, connection_id=connection.connection_id, trace_id=trace_id)
                continue
            if event.event_name in {EventName.SESSION_LEAVE, EventName.SESSION_ENDED}:
                break
            await manager.broadcast(session_id, event.model_dump(mode='json'), connection.connection_id)
    except WebSocketDisconnect:
        log_event('connection_closed', trace_id=trace_id, session_id=session_id, participant_id=authorized.participant_id, connection_id=connection.connection_id)
    finally:
        participant = await manager.disconnect(session_id, connection.connection_id)
        if participant:
            await manager.broadcast(
                session_id,
                server_event('participant.left', session_id, connection.connection_id, trace_id, participant_id=authorized.participant_id),
            )
