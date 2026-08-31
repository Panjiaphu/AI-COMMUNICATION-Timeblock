from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from app.communication.manager import RoomManagerError
from app.communication.schemas import AuthenticationEnvelope, EventEnvelope, EventName
from app.core.communication_i18n import communication_copy
from app.core.timeblock_i18n import resolve_timeblock_locale
from app.core.timeblock_templates import render_timeblock_assistant, render_timeblock_settings
from app.integrations.timeblock.client import TimeblockIntegrationError

logger = logging.getLogger('guilua.communication')
router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parents[1] / 'templates')
SAFE_GROUP_SURFACES = frozenset({'chat', 'call', 'video', 'radio'})
SAFE_GROUP_QA_STATES = frozenset({'READY', 'FLOOR_BUSY', 'TALKING', 'FINALIZING_BURST', 'DEVICE_LOST'})


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


async def send_error(websocket: WebSocket, *, code: str, session_id: str, connection_id: str, trace_id: str) -> None:
    await websocket.send_json(server_event('error', session_id, connection_id, trace_id, code=code))


def log_event(result: str, **fields) -> None:
    logger.info('communication_runtime', extra={'result': result, **fields})


async def _assistant_page(
    request: Request,
    *,
    initial_mode: str | None = None,
    conversation_id: str = '',
) -> HTMLResponse:
    settings = request.app.state.settings
    locale = resolve_timeblock_locale(request, settings.default_locale)
    session = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if session:
        if session.session_kind == 'group':
            return RedirectResponse('/communication', status_code=303)
        usage = None
        try:
            usage_result = await request.app.state.timeblock_client.client_get(
                '/api/assistant/usage',
                session.timeblock_token,
            )
            if isinstance(usage_result, dict) and isinstance(usage_result.get('usage'), dict):
                usage = usage_result['usage']
        except TimeblockIntegrationError:
            # Rendering remains available during an upstream outage. Canonical
            # actions still surface the authoritative upstream error directly.
            usage = None
        return render_timeblock_assistant(
            request,
            session,
            locale=locale,
            initial_mode=initial_mode,
            conversation_id=conversation_id,
            assistant_usage=usage,
        )

    legacy_mode = {
        'messages': 'communication',
        'translate': 'translation',
        'alerts': 'notifications',
    }.get(initial_mode or request.query_params.get('mode', ''), initial_mode or request.query_params.get('mode', ''))
    return templates.TemplateResponse(
        request=request,
        name='assistant.html',
        context={
            'locale': locale,
            'copy': communication_copy(locale),
            'session': session,
            'initial_mode': legacy_mode if legacy_mode in {'ai', 'communication', 'translation', 'notifications'} else 'ai',
            'initial_conversation_id': conversation_id or request.query_params.get('conversation_id', ''),
        },
    )


@router.get('/', response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    requested_surface = str(request.query_params.get('surface') or '').strip().lower()
    if requested_surface in SAFE_GROUP_SURFACES:
        locale = resolve_timeblock_locale(request, request.app.state.settings.default_locale)
        # Authentication stays in the one-time postMessage handoff. Only this
        # allowlisted presentation hint and normalized locale enter the URL.
        query = urlencode({'surface': requested_surface, 'lang': locale})
        return RedirectResponse(f'/communication?{query}', status_code=307)
    return await _assistant_page(request)


@router.get('/assistant', response_class=HTMLResponse)
async def assistant_workspace(request: Request) -> HTMLResponse:
    return await _assistant_page(request)


@router.get('/ai', response_class=HTMLResponse)
async def assistant_deep_link(request: Request) -> HTMLResponse:
    return await _assistant_page(request, initial_mode='ai')


@router.get('/translate', response_class=HTMLResponse)
async def translation_deep_link(request: Request) -> HTMLResponse:
    return await _assistant_page(request, initial_mode='translate')


@router.get('/notifications', response_class=HTMLResponse)
async def notifications_deep_link(request: Request) -> HTMLResponse:
    return await _assistant_page(request, initial_mode='alerts')


@router.get('/conversations/{conversation_id}', response_class=HTMLResponse)
async def conversation_deep_link(request: Request, conversation_id: int) -> HTMLResponse:
    return await _assistant_page(
        request,
        initial_mode='messages',
        conversation_id=str(conversation_id),
    )


@router.get('/app-settings', response_class=HTMLResponse)
async def app_settings(request: Request):
    settings = request.app.state.settings
    locale = resolve_timeblock_locale(request, settings.default_locale)
    session = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if not session:
        return RedirectResponse(f'/?lang={locale}', status_code=303)
    return render_timeblock_settings(request, session, locale=locale)


@router.get('/logout', include_in_schema=False)
async def local_logout(request: Request) -> RedirectResponse:
    settings = request.app.state.settings
    locale = resolve_timeblock_locale(request, settings.default_locale)
    session = request.app.state.bff_session_store.get(
        request.cookies.get(settings.guilua_session_cookie)
    )
    if session:
        if session.session_kind == 'direct' and session.timeblock_token:
            try:
                await request.app.state.timeblock_client.revoke_guilua_session(session.timeblock_token)
            except TimeblockIntegrationError:
                pass
        request.app.state.bff_session_store.delete(session.session_id)
    response = RedirectResponse(f'/?lang={locale}', status_code=303)
    response.delete_cookie(settings.guilua_session_cookie, path='/')
    return response


@router.get('/calls/{call_id}', response_class=HTMLResponse)
async def call_deep_link(request: Request, call_id: str) -> HTMLResponse:
    return await communication(request)


@router.get('/communication', response_class=HTMLResponse)
async def communication(request: Request) -> HTMLResponse:
    settings = request.app.state.settings
    locale = resolve_timeblock_locale(request, settings.default_locale)
    requested_surface = str(request.query_params.get('surface') or '').strip().lower()
    initial_surface = requested_surface if requested_surface in SAFE_GROUP_SURFACES else ''
    requested_state = str(request.query_params.get('state') or '').strip().upper()
    initial_qa_state = (
        requested_state
        if not settings.is_production and requested_state in SAFE_GROUP_QA_STATES
        else ''
    )
    copy = communication_copy(locale)
    runtime_config = {
        'handoff_event': 'timeblock.communication.handoff.v1',
        'group_handoff_event': 'timeblock.group.handoff.v3',
        'group_handoff_contract_version': '3',
        'allowed_handoff_origins': sorted(settings.timeblock_handoff_origins),
        'development_query_handoff': settings.development_query_handoff_enabled,
        'timeblock_entry_url': settings.primary_timeblock_handoff_origin,
        'locale': locale,
        'initial_surface': initial_surface,
        'initial_qa_state': initial_qa_state,
        'copy': copy,
    }
    template_name = "group_communication_v3.html" if initial_surface else "communication.html"
    return templates.TemplateResponse(
        request=request,
        name=template_name,
        context={'runtime_config': runtime_config, 'locale': locale, 'copy': copy, 'settings': settings},
    )


@router.websocket('/ws/communication/{session_id}')
async def communication_socket(websocket: WebSocket, session_id: str) -> None:
    settings = websocket.app.state.settings
    manager = websocket.app.state.room_manager
    origin = websocket.headers.get('origin')

    if not origin and not settings.allow_missing_websocket_origin:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='origin_required')
        return
    if origin and origin.rstrip('/') not in settings.websocket_origins:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='origin_not_allowed')
        return
    if any(key in websocket.query_params for key in ('token', 'session_token', 'reconnect_token')):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='secret_query_not_allowed')
        return

    await websocket.accept()
    try:
        raw_auth = await asyncio.wait_for(
            websocket.receive_text(),
            timeout=settings.websocket_auth_timeout_seconds,
        )
    except TimeoutError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='authentication_timeout')
        return
    except WebSocketDisconnect:
        return

    if len(raw_auth.encode('utf-8')) > settings.max_auth_event_bytes:
        await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG, reason='authentication_event_too_large')
        return

    try:
        authentication = AuthenticationEnvelope.model_validate_json(raw_auth)
    except ValidationError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='invalid_authentication_event')
        return

    if authentication.session_id != session_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason='session_binding_failed')
        return

    participant_id = authentication.participant_id
    trace_id = authentication.trace_id
    auth_payload = authentication.payload

    try:
        if auth_payload.reconnect_token:
            authorized = await websocket.app.state.timeblock_client.refresh_session(
                session_id,
                auth_payload.session_token,
                participant_id,
                workspace_id=auth_payload.workspace_id,
                issuer=auth_payload.issuer,
                audience=auth_payload.audience,
            )
        else:
            authorized = await websocket.app.state.timeblock_client.authorize_session(
                session_id,
                auth_payload.session_token,
                participant_id,
                workspace_id=auth_payload.workspace_id,
                issuer=auth_payload.issuer,
                audience=auth_payload.audience,
            )
        result = await manager.connect(authorized, websocket, trace_id, auth_payload.reconnect_token)
    except (TimeblockIntegrationError, RoomManagerError) as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=str(exc))
        log_event(
            'connection_rejected',
            trace_id=trace_id,
            session_id=session_id,
            participant_id=participant_id,
            error_code=str(exc),
        )
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
                await send_error(
                    websocket,
                    code='event_too_large',
                    session_id=session_id,
                    connection_id=connection.connection_id,
                    trace_id=trace_id,
                )
                continue
            try:
                raw_event = json.loads(raw_text)
                event = EventEnvelope.model_validate(raw_event)
            except (json.JSONDecodeError, ValidationError):
                await send_error(
                    websocket,
                    code='invalid_event',
                    session_id=session_id,
                    connection_id=connection.connection_id,
                    trace_id=trace_id,
                )
                continue
            if (
                event.session_id != session_id
                or event.connection_id != connection.connection_id
                or event.participant_id != authorized.participant_id
            ):
                await send_error(
                    websocket,
                    code='event_binding_failed',
                    session_id=session_id,
                    connection_id=connection.connection_id,
                    trace_id=trace_id,
                )
                continue
            accepted, error = await manager.handle_event(event)
            if not accepted:
                await send_error(
                    websocket,
                    code=error or 'event_rejected',
                    session_id=session_id,
                    connection_id=connection.connection_id,
                    trace_id=trace_id,
                )
                log_event(
                    'event_rejected',
                    trace_id=trace_id,
                    session_id=session_id,
                    participant_id=authorized.participant_id,
                    connection_id=connection.connection_id,
                    event_name=event.event_name,
                    event_version=event.event_version,
                    error_code=error,
                )
                continue
            if event.event_name == EventName.HEARTBEAT:
                await websocket.send_json(
                    server_event(
                        'connection.ack',
                        session_id,
                        connection.connection_id,
                        trace_id,
                        acknowledged_event_id=str(event.event_id),
                    )
                )
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
                    await send_error(
                        websocket,
                        code=exc.code,
                        session_id=session_id,
                        connection_id=connection.connection_id,
                        trace_id=trace_id,
                    )
                continue
            if event.event_name == EventName.SESSION_ENDED:
                await manager.broadcast(
                    session_id,
                    server_event(
                        'session.ended',
                        session_id,
                        connection.connection_id,
                        trace_id,
                        participant_id=authorized.participant_id,
                    ),
                    exclude_connection_id=connection.connection_id,
                )
                break
            if event.event_name == EventName.SESSION_LEAVE:
                break
            await manager.broadcast(session_id, event.model_dump(mode='json'), connection.connection_id)
    except WebSocketDisconnect:
        log_event(
            'connection_closed',
            trace_id=trace_id,
            session_id=session_id,
            participant_id=authorized.participant_id,
            connection_id=connection.connection_id,
        )
    finally:
        participant = await manager.disconnect(session_id, connection.connection_id)
        if participant:
            await manager.broadcast(
                session_id,
                server_event(
                    'participant.left',
                    session_id,
                    connection.connection_id,
                    trace_id,
                    participant_id=authorized.participant_id,
                ),
            )
