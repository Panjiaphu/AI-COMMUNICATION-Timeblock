from __future__ import annotations

from datetime import datetime, timedelta, timezone

import uvicorn
from fastapi import Query
from fastapi.responses import RedirectResponse

from app.core.config import Settings
from app.db import Base
from app.group_v3.auth import GroupActor
from app.main import create_app


PUBLIC_ORIGIN = "http://127.0.0.1:8765"
SCOPES = [
    "group.spaces.read",
    "group.spaces.write",
    "group.messages.read",
    "group.messages.write",
    "group.media.use",
    "group.translation.use",
    "group.radio.use",
]


class LocalQaRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def ping(self):
        return True

    async def aclose(self):
        return None

    async def set(self, key, value, *, nx=False, px=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        self.ttls[key] = int(px or -1)
        return True

    async def get(self, key):
        return self.values.get(key)

    async def pttl(self, key):
        return self.ttls.get(key, -2)

    async def eval(self, script, _key_count, key, expected, *arguments):
        if self.values.get(key) != expected:
            return 0
        if "PEXPIRE" in script:
            ttl = int(arguments[0])
            if ttl <= 0:
                self.values.pop(key, None)
                self.ttls.pop(key, None)
                return -1
            self.ttls[key] = ttl
            return ttl
        self.values.pop(key, None)
        self.ttls.pop(key, None)
        return 1


class LocalQaTimeblock:
    async def client_get(self, path, token, *, params=None):
        principal_id = "84" if token == "local-direct-84" else "42"
        if path == "/api/guilua/v2/directory/me":
            return {
                "entry": {
                    "owner_type": "member",
                    "owner_id": principal_id,
                    "public_id": f"qa-member-{principal_id}",
                    "display_name": "Trần An" if principal_id == "84" else "Nguyễn Minh",
                    "status": "active",
                }
            }
        if path == "/api/guilua/v2/connections":
            peer_id = "42" if principal_id == "84" else "84"
            connections = [
                {
                        "status": "accepted",
                        "block_state": "none",
                        "peer": {
                            "owner_type": "member",
                            "owner_id": peer_id,
                            "public_id": f"qa-member-{peer_id}",
                            "display_name": "Nguyễn Minh" if peer_id == "42" else "Trần An",
                            "handle": f"@qa-{peer_id}",
                            "status": "active",
                        },
                }
            ]
            if principal_id == "42":
                connections.append(
                    {
                        "status": "accepted",
                        "block_state": "none",
                        "peer": {
                            "owner_type": "business",
                            "owner_id": "qa-business-7",
                            "public_id": "qa-business-public-7",
                            "display_name": "Kho QA Đài Bắc",
                            "handle": "@qa-business-7",
                            "status": "active",
                        },
                    }
                )
            return {"connections": connections}
        raise RuntimeError("unsupported_local_qa_timeblock_path")

    async def aclose(self):
        return None


settings = Settings(
    _env_file=None,
    app_env="test",
    debug=True,
    secret_key="group-v3-local-browser-qa-only",
    public_base_url=PUBLIC_ORIGIN,
    timeblock_app_url="http://127.0.0.1:5000",
    allowed_timeblock_handoff_origins="http://127.0.0.1:5000",
    allowed_websocket_origins=PUBLIC_ORIGIN,
    allow_missing_bff_origin=False,
    group_v3_enabled=True,
    database_url="sqlite:///:memory:",
    group_message_encryption_key="ab" * 32,
    group_media_enabled=True,
    group_livekit_url="wss://local-qa.livekit.invalid",
    group_livekit_api_key="local-qa-key",
    group_livekit_api_secret="local-qa-secret",
    group_radio_v3_enabled=True,
    group_radio_redis_url="redis://local-qa.invalid:6379",
    group_translation_enabled=True,
    openai_api_key="local-qa-never-sent",
)
app = create_app(settings)
Base.metadata.create_all(app.state.database.engine)
app.state.group_radio_floor._client = LocalQaRedis()
app.state.timeblock_client = LocalQaTimeblock()

entitlement = {
    "group_communication": True,
    "authorization_authority": "ai-communication",
    "billing_subject": "member:42:42",
}
actor = GroupActor(
    principal_type="member",
    principal_id="42",
    principal_user_id="42",
    display_name="Nguyễn Minh",
    locale="vi",
    scope=frozenset(SCOPES),
    handoff_id="local-browser-qa",
    surface="chat",
    entitlement=entitlement,
)
created = app.state.group_service.create_space(
    actor,
    {"title": "Điều phối vận hành", "description": "Group V3 native local QA"},
    "local-browser-space",
)
space_id = created["space"]["id"]
invitee = app.state.group_service.add_member(
    actor,
    space_id,
    {
        "principal_type": "member",
        "principal_id": "84",
        "principal_user_id": "84",
        "display_name": "Trần An",
        "role": "member",
    },
)
app.state.group_service.create_message(
    actor,
    space_id,
    {
        "content": "Radio nhóm sẵn sàng cho ca vận hành.",
        "content_type": "text",
        "client_message_id": "local-browser-message",
        "reply_to_id": None,
        "attachment_ids": [],
    },
    "local-browser-message",
)
app.state.group_radio_service.create_session(
    actor,
    space_id,
    {"title": "Kênh vận hành", "participant_membership_ids": [invitee["id"]]},
)
@app.get("/__qa__/group-v3", include_in_schema=False)
async def enter_local_group_qa(
    surface: str = Query(
        default="chat",
        pattern="^(chat|chat-translation|call|video|radio|radio-translation|plugin)$",
    ),
    lang: str = Query(default="vi", pattern="^(vi|en|zh-TW)$"),
    identity: str = Query(default="owner", pattern="^(owner|invitee)$"),
):
    principal_id = "84" if identity == "invitee" else "42"
    display_name = "Trần An" if identity == "invitee" else "Nguyễn Minh"
    session_entitlement = dict(entitlement)
    session_entitlement["billing_subject"] = f"member:{principal_id}"
    group_session = app.state.bff_session_store.create_group_session(
        principal={
            "type": "member",
            "id": principal_id,
            "user_id": principal_id,
            "display_name": display_name,
            "locale": lang,
        },
        scope=SCOPES,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        handoff_id="local-browser-qa",
        surface=surface,
        entitlement=session_entitlement,
    )
    group_session = app.state.bff_session_store.grant_direct_authorization(
        group_session.session_id,
        timeblock_token=f"local-direct-{principal_id}",
        principal=group_session.principal,
        scope=["identity.read", "directory.read", "connections.read"],
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )
    response = RedirectResponse(
        f"/group/{surface}?lang={lang}", status_code=303
    )
    response.set_cookie(
        settings.guilua_session_cookie,
        group_session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
        max_age=3600,
    )
    return response


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
