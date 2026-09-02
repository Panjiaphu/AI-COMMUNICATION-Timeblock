from __future__ import annotations

from datetime import timedelta
from pathlib import Path
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
        'allowed_timeblock_handoff_origins': 'http://testserver',
        'allow_missing_websocket_origin': True,
        'event_rate_limit_count': 50, 'signaling_rate_limit_count': 20, 'heartbeat_rate_limit_count': 10,
    }
    values.update(overrides)
    return Settings(**values)


def client_for(**overrides) -> TestClient:
    return TestClient(create_app(settings(**overrides)))


def ws_path(session='session-1'):
    return f'/ws/communication/{session}'


def auth_frame(session='session-1', participant='participant-1', token='development-session', reconnect=None, **claims):
    payload = {'session_token': token}
    if reconnect:
        payload['reconnect_token'] = reconnect
    payload.update({key: value for key, value in claims.items() if value is not None})
    return {
        'event_name': 'session.authenticate',
        'event_version': 1,
        'session_id': session,
        'participant_id': participant,
        'trace_id': 'trace-test',
        'payload': payload,
    }


def authorize(ws, **kwargs):
    ws.send_json(auth_frame(**kwargs))
    return ws.receive_json()


def event(authorized, name='connection.heartbeat', sequence=1, event_id=None, payload=None, participant=None, session='session-1'):
    return {'event_name': name, 'event_version': 1, 'event_id': event_id or str(uuid4()), 'session_id': session, 'participant_id': participant or authorized['participant_id'], 'connection_id': authorized['connection_id'], 'sequence_number': sequence, 'timestamp': utcnow().isoformat(), 'trace_id': 'trace-test', 'payload': payload or {}}


def test_http_and_legacy_absence():
    with client_for() as client:
        assert client.get('/healthz/').json() == {'status': 'ok', 'service': 'guilua-communication-runtime'}
        home, call = client.get('/'), client.get('/communication')
        assert home.status_code == call.status_code == 200
        assert 'Timeblock AI Communication' in home.text
        script = client.get('/static/communication.js').text
        assert 'RTCPeerConnection' in script
        assert 'session.authenticate' in script
        assert "params.get('token')" not in script
        assert 'localStorage' not in script
        assert 'sessionStorage' not in script
        rendered = home.text + call.text
        assert all(term not in rendered for term in ['BO Trading', 'SLB_POINT', 'TWD/VND', 'USDT/TWD', 'Member portal', 'Crypto dashboard'])
        for path in ['/bo', '/rapid', '/member', '/admin', '/rates', '/wallet', '/affiliate', '/referral', '/crypto', '/odds']:
            assert client.get(path, follow_redirects=False).status_code == 404


def test_root_renders_safe_group_surfaces_without_forwarding_secrets():
    with client_for() as client:
        for surface in ('call', 'video', 'radio', 'plugin'):
            response = client.get(
                f'/?surface={surface}&lang=en&token=do-not-forward&api_key=do-not-forward',
                follow_redirects=False,
            )
            assert response.status_code == 200
            assert f'"initial_surface": "{surface}"' in response.text
            assert 'do-not-forward' not in response.text

        invalid = client.get('/?surface=group_radio&token=do-not-forward', follow_redirects=False)
        assert invalid.status_code == 200
        assert 'do-not-forward' not in invalid.text


def test_communication_exposes_only_allowlisted_initial_surface():
    with client_for() as client:
        for surface in ('radio', 'plugin'):
            safe = client.get(f'/communication?surface={surface}&lang=vi')
            assert safe.status_code == 200
            assert f'"initial_surface": "{surface}"' in safe.text
        unsafe = client.get('/communication?surface=group_radio&lang=vi')
        assert unsafe.status_code == 200
        assert '"initial_surface": ""' in unsafe.text


def test_normal_group_routes_are_visible_without_technical_surface_query():
    with client_for() as client:
        default_group = client.get('/group?lang=vi')
        radio_group = client.get('/group/radio?lang=en')
        chat_translation = client.get('/group/chat-translation?lang=vi')
        radio_translation = client.get('/group/radio-translation?lang=zh-TW')
        invalid_group = client.get('/group/group_radio?lang=vi')
        direct = client.get('/communication?lang=vi')

        assert default_group.status_code == 200
        assert 'id="group-native-app"' in default_group.text
        assert '<link rel="icon" href="data:,">' in default_group.text
        assert '"initial_surface": "chat"' in default_group.text
        assert radio_group.status_code == 200
        assert '"initial_surface": "radio"' in radio_group.text
        assert chat_translation.status_code == 200
        assert '"initial_surface": "chat-translation"' in chat_translation.text
        assert (
            '"group_translation_policy_version": '
            '"group-translation-v3-2026-08-31"'
        ) in chat_translation.text
        assert radio_translation.status_code == 200
        assert '"initial_surface": "radio-translation"' in radio_translation.text
        assert invalid_group.status_code == 404
        assert 'group_v3_app.js' not in direct.text


def test_ai_owned_group_entry_does_not_call_retired_timeblock_group_proxy():
    root = Path(__file__).resolve().parents[1]
    adapter = (root / 'app/static/js/assistant_group_native_entry.js').read_text(
        encoding='utf-8'
    )
    styles = (root / 'app/static/css/assistant_runtime_adapter.css').read_text(
        encoding='utf-8'
    )

    assert 'new URL(`/group/${surface}`' in adapter
    assert '/api/communication/group/handoffs' not in adapter
    assert 'searchParams.set("surface"' not in adapter
    assert '[data-communication-tab="groups"],' not in styles


def test_group_navigation_labels_can_wrap_without_hiding_long_localized_copy():
    root = Path(__file__).resolve().parents[1]
    styles = (root / 'app/static/group-v3/group_v3.css').read_text(
        encoding='utf-8'
    )

    assert styles.count('-webkit-line-clamp: 2') >= 2
    assert styles.count('white-space: normal') >= 2


def test_group_visual_state_query_is_development_only_and_allowlisted():
    with client_for() as client:
        safe = client.get('/communication?surface=radio&state=DEVICE_LOST&lang=vi')
        unsafe = client.get('/communication?surface=radio&state=JOINED&lang=vi')
        assert '"initial_qa_state": "DEVICE_LOST"' in safe.text
        assert '"initial_qa_state": ""' in unsafe.text

    production = client_for(app_env='production', debug=False, allow_development_session_fallback=False)
    with production as client:
        response = client.get('/communication?surface=radio&state=DEVICE_LOST&lang=vi')
        assert '"initial_qa_state": ""' in response.text


def test_websocket_authorization_and_origin_policy():
    with client_for() as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            ws.send_json(auth_frame(token='wrong'))
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/communication/session-1?token=development-session', headers={'origin': 'http://testserver'}):
                pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws_path(), headers={'origin': 'https://evil.example'}):
                pass
    production = client_for(app_env='production', debug=False, allow_development_session_fallback=False)
    with production:
        with pytest.raises(WebSocketDisconnect):
            with production.websocket_connect(ws_path()):
                pass
        with production.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            ws.send_json(auth_frame())
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_event_validation_duplicate_and_sequence():
    with client_for() as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            authorized = authorize(ws); first_id = str(uuid4())
            ws.send_json(event(authorized, event_id=first_id)); assert ws.receive_json()['event_name'] == 'connection.ack'
            ws.send_json(event(authorized, sequence=2, event_id=first_id)); assert ws.receive_json()['code'] == 'duplicate_event'
            ws.send_json(event(authorized, sequence=1)); assert ws.receive_json()['code'] == 'out_of_order'
            ws.send_json(event(authorized, name='unknown.event', sequence=3)); assert ws.receive_json()['code'] == 'invalid_event'
            ws.send_json(event(authorized, name='signaling.offer', sequence=4, payload={'target_participant_id': 'p2'})); assert ws.receive_json()['code'] == 'invalid_event'


def test_room_capacity_targeted_signaling_and_self_target():
    with client_for() as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as one:
            auth1 = authorize(one, participant='p1')
            with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as two:
                authorize(two, participant='p2'); assert one.receive_json()['event_name'] == 'participant.joined'
                one.send_json(event(auth1, name='signaling.offer', sequence=1, participant='p1', payload={'target_participant_id': 'p2', 'sdp_type': 'offer', 'sdp': 'v=0'}))
                forwarded = two.receive_json(); assert forwarded['event_name'] == 'signaling.offer' and forwarded['participant_id'] == 'p1'
                one.send_json(event(auth1, name='signaling.offer', sequence=2, participant='p1', payload={'target_participant_id': 'p1', 'sdp_type': 'offer', 'sdp': 'v=0'})); assert one.receive_json()['code'] == 'self_target'
                with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as three:
                    three.send_json(auth_frame(participant='p3'))
                    with pytest.raises(WebSocketDisconnect):
                        three.receive_json()


def test_reconnect_rotates_token_and_rejects_reuse():
    app = create_app(settings())
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            first = authorize(ws, participant='p1'); token = first['reconnect_token']
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as reconnected:
            second = authorize(reconnected, participant='p1', reconnect=token); assert second['reconnected'] is True; assert second['connection_id'] != first['connection_id']; assert second['reconnect_token'] != token
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as reused:
            reused.send_json(auth_frame(participant='p1', reconnect=token))
            with pytest.raises(WebSocketDisconnect):
                reused.receive_json()


def test_expired_reconnect_and_cleanup():
    app = create_app(settings(connection_stale_seconds=10, ended_session_cache_seconds=30))
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            token = authorize(ws, participant='p1')['reconnect_token']
        app.state.room_manager.reconnect_tokens[app.state.room_manager._token_hash(token)].expires_at = utcnow() - timedelta(seconds=1)
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as expired:
            expired.send_json(auth_frame(participant='p1', reconnect=token))
            with pytest.raises(WebSocketDisconnect):
                expired.receive_json()


def test_rate_limit_is_connection_scoped():
    with client_for(heartbeat_rate_limit_count=2, event_rate_limit_count=10) as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            authorized = authorize(ws)
            for sequence in (1, 2): ws.send_json(event(authorized, sequence=sequence)); assert ws.receive_json()['event_name'] == 'connection.ack'
            ws.send_json(event(authorized, sequence=3)); assert ws.receive_json()['code'] == 'heartbeat_rate_limited'


def test_authentication_timeout_and_unauthorized_socket_gets_no_room_state():
    app = create_app(settings(websocket_auth_timeout_seconds=0.6))
    with TestClient(app) as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
        assert app.state.room_manager.rooms == {}
        assert app.state.room_manager.reconnect_tokens == {}


def test_workspace_claim_is_compared_not_trusted():
    with client_for() as client:
        with client.websocket_connect(ws_path(), headers={'origin': 'http://testserver'}) as ws:
            authorized = authorize(ws, workspace_id='workspace-from-timeblock')
            assert authorized['snapshot']['workspace_id'] == 'workspace-from-timeblock'
