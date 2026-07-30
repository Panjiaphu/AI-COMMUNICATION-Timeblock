from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from app.communication.manager import room_manager
from app.communication.schemas import EventEnvelope
from app.integrations.timeblock.client import TimeblockIntegrationError

logger = logging.getLogger("guilua.communication")
router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parents[1] / "templates")


@router.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="home.html", context={})


@router.get("/communication", response_class=HTMLResponse)
async def communication(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="communication.html", context={})


@router.websocket("/ws/communication/{session_id}")
async def communication_socket(websocket: WebSocket, session_id: str) -> None:
    settings = websocket.app.state.settings
    origin = websocket.headers.get("origin")
    allowed_origins = {item.strip() for item in settings.allowed_websocket_origins.split(",") if item.strip()}
    if origin and origin not in allowed_origins:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="origin_not_allowed")
        return

    token = websocket.query_params.get("token", "")
    participant_id = websocket.query_params.get("participant_id", "")
    if not token or not participant_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="authorization_required")
        return

    try:
        authorized = await websocket.app.state.timeblock_client.authorize_session(
            session_id=session_id,
            session_token=token,
            participant_id=participant_id,
        )
    except TimeblockIntegrationError as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=str(exc))
        return

    connection = await room_manager.connect(
        session_id=session_id,
        workspace_id=authorized.workspace_id,
        participant_id=authorized.participant_id,
        websocket=websocket,
    )
    await websocket.send_json(
        {
            "event_name": "session.authorized",
            "event_version": 1,
            "session_id": session_id,
            "room_id": authorized.room_id,
            "participant_id": authorized.participant_id,
            "connection_id": connection.connection_id,
        }
    )
    await room_manager.broadcast(
        session_id,
        {
            "event_name": "participant.joined",
            "event_version": 1,
            "session_id": session_id,
            "participant_id": authorized.participant_id,
            "connection_id": connection.connection_id,
        },
        exclude_connection_id=connection.connection_id,
    )

    try:
        while True:
            raw_event = await websocket.receive_json()
            try:
                event = EventEnvelope.model_validate(raw_event)
            except ValidationError as exc:
                await websocket.send_json({"event_name": "error", "code": "invalid_event", "detail": exc.errors()})
                continue
            if (
                event.session_id != session_id
                or event.connection_id != connection.connection_id
                or event.participant_id != authorized.participant_id
            ):
                await websocket.send_json({"event_name": "error", "code": "event_binding_failed"})
                continue
            accepted, error = await room_manager.handle_event(event)
            if not accepted:
                await websocket.send_json({"event_name": "error", "code": error})
                continue
            if event.event_name == "connection.heartbeat":
                await websocket.send_json({"event_name": "connection.ack", "event_id": str(event.event_id)})
                continue
            await room_manager.broadcast(session_id, event.model_dump(mode="json"), connection.connection_id)
    except WebSocketDisconnect:
        logger.info(
            "communication_disconnected",
            extra={"session_id": session_id, "connection_id": connection.connection_id},
        )
    finally:
        await room_manager.disconnect(session_id, connection.connection_id)
        await room_manager.broadcast(
            session_id,
            {
                "event_name": "participant.left",
                "event_version": 1,
                "session_id": session_id,
                "participant_id": authorized.participant_id,
                "connection_id": connection.connection_id,
            },
        )
