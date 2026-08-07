from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from app.main import create_app


def production_settings(**overrides) -> Settings:
    values = {
        'app_env': 'production',
        'debug': False,
        'secret_key': 'production-secret-that-is-long-enough-for-tests',
        'allow_development_session_fallback': False,
        'timeblock_api_url': 'https://timeblock.invalid',
        'timeblock_api_key': 'runtime-server-secret',
        'allowed_websocket_origins': 'https://guilua.onrender.com',
        'allowed_timeblock_handoff_origins': 'https://timeblock-commercial-pro.onrender.com,https://fumapgo.com',
        'allow_missing_websocket_origin': False,
        'websocket_auth_timeout_seconds': 0.6,
        'max_auth_event_bytes': 1024,
    }
    values.update(overrides)
    return Settings(**values)


def test_production_handoff_configuration_is_fail_closed():
    with pytest.raises(ValidationError, match='ALLOWED_TIMEBLOCK_HANDOFF_ORIGINS'):
        production_settings(allowed_timeblock_handoff_origins='')
    with pytest.raises(ValidationError, match='ALLOW_DEVELOPMENT_SESSION_FALLBACK'):
        production_settings(allow_development_session_fallback=True)


def test_production_page_exposes_only_nonsecret_handoff_configuration():
    app = create_app(production_settings())
    with TestClient(app) as client:
        response = client.get('/communication')
        assert response.status_code == 200
        assert 'timeblock.communication.handoff.v1' in response.text
        assert 'https://timeblock-commercial-pro.onrender.com' in response.text
        assert 'https://fumapgo.com' in response.text
        assert 'runtime-server-secret' not in response.text
        assert 'session_token' not in response.text
        assert 'development-session' not in response.text


def test_browser_runtime_does_not_persist_or_read_secret_query_tokens():
    app = create_app(production_settings())
    with TestClient(app) as client:
        script = client.get('/static/communication.js').text
        assert 'localStorage' not in script
        assert 'sessionStorage' not in script
        assert "params.get('token')" not in script
        assert 'reconnect_token=' not in script
        assert 'session_token=' not in script
        assert "event_name: 'session.authenticate'" in script


def test_secret_websocket_query_is_rejected_before_runtime_state_exists():
    app = create_app(production_settings())
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                '/ws/communication/session-1?token=forbidden',
                headers={'origin': 'https://guilua.onrender.com'},
            ):
                pass
        assert app.state.room_manager.rooms == {}
        assert app.state.room_manager.reconnect_tokens == {}


def test_malformed_and_oversized_first_frames_create_no_room_state():
    app = create_app(production_settings())
    with TestClient(app) as client:
        with client.websocket_connect(
            '/ws/communication/session-1',
            headers={'origin': 'https://guilua.onrender.com'},
        ) as ws:
            ws.send_text('{not-json')
            with pytest.raises(WebSocketDisconnect):
                ws.receive_text()
        assert app.state.room_manager.rooms == {}

        with client.websocket_connect(
            '/ws/communication/session-1',
            headers={'origin': 'https://guilua.onrender.com'},
        ) as ws:
            ws.send_text('x' * 2048)
            with pytest.raises(WebSocketDisconnect):
                ws.receive_text()
        assert app.state.room_manager.rooms == {}
        assert app.state.room_manager.reconnect_tokens == {}
