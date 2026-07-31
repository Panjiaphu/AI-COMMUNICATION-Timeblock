from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.communication.schemas import SessionStatus
from app.core.config import Settings
from app.integrations.timeblock.client import TimeblockClient, TimeblockIntegrationError
from app.main import create_app


def settings(**overrides) -> Settings:
    values = {
        'app_env': 'test',
        'debug': True,
        'secret_key': 'test-secret-that-is-not-default-and-is-long',
        'allow_development_session_fallback': True,
        'allowed_websocket_origins': 'http://testserver,http://localhost:8000',
        'allow_missing_websocket_origin': True,
        'event_rate_limit_count': 50,
        'signaling_rate_limit_count': 20,
        'heartbeat_rate_limit_count': 10,
    }
    values.update(overrides)
    return Settings(**values)


def ws_path(session='session-1', participant='participant-1', token='development-session', reconnect=None):
    path = f'/ws/communication/{session}?token={token}&participant_id={participant}&trace_id=trace-p1'
    if reconnect:
        path += f'&reconnect_token={reconnect}'
    return path


def event(authorized, name, sequence=1):
    return {
        'event_name': name,
        'event_version': 1,
        'event_id': str(uuid4()),
        'session_id': 'session-1',
        'participant_id': authorized['participant_id'],
        'connection_id': authorized['connection_id'],
        'sequence_number': sequence,
        'trace_id': 'trace-p1',
        'payload': {},
    }


def test_development_fallback_requires_explicit_nonproduction_classification():
    development = TimeblockClient(settings(app_env='development', debug=True))
    authorized = asyncio.run(development.authorize_session('s1', 'development-session', 'p1'))
    assert authorized.session_id == 's1'

    test_client = TimeblockClient(settings(app_env='test', debug=True))
    assert asyncio.run(test_client.authorize_session('s2', 'development-session', 'p2')).participant_id == 'p2'

    disabled = TimeblockClient(settings(allow_development_session_fallback=False))
    with pytest.raises(TimeblockIntegrationError, match='timeblock_not_configured'):
        asyncio.run(disabled.authorize_session('s3', 'development-session', 'p3'))

    configured = TimeblockClient(settings(timeblock_api_url='https://timeblock.invalid'))
    with pytest.raises(TimeblockIntegrationError, match='timeblock_not_configured'):
        asyncio.run(configured.authorize_session('s4', 'development-session', 'p4'))

    with pytest.raises(ValidationError, match='ALLOW_DEVELOPMENT_SESSION_FALLBACK'):
        settings(app_env='development', debug=False, allow_development_session_fallback=True)
    with pytest.raises(ValidationError, match='ALLOW_DEVELOPMENT_SESSION_FALLBACK'):
        settings(app_env='production', debug=False, allow_development_session_fallback=True)


@pytest.mark.parametrize(
    ('method_name', 'response'),
    [
        ('authorize_session', {'session_id': 'wrong', 'room_id': 'r', 'workspace_id': 'w', 'participant_id': 'p1'}),
        ('authorize_session', {'session_id': 's1', 'room_id': 'r', 'workspace_id': 'w', 'participant_id': 'wrong'}),
        ('refresh_session', {'session_id': 'wrong', 'room_id': 'r', 'workspace_id': 'w', 'participant_id': 'p1'}),
        ('refresh_session', {'session_id': 's1', 'room_id': 'r', 'workspace_id': 'w', 'participant_id': 'wrong'}),
    ],
)
def test_authority_response_is_bound_to_requested_identity(monkeypatch, method_name, response):
    async def fake_post(self, path, payload, **kwargs):
        return response

    monkeypatch.setattr(TimeblockClient, '_post', fake_post)
    client = TimeblockClient(settings(allow_development_session_fallback=False, timeblock_api_url='https://timeblock.invalid', timeblock_api_key='key'))
    with pytest.raises(TimeblockIntegrationError, match='authorization_boundary_mismatch'):
        asyncio.run(getattr(client, method_name)('s1', 'token', 'p1'))


def test_rejected_authority_response_leaves_no_manager_state(monkeypatch):
    async def fake_post(self, path, payload, **kwargs):
        return {'session_id': 'wrong', 'room_id': 'r', 'workspace_id': 'w', 'participant_id': payload['participant_id']}

    monkeypatch.setattr(TimeblockClient, '_post', fake_post)
    app = create_app(settings(allow_development_session_fallback=False, timeblock_api_url='https://timeblock.invalid', timeblock_api_key='key'))
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(token='token'), headers={'origin': 'http://testserver'}):
                pass
        assert app.state.room_manager.rooms == {}
        assert app.state.room_manager.reconnect_tokens == {}


def test_refresh_room_and_workspace_changes_are_rejected(monkeypatch):
    responses = iter([
        {'session_id': 'session-1', 'room_id': 'room-1', 'workspace_id': 'workspace-1', 'participant_id': 'participant-1'},
        {'session_id': 'session-1', 'room_id': 'room-2', 'workspace_id': 'workspace-1', 'participant_id': 'participant-1'},
    ])

    async def fake_post(self, path, payload, **kwargs):
        return next(responses)

    monkeypatch.setattr(TimeblockClient, '_post', fake_post)
    app = create_app(settings(allow_development_session_fallback=False, timeblock_api_url='https://timeblock.invalid', timeblock_api_key='key'))
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(token='token'), headers={'origin': 'http://testserver'}) as ws:
            reconnect = ws.receive_json()['reconnect_token']
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(token='token', reconnect=reconnect), headers={'origin': 'http://testserver'}):
                pass
        room = app.state.room_manager.rooms['session-1']
        assert room.room_id == 'room-1'
        assert room.workspace_id == 'workspace-1'
        assert room.connections == {}


def test_refresh_workspace_change_is_rejected(monkeypatch):
    responses = iter([
        {'session_id': 'session-1', 'room_id': 'room-1', 'workspace_id': 'workspace-1', 'participant_id': 'participant-1'},
        {'session_id': 'session-1', 'room_id': 'room-1', 'workspace_id': 'workspace-2', 'participant_id': 'participant-1'},
    ])

    async def fake_post(self, path, payload, **kwargs):
        return next(responses)

    monkeypatch.setattr(TimeblockClient, '_post', fake_post)
    app = create_app(settings(allow_development_session_fallback=False, timeblock_api_url='https://timeblock.invalid', timeblock_api_key='key'))
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(token='token'), headers={'origin': 'http://testserver'}) as ws:
            reconnect = ws.receive_json()['reconnect_token']
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(token='token', reconnect=reconnect), headers={'origin': 'http://testserver'}):
                pass
        room = app.state.room_manager.rooms['session-1']
        assert room.workspace_id == 'workspace-1'
        assert room.connections == {}


def test_session_ended_reaches_peer_and_blocks_new_join():
    app = create_app(settings())
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(participant='participant-a'), headers={'origin': 'http://testserver'}) as one:
            auth_a = one.receive_json()
            with client.websocket_connect(ws_path(participant='participant-b'), headers={'origin': 'http://testserver'}) as two:
                two.receive_json()
                one.receive_json()
                one.send_json(event(auth_a, 'session.ended'))
                terminal = two.receive_json()
                assert terminal['event_name'] == 'session.ended'
                assert terminal['participant_id'] == 'participant-a'
            room = app.state.room_manager.rooms['session-1']
            assert room.status == SessionStatus.ENDED
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(participant='participant-c'), headers={'origin': 'http://testserver'}):
                pass


def test_session_leave_does_not_end_room():
    app = create_app(settings())
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(participant='participant-a'), headers={'origin': 'http://testserver'}) as one:
            auth_a = one.receive_json()
            with client.websocket_connect(ws_path(participant='participant-b'), headers={'origin': 'http://testserver'}) as two:
                two.receive_json()
                one.receive_json()
                one.send_json(event(auth_a, 'session.leave'))
                assert two.receive_json()['event_name'] == 'participant.left'
                assert app.state.room_manager.rooms['session-1'].status == SessionStatus.ACTIVE
