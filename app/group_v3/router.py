from __future__ import annotations

import asyncio
import json
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.group_v3.auth import require_app_session, require_group_actor, require_write_origin
from app.group_v3.schemas import (
    MembershipCreate,
    MembershipUpdate,
    MessageCreate,
    MessageUpdate,
    ReactionCreate,
    SpaceCreate,
    SpaceUpdate,
)


router = APIRouter(prefix="/api/group", tags=["group-v3"])


def _service(request: Request):
    return request.app.state.group_service


def _event_broker(request: Request):
    return request.app.state.group_event_broker


async def _publish(request: Request, space_id: str, event_type: str, resource_id: object = "") -> None:
    await _event_broker(request).publish(space_id, event_type, resource_id=resource_id)


def _json(payload: object, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        payload,
        status_code=status_code,
        headers={
            "Cache-Control": "no-store, private, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _bounded_id(value: str, name: str) -> str:
    normalized = str(value or "").strip()
    if not 1 <= len(normalized) <= 36:
        raise HTTPException(status_code=400, detail=f"invalid_{name}")
    return normalized


@router.get("/session")
async def group_session(request: Request) -> JSONResponse:
    """Return non-secret context for the authenticated application session."""

    session = require_app_session(request)
    principal = session.principal
    group_authorized = session.group_authorized
    return _json(
        {
            "contract_version": "3",
            "authority": "ai-communication",
            "direct_available": bool(session.timeblock_token),
            "group_authorized": group_authorized,
            "surface": session.group_surface if group_authorized else "chat",
            "handoff_id": session.group_handoff_id if group_authorized else "",
            "principal": {
                "type": str(principal.get("type") or ""),
                "id": str(principal.get("id") or ""),
                "user_id": str(principal.get("user_id") or ""),
                "display_name": str(principal.get("display_name") or "")[:120],
                "locale": str(principal.get("locale") or "vi"),
            },
            "scope": sorted(session.group_scope) if group_authorized else [],
            "entitlement": session.entitlement if group_authorized else {},
        }
    )


@router.get("/spaces")
async def list_spaces(request: Request) -> JSONResponse:
    actor = require_group_actor(request, "group.spaces.read")
    return _json({"spaces": _service(request).list_spaces(actor)})


@router.post("/spaces")
async def create_space(
    request: Request,
    body: SpaceCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.spaces.write")
    result = _service(request).create_space(actor, body.model_dump(), idempotency_key)
    await _publish(request, result["space"]["id"], "space.created", result["space"]["id"])
    return _json(result, status_code=200 if result.get("idempotent") else 201)


@router.get("/spaces/{space_id}")
async def get_space(request: Request, space_id: str) -> JSONResponse:
    actor = require_group_actor(request, "group.spaces.read")
    return _json({"space": _service(request).get_space(actor, _bounded_id(space_id, "space_id"))})


@router.patch("/spaces/{space_id}")
async def update_space(request: Request, space_id: str, body: SpaceUpdate) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.spaces.write")
    values = body.model_dump(exclude_unset=True)
    if len(values) <= 1:
        raise HTTPException(status_code=400, detail="space_update_required")
    normalized_space_id = _bounded_id(space_id, "space_id")
    space = _service(request).update_space(actor, normalized_space_id, values)
    await _publish(request, normalized_space_id, "space.updated", normalized_space_id)
    return _json({"space": space})


@router.get("/spaces/{space_id}/events")
async def stream_space_events(request: Request, space_id: str) -> StreamingResponse:
    actor = require_group_actor(request, "group.messages.read")
    normalized_space_id = _bounded_id(space_id, "space_id")
    _service(request).get_space(actor, normalized_space_id)

    async def event_stream():
        async with _event_broker(request).subscribe(normalized_space_id) as queue:
            yield ": group-v3-ready\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                payload = json.dumps(event.as_dict(), ensure_ascii=True, separators=(",", ":"))
                yield f"id: {event.event_id}\nevent: group-change\ndata: {payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, private, max-age=0",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/spaces/{space_id}/memberships")
async def list_members(request: Request, space_id: str) -> JSONResponse:
    actor = require_group_actor(request, "group.spaces.read")
    return _json({"memberships": _service(request).list_members(actor, _bounded_id(space_id, "space_id"))})


@router.post("/spaces/{space_id}/memberships")
async def add_member(request: Request, space_id: str, body: MembershipCreate) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.spaces.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    membership = _service(request).add_member(actor, normalized_space_id, body.model_dump())
    await _publish(request, normalized_space_id, "membership.created", membership["id"])
    return _json({"membership": membership}, status_code=201)


@router.patch("/spaces/{space_id}/memberships/{membership_id}")
async def update_member(
    request: Request,
    space_id: str,
    membership_id: str,
    body: MembershipUpdate,
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.spaces.write")
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=400, detail="membership_update_required")
    normalized_space_id = _bounded_id(space_id, "space_id")
    membership = _service(request).update_member(
        actor,
        normalized_space_id,
        _bounded_id(membership_id, "membership_id"),
        values,
    )
    await _publish(request, normalized_space_id, "membership.updated", membership["id"])
    return _json({"membership": membership})


@router.get("/spaces/{space_id}/messages")
async def list_messages(
    request: Request,
    space_id: str,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
) -> JSONResponse:
    actor = require_group_actor(request, "group.messages.read")
    messages = _service(request).list_messages(
        actor,
        _bounded_id(space_id, "space_id"),
        before=before,
        limit=limit,
    )
    return _json({"messages": messages, "next_before": messages[0]["sequence"] if messages else None})


@router.post("/spaces/{space_id}/messages")
async def create_message(
    request: Request,
    space_id: str,
    body: MessageCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    result = _service(request).create_message(
        actor,
        normalized_space_id,
        body.model_dump(),
        idempotency_key,
    )
    await _publish(request, normalized_space_id, "message.created", result["message"]["id"])
    return _json(result, status_code=200 if result.get("idempotent") else 201)


@router.patch("/spaces/{space_id}/messages/{message_id}")
async def update_message(
    request: Request,
    space_id: str,
    message_id: str,
    body: MessageUpdate,
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    message = _service(request).update_message(
        actor,
        normalized_space_id,
        _bounded_id(message_id, "message_id"),
        body.content,
    )
    await _publish(request, normalized_space_id, "message.updated", message["id"])
    return _json({"message": message})


@router.delete("/spaces/{space_id}/messages/{message_id}")
async def delete_message(request: Request, space_id: str, message_id: str) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    normalized_message_id = _bounded_id(message_id, "message_id")
    result = _service(request).delete_message(actor, normalized_space_id, normalized_message_id)
    await _publish(request, normalized_space_id, "message.deleted", normalized_message_id)
    return _json(result)


@router.post("/spaces/{space_id}/messages/{message_id}/reactions")
async def add_reaction(
    request: Request,
    space_id: str,
    message_id: str,
    body: ReactionCreate,
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    normalized_message_id = _bounded_id(message_id, "message_id")
    result = _service(request).set_reaction(
        actor, normalized_space_id, normalized_message_id, body.reaction, True
    )
    await _publish(request, normalized_space_id, "message.reaction", normalized_message_id)
    return _json(result)


@router.delete("/spaces/{space_id}/messages/{message_id}/reactions/{reaction}")
async def remove_reaction(
    request: Request,
    space_id: str,
    message_id: str,
    reaction: str,
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized = str(reaction or "").strip()
    if not 1 <= len(normalized) <= 16 or any(character.isspace() for character in normalized):
        raise HTTPException(status_code=400, detail="invalid_reaction")
    normalized_space_id = _bounded_id(space_id, "space_id")
    normalized_message_id = _bounded_id(message_id, "message_id")
    result = _service(request).set_reaction(
        actor, normalized_space_id, normalized_message_id, normalized, False
    )
    await _publish(request, normalized_space_id, "message.reaction", normalized_message_id)
    return _json(result)


@router.post("/spaces/{space_id}/messages/{message_id}/pin")
async def pin_message(request: Request, space_id: str, message_id: str) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    normalized_message_id = _bounded_id(message_id, "message_id")
    result = _service(request).set_pin(actor, normalized_space_id, normalized_message_id, True)
    await _publish(request, normalized_space_id, "message.pin", normalized_message_id)
    return _json(result)


@router.delete("/spaces/{space_id}/messages/{message_id}/pin")
async def unpin_message(request: Request, space_id: str, message_id: str) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    normalized_space_id = _bounded_id(space_id, "space_id")
    normalized_message_id = _bounded_id(message_id, "message_id")
    result = _service(request).set_pin(actor, normalized_space_id, normalized_message_id, False)
    await _publish(request, normalized_space_id, "message.pin", normalized_message_id)
    return _json(result)


@router.get("/spaces/{space_id}/pins")
async def list_pins(request: Request, space_id: str) -> JSONResponse:
    actor = require_group_actor(request, "group.messages.read")
    return _json({"messages": _service(request).list_pins(actor, _bounded_id(space_id, "space_id"))})


@router.post("/spaces/{space_id}/attachments")
async def create_attachment(
    request: Request,
    space_id: str,
    x_file_name: str = Header(alias="X-File-Name", min_length=1, max_length=255),
) -> JSONResponse:
    require_write_origin(request)
    actor = require_group_actor(request, "group.messages.write")
    settings = request.app.state.settings
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.group_attachment_max_bytes:
                raise HTTPException(status_code=413, detail="attachment_too_large")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid_content_length") from exc
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="attachment_empty")
    if len(payload) > settings.group_attachment_max_bytes:
        raise HTTPException(status_code=413, detail="attachment_too_large")
    mime_type = str(request.headers.get("content-type") or "application/octet-stream").split(";", 1)[0].strip()[:120]
    attachment = _service(request).create_attachment(
        actor,
        _bounded_id(space_id, "space_id"),
        name=x_file_name.strip(),
        mime_type=mime_type or "application/octet-stream",
        payload=payload,
    )
    return _json({"attachment": attachment}, status_code=201)


@router.get("/spaces/{space_id}/attachments/{attachment_id}")
async def get_attachment(request: Request, space_id: str, attachment_id: str) -> Response:
    actor = require_group_actor(request, "group.messages.read")
    metadata, payload = _service(request).get_attachment(
        actor,
        _bounded_id(space_id, "space_id"),
        _bounded_id(attachment_id, "attachment_id"),
    )
    safe_name = quote(metadata["name"], safe="")
    return Response(
        payload,
        media_type=metadata["mime_type"],
        headers={
            "Cache-Control": "no-store, private, max-age=0",
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
            "Content-Length": str(metadata["size_bytes"]),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/spaces/{space_id}/audit")
async def list_audit(
    request: Request,
    space_id: str,
    limit: int = Query(default=100, ge=1, le=200),
) -> JSONResponse:
    actor = require_group_actor(request, "group.spaces.read")
    events = _service(request).list_audit(actor, _bounded_id(space_id, "space_id"), limit=limit)
    return _json({"events": events})
