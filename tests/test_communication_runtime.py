from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    response = client.get("/healthz/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "guilua-communication-runtime"}


def test_home_is_timeblock_communication(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "Timeblock AI Communication" in response.text
    assert "Bắt đầu phiên liên lạc" in response.text
    forbidden = ["BO Trading", "SLB_POINT", "TWD/VND", "USDT/TWD", "Member portal"]
    for value in forbidden:
        assert value not in response.text


def test_communication_shell(client: TestClient) -> None:
    response = client.get("/communication")
    assert response.status_code == 200
    assert "AI Interpreter" in response.text
    assert "data-toggle-mic" in response.text
    assert "data-toggle-camera" in response.text
    assert "data-end-call" in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/bo",
        "/rapid",
        "/member",
        "/member/wallet",
        "/admin",
        "/rates",
        "/wallet",
        "/affiliate",
        "/referral",
        "/crypto",
        "/api/slbo/room-state",
    ],
)
def test_legacy_routes_are_removed(client: TestClient, path: str) -> None:
    assert client.get(path, follow_redirects=False).status_code == 404


def test_websocket_requires_authorization(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws/communication/session-unauthorized",
            headers={"origin": "http://localhost:8000"},
        ):
            pass


def test_websocket_heartbeat_and_duplicate_detection(client: TestClient) -> None:
    with client.websocket_connect(
        "/ws/communication/session-1?token=development-session&participant_id=participant-1",
        headers={"origin": "http://localhost:8000"},
    ) as websocket:
        authorized = websocket.receive_json()
        assert authorized["event_name"] == "session.authorized"
        connection_id = authorized["connection_id"]
        event_id = str(uuid4())
        event = {
            "event_name": "connection.heartbeat",
            "event_version": 1,
            "event_id": event_id,
            "session_id": "session-1",
            "participant_id": "participant-1",
            "connection_id": connection_id,
            "sequence_number": 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "trace_id": "trace-test-1",
            "payload": {},
        }
        websocket.send_json(event)
        assert websocket.receive_json() == {"event_name": "connection.ack", "event_id": event_id}

        duplicate = dict(event)
        duplicate["sequence_number"] = 2
        websocket.send_json(duplicate)
        response = websocket.receive_json()
        assert response["event_name"] == "error"
        assert response["code"] == "duplicate_event"


def test_websocket_rejects_out_of_order_sequence(client: TestClient) -> None:
    with client.websocket_connect(
        "/ws/communication/session-2?token=development-session&participant_id=participant-2",
        headers={"origin": "http://localhost:8000"},
    ) as websocket:
        authorized = websocket.receive_json()
        connection_id = authorized["connection_id"]
        base = {
            "event_name": "media.muted",
            "event_version": 1,
            "session_id": "session-2",
            "participant_id": "participant-2",
            "connection_id": connection_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "trace_id": "trace-test-2",
            "payload": {},
        }
        websocket.send_json({**base, "event_id": str(uuid4()), "sequence_number": 2})
        websocket.send_json({**base, "event_id": str(uuid4()), "sequence_number": 1})
        response = websocket.receive_json()
        assert response["event_name"] == "error"
        assert response["code"] == "out_of_order"
