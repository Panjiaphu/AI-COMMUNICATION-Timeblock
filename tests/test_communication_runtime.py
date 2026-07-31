from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.communication.manager import utcnow
from app.core.config import Settings
from app.main import create_app


def settings(**overrides) -> Settings:
    values = {
        'app_env': 'test', 'debug': True,
        'secret_key': 'test-secret-that-is-not-default-and-is-long',
        'allow_development_session_fallback': True,
        'allowed_websocket_origins': 'http://testserver,http://localhost:8000',
        'allow_missing_websocket_origin': True,
        'event_rate_limit_count': 50, 'signaling_rate_limit_count': 20, 'heartbeat_rate_limit_count': 10,
    }
    values.update(overrides)
    return Settings(**values)


def client_for(**overrides) -> TestClient:
    return TestClient(create_app(settings(**overrides)))


def ws_path(session='session-1', participant='participant-1', token='development-session', reconnect=None):
    path = f'/ws/communication/{session}?token={token}&participant_id={participant}&trace_id=trace-test'
    if reconnect: path += f'&reconnect_token={reconnect}'
    return path


def event(authorized, name='connection.heartbeat', sequence=1, event_id=None, payload=None, participant=None, session='session-1'):
    return {'event_name': name, 'event_version': 1, 'event_id': event_id or str(uuid4()), 'session_id': session, 'participant_id': participant or authorized['participant_id'], 'connection_id': authorized['connection_id'], 'sequence_number': sequence, 'timestamp': utcnow().isoformat(), 'trace_id': 'trace-test', 'payload': payload or {}}


def test_http_and_legacy_absence():
    with client_for() as client:
        assert client.get('/healthz/').json() == {'status': 'ok', 'service': 'guilua-communication-runtime'}
        home, call = client.get('/'), client.get('/communication')
        assert home.status_code == call.status_code == 200
        assert 'Timeblock AI Communication' in home.text
        assert 'RTCPeerConnection' in client.get('/static/communication.js').text
        rendered = home.text + call.text
        assert all(term not in rendered for term in ['BO Trading', 'SLB_POINT', 'TWD/VND', 'USDT/TWD', 'Member portal', 'Crypto dashboard'])
        for path in ['/bo', '/rapid', '/member', '/admin', '/rates', '/wallet', '/affiliate', '/referral', '/crypto', '/odds']:
            assert client.get(path, follow_redirects=False).status_code == 404


def test_websocket_authorization_and_origin_policy():
    with client_for() as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/communication/session-1?participant_id=p1'): pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(token='wrong')): pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(), headers={'origin': 'https://evil.example'}): pass
    production = client_for(app_env='production', debug=False, allow_development_session_fallback=False)
    with production:
        with pytest.raises(WebSocketDisconnect):
            with production.websocket_connect(ws_path()): pass
        with pytest.raises(WebSocketDisconnect):
            with production.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}): pass


def test_event_validation_duplicate_and_sequence():
    with client_for() as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            authorized = ws.receive_json(); first_id = str(uuid4())
            ws.send_json(event(authorized, event_id=first_id)); assert ws.receive_json()['event_name'] == 'connection.ack'
            ws.send_json(event(authorized, sequence=2, event_id=first_id)); assert ws.receive_json()['code'] == 'duplicate_event'
            ws.send_json(event(authorized, sequence=1)); assert ws.receive_json()['code'] == 'out_of_order'
            ws.send_json(event(authorized, name='unknown.event', sequence=3)); assert ws.receive_json()['code'] == 'invalid_event'
            ws.send_json(event(authorized, name='signaling.offer', sequence=4, payload={'target_participant_id': 'p2'})); assert ws.receive_json()['code'] == 'invalid_event'


def test_room_capacity_targeted_signaling_and_self_target():
    with client_for() as client:
        with client.websocket_connect(ws_path(participant='p1'), headers={'origin': 'http://testserver'}) as one:
            auth1 = one.receive_json()
            with client.websocket_connect(ws_path(participant='p2'), headers={'origin': 'http://testserver'}) as two:
                two.receive_json(); assert one.receive_json()['event_name'] == 'participant.joined'
                one.send_json(event(auth1, name='signaling.offer', sequence=1, participant='p1', payload={'target_participant_id': 'p2', 'sdp_type': 'offer', 'sdp': 'v=0'}))
                forwarded = two.receive_json(); assert forwarded['event_name'] == 'signaling.offer' and forwarded['participant_id'] == 'p1'
                one.send_json(event(auth1, name='signaling.offer', sequence=2, participant='p1', payload={'target_participant_id': 'p1', 'sdp_type': 'offer', 'sdp': 'v=0'})); assert one.receive_json()['code'] == 'self_target'
                with pytest.raises(WebSocketDisconnect):
                    with client.websocket_connect(ws_path(participant='p3'), headers={'origin': 'http://testserver'}): pass


def test_reconnect_rotates_token_and_rejects_reuse():
    app = create_app(settings())
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(participant='p1'), headers={'origin': 'http://testserver'}) as ws:
            first = ws.receive_json(); token = first['reconnect_token']
        with client.websocket_connect(ws_path(participant='p1', reconnect=token), headers={'origin': 'http://testserver'}) as reconnected:
            second = reconnected.receive_json(); assert second['reconnected'] is True; assert second['connection_id'] != first['connection_id']; assert second['reconnect_token'] != token
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(participant='p1', reconnect=token), headers={'origin': 'http://testserver'}): pass


def test_expired_reconnect_and_cleanup():
    app = create_app(settings(connection_stale_seconds=10, ended_session_cache_seconds=30))
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(participant='p1'), headers={'origin': 'http://testserver'}) as ws:
            token = ws.receive_json()['reconnect_token']
        app.state.room_manager.reconnect_tokens[app.state.room_manager._token_hash(token)].expires_at = utcnow() - timedelta(seconds=1)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(participant='p1', reconnect=token), headers={'origin': 'http://testserver'}): pass


def test_rate_limit_is_connection_scoped():
    with client_for(heartbeat_rate_limit_count=2, event_rate_limit_count=10) as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            authorized = ws.receive_json()
            for sequence in (1, 2): ws.send_json(event(authorized, sequence=sequence)); assert ws.receive_json()['event_name'] == 'connection.ack'
            ws.send_json(event(authorized, sequence=3)); assert ws.receive_json()['code'] == 'heartbeat_rate_limited'
