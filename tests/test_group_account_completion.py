from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.bff.session_store import SessionStore
from app.models import (
    GroupInvitation,
    GroupMediaParticipant,
    GroupMembership,
    GroupRadioParticipant,
)
from tests.test_group_radio_floor_v3 import FakeAsyncRedis
from tests.test_group_v3_native import (
    AI_ENTITLEMENT,
    PUBLIC_ORIGIN,
    SCOPES,
    _future,
    _handoff_payload,
    _native_app,
)


DIRECT_SCOPES = ["identity.read", "directory.read", "connections.read"]


def _principal(
    principal_type: str,
    principal_id: str,
    user_id: str,
    display_name: str,
    locale: str = "vi",
) -> dict[str, str]:
    return {
        "type": principal_type,
        "id": principal_id,
        "user_id": user_id,
        "display_name": display_name,
        "locale": locale,
    }


def _app_session(app, principal: dict[str, str], token: str):
    group = app.state.bff_session_store.create_group_session(
        principal=principal,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id=f"handoff-{principal['type']}-{principal['id']}-{principal['user_id']}",
        surface="chat",
        entitlement={
            **AI_ENTITLEMENT,
            "billing_subject": f"{principal['type']}:{principal['id']}:{principal['user_id']}",
        },
    )
    return app.state.bff_session_store.grant_direct_authorization(
        group.session_id,
        timeblock_token=token,
        principal=principal,
        scope=DIRECT_SCOPES,
        expires_at=_future(),
    )


def _connection(
    principal_type: str,
    principal_id: str,
    public_id: str,
    display_name: str,
    *,
    status: str = "accepted",
    block_state: str = "none",
    directory_status: str = "active",
) -> dict:
    return {
        "id": f"friend-{public_id}",
        "status": status,
        "block_state": block_state,
        "peer": {
            "owner_type": principal_type,
            "owner_id": principal_id,
            "public_id": public_id,
            "display_name": display_name,
            "handle": f"@{public_id}",
            "status": directory_status,
        },
    }


class DirectoryStub:
    def __init__(self):
        self.connections = {
            "owner-token": {
                "connections": [
                    _connection("member", "84", "member-public-84", "Tran An"),
                    _connection("business", "biz-9", "business-public-9", "Kho Van 9"),
                    _connection("member", "blocked", "blocked-public", "Blocked", block_state="blocked"),
                    _connection("member", "pending", "pending-public", "Pending", status="pending"),
                    _connection("member", "inactive", "inactive-public", "Inactive", directory_status="inactive"),
                ]
            }
        }
        self.identities = {
            "member-token": {"directory": {"owner_type": "member", "owner_id": "84"}},
            "business-token": {"directory": {"owner_type": "business", "owner_id": "biz-9"}},
        }

    async def client_get(self, path: str, token: str, *, params=None):
        if path == "/api/guilua/v2/connections":
            return self.connections.get(token, {"connections": []})
        if path == "/api/guilua/v2/directory/me":
            return self.identities.get(token, {})
        raise AssertionError(path)

    async def aclose(self):
        return None


def test_one_app_session_preserves_direct_and_group_grants_in_both_orders():
    store = SessionStore(session_ttl_seconds=3600, pending_ttl_seconds=120)
    owner = _principal("member", "42", "42", "Nguyen Minh")
    other = _principal("member", "84", "84", "Tran An")

    group_first = store.create_group_session(
        principal=owner,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="group-first",
        surface="radio",
        entitlement=AI_ENTITLEMENT,
    )
    merged_direct = store.grant_direct_authorization(
        group_first.session_id,
        timeblock_token="direct-token",
        principal=owner,
        scope=DIRECT_SCOPES,
        expires_at=_future(),
    )
    assert merged_direct.session_id == group_first.session_id
    assert merged_direct.timeblock_token == "direct-token"
    assert merged_direct.group_authorized is True
    assert merged_direct.group_surface == "radio"

    direct_first = store.create_session(
        timeblock_token="direct-first-token",
        principal=owner,
        scope=DIRECT_SCOPES,
        expires_at=_future(),
    )
    merged_group = store.grant_group_authorization(
        direct_first.session_id,
        principal=owner,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="direct-first",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    assert merged_group.session_id == direct_first.session_id
    assert merged_group.timeblock_token == "direct-first-token"
    assert merged_group.group_authorized is True

    isolated = store.grant_direct_authorization(
        group_first.session_id,
        timeblock_token="other-token",
        principal=other,
        scope=DIRECT_SCOPES,
        expires_at=_future(),
    )
    assert isolated.session_id != group_first.session_id
    assert isolated.group_authorized is False
    assert store.get(group_first.session_id).principal == owner


class DirectAuthorizationStub:
    async def exchange_guilua_code(self, code: str, redirect_uri: str):
        return {
            "access_token": f"token-{code}",
            "principal": _principal("member", "42", "42", "Nguyen Minh"),
            "scope": DIRECT_SCOPES,
            "expires_at": _future(),
        }

    async def aclose(self):
        return None


def test_direct_callback_uses_safe_local_return_and_enables_group_entry(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = DirectAuthorizationStub()
    with TestClient(app, base_url=PUBLIC_ORIGIN) as client:
        start = client.get(
            "/api/session/start?return_to=/group/radio",
            follow_redirects=False,
        )
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        callback = client.get(
            f"/api/session/callback?code=safe&state={state}",
            follow_redirects=False,
        )
        assert callback.status_code == 303
        assert callback.headers["location"] == "/group/radio"
        status = client.get("/api/group/session").json()
        assert status["direct_available"] is True
        assert status["group_authorized"] is True
        assert "token-safe" not in str(status)

        unsafe = client.get(
            "/api/session/start?return_to=https://evil.example/steal",
            follow_redirects=False,
        )
        unsafe_state = parse_qs(urlparse(unsafe.headers["location"]).query)["state"][0]
        unsafe_callback = client.get(
            f"/api/session/callback?code=unsafe&state={unsafe_state}",
            follow_redirects=False,
        )
        assert unsafe_callback.headers["location"] == "/"


def test_native_invitations_resolve_timeblock_contacts_and_accept_member_and_business(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = DirectoryStub()
    owner = _app_session(app, _handoff_payload()["principal"], "owner-token")
    member = _app_session(app, _principal("member", "84", "84", "Tran An", "en"), "member-token")
    business = _app_session(
        app,
        _principal("business", "biz-9", "business-user-7", "Kho Van 9", "zh-TW"),
        "business-token",
    )
    headers = {"Origin": PUBLIC_ORIGIN}

    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        created = client.post(
            "/api/group/spaces",
            json={"title": "Account completion", "description": "Native invitations"},
            headers={**headers, "Idempotency-Key": "account-completion-space"},
        )
        assert created.status_code == 201
        space_id = created.json()["space"]["id"]

        candidates = client.get(f"/api/group/spaces/{space_id}/directory/connections")
        assert candidates.status_code == 200
        assert {item["contact_ref"] for item in candidates.json()["candidates"]} == {
            "member-public-84",
            "business-public-9",
        }
        assert "principal_id" not in candidates.text
        assert "owner-token" not in candidates.text

        member_invite = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "member-public-84"},
            headers=headers,
        )
        assert member_invite.status_code == 201
        assert "principal_id" not in member_invite.text
        duplicate = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "member-public-84"},
            headers=headers,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["idempotent"] is True
        forged = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={
                "contact_ref": "member-public-84",
                "principal_id": "forged",
                "role": "admin",
            },
            headers=headers,
        )
        assert forged.status_code == 422

        business_invite = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "business-public-9"},
            headers=headers,
        )
        assert business_invite.status_code == 201
        cancelled = client.delete(
            f"/api/group/spaces/{space_id}/invitations/{business_invite.json()['invitation']['id']}",
            headers=headers,
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["invitation"]["status"] == "cancelled"
        business_invite = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "business-public-9"},
            headers=headers,
        )
        assert business_invite.status_code == 201

        client.cookies.set(app.state.settings.guilua_session_cookie, member.session_id)
        incoming = client.get("/api/group/invitations")
        assert incoming.status_code == 200
        assert [item["id"] for item in incoming.json()["invitations"]] == [
            member_invite.json()["invitation"]["id"]
        ]
        accepted_member = client.post(
            f"/api/group/invitations/{member_invite.json()['invitation']['id']}/accept",
            headers=headers,
        )
        assert accepted_member.status_code == 200
        assert accepted_member.json()["membership"]["principal_user_id"] == "84"
        assert accepted_member.json()["membership"]["role"] == "member"

        client.cookies.set(app.state.settings.guilua_session_cookie, business.session_id)
        rejected_business = client.post(
            f"/api/group/invitations/{business_invite.json()['invitation']['id']}/reject",
            headers=headers,
        )
        assert rejected_business.status_code == 200
        assert rejected_business.json()["invitation"]["status"] == "rejected"

        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        business_invite = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "business-public-9"},
            headers=headers,
        )
        assert business_invite.status_code == 201
        client.cookies.set(app.state.settings.guilua_session_cookie, business.session_id)
        accepted_business = client.post(
            f"/api/group/invitations/{business_invite.json()['invitation']['id']}/accept",
            headers=headers,
        )
        assert accepted_business.status_code == 200
        assert accepted_business.json()["membership"]["principal_type"] == "business"
        assert accepted_business.json()["membership"]["principal_user_id"] == "business-user-7"

    with app.state.database.session() as db:
        stored = db.scalar(
            select(GroupInvitation).where(
                GroupInvitation.target_public_id == "business-public-9",
                GroupInvitation.status == "accepted",
            )
        )
        assert stored is not None
        assert stored.target_id == "biz-9"
        membership = db.scalar(
            select(GroupMembership).where(
                GroupMembership.space_id == space_id,
                GroupMembership.principal_type == "business",
                GroupMembership.principal_id == "biz-9",
                GroupMembership.principal_user_id == "business-user-7",
                GroupMembership.status == "active",
            )
        )
        assert membership is not None


def test_acceptance_fails_closed_on_timeblock_identity_mismatch(tmp_path):
    app = _native_app(tmp_path)
    directory = DirectoryStub()
    directory.identities["member-token"] = {
        "directory": {"owner_type": "member", "owner_id": "different"}
    }
    app.state.timeblock_client = directory
    owner = _app_session(app, _handoff_payload()["principal"], "owner-token")
    member = _app_session(app, _principal("member", "84", "84", "Tran An"), "member-token")
    headers = {"Origin": PUBLIC_ORIGIN}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        space = client.post(
            "/api/group/spaces",
            json={"title": "Mismatch identity", "description": "fail closed"},
            headers={**headers, "Idempotency-Key": "mismatch-space-0001"},
        ).json()["space"]
        invitation = client.post(
            f"/api/group/spaces/{space['id']}/invitations",
            json={"contact_ref": "member-public-84"},
            headers=headers,
        ).json()["invitation"]
        client.cookies.set(app.state.settings.guilua_session_cookie, member.session_id)
        denied = client.post(
            f"/api/group/invitations/{invitation['id']}/accept",
            headers=headers,
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "timeblock_identity_mismatch"


def test_expired_invitation_releases_contact_for_a_new_invite(tmp_path):
    app = _native_app(tmp_path)
    app.state.timeblock_client = DirectoryStub()
    owner = _app_session(app, _handoff_payload()["principal"], "owner-token")
    headers = {"Origin": PUBLIC_ORIGIN}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        space_id = client.post(
            "/api/group/spaces",
            json={"title": "Expiry", "description": "durable invitation expiry"},
            headers={**headers, "Idempotency-Key": "invitation-expiry-space"},
        ).json()["space"]["id"]
        invitation = client.post(
            f"/api/group/spaces/{space_id}/invitations",
            json={"contact_ref": "member-public-84"},
            headers=headers,
        ).json()["invitation"]
        with app.state.database.session() as db, db.begin():
            stored = db.get(GroupInvitation, invitation["id"])
            stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

        listed = client.get(f"/api/group/spaces/{space_id}/invitations")
        assert listed.status_code == 200
        expired = next(item for item in listed.json()["invitations"] if item["id"] == invitation["id"])
        assert expired["status"] == "expired"
        candidates = client.get(f"/api/group/spaces/{space_id}/directory/connections")
        member = next(
            item for item in candidates.json()["candidates"]
            if item["contact_ref"] == "member-public-84"
        )
        assert member["membership_status"] == "available"


def test_raw_membership_creation_is_not_a_production_contract(tmp_path):
    app = _native_app(tmp_path)
    owner = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload()["principal"],
        scope=SCOPES,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        handoff_id="raw-membership-production-guard",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    headers = {"Origin": PUBLIC_ORIGIN}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        space_id = client.post(
            "/api/group/spaces",
            json={"title": "Production guard", "description": ""},
            headers={**headers, "Idempotency-Key": "production-guard-space"},
        ).json()["space"]["id"]
        app.state.settings.app_env = "production"
        app.state.settings.debug = False
        denied = client.post(
            f"/api/group/spaces/{space_id}/memberships",
            json={
                "principal_type": "member",
                "principal_id": "forged",
                "principal_user_id": "forged",
                "display_name": "Forged",
                "role": "admin",
            },
            headers=headers,
        )
        assert denied.status_code == 410
        assert denied.json()["detail"] == "group_membership_direct_write_disabled"


def test_admin_cannot_escalate_roles_but_owner_can(tmp_path):
    app = _native_app(tmp_path)
    owner = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload()["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="role-owner",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    admin_principal = _principal("member", "84", "84", "Admin")
    admin = app.state.bff_session_store.create_group_session(
        principal=admin_principal,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="role-admin",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    headers = {"Origin": PUBLIC_ORIGIN}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        space_id = client.post(
            "/api/group/spaces",
            json={"title": "Role control", "description": "owner only"},
            headers={**headers, "Idempotency-Key": "role-control-space"},
        ).json()["space"]["id"]
        admin_membership = client.post(
            f"/api/group/spaces/{space_id}/memberships",
            json={
                "principal_type": "member",
                "principal_id": "84",
                "principal_user_id": "84",
                "display_name": "Admin",
                "role": "admin",
            },
            headers=headers,
        ).json()["membership"]
        regular_membership = client.post(
            f"/api/group/spaces/{space_id}/memberships",
            json={
                "principal_type": "member",
                "principal_id": "85",
                "principal_user_id": "85",
                "display_name": "Regular",
                "role": "member",
            },
            headers=headers,
        ).json()["membership"]

        client.cookies.set(app.state.settings.guilua_session_cookie, admin.session_id)
        denied = client.patch(
            f"/api/group/spaces/{space_id}/memberships/{regular_membership['id']}",
            json={"role": "admin"},
            headers=headers,
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "group_admin_member_only"

        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        promoted = client.patch(
            f"/api/group/spaces/{space_id}/memberships/{regular_membership['id']}",
            json={"role": "admin"},
            headers=headers,
        )
        assert promoted.status_code == 200
        assert promoted.json()["membership"]["role"] == "admin"
        assert admin_membership["role"] == "admin"


def test_removed_membership_is_revoked_across_group_surfaces(tmp_path):
    app = _native_app(
        tmp_path,
        group_media_enabled=True,
        group_livekit_url="wss://group-v3.livekit.cloud",
        group_livekit_api_key="livekit-api-key",
        group_livekit_api_secret="livekit-api-secret",
        group_radio_v3_enabled=True,
        group_radio_redis_url="redis://group-radio.test:6379",
    )
    app.state.group_radio_floor._client = FakeAsyncRedis()
    owner = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload()["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="removal-owner",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    member_principal = _principal("member", "84", "84", "Removed member")
    member = app.state.bff_session_store.create_group_session(
        principal=member_principal,
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="removal-member",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    headers = {"Origin": PUBLIC_ORIGIN}
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, owner.session_id)
        space_id = client.post(
            "/api/group/spaces",
            json={"title": "Removal graph", "description": "all surfaces"},
            headers={**headers, "Idempotency-Key": "removal-graph-space"},
        ).json()["space"]["id"]
        membership = client.post(
            f"/api/group/spaces/{space_id}/memberships",
            json={
                "principal_type": "member",
                "principal_id": "84",
                "principal_user_id": "84",
                "display_name": "Removed member",
                "role": "member",
            },
            headers=headers,
        ).json()["membership"]
        media = client.post(
            f"/api/group/spaces/{space_id}/sessions",
            json={
                "media_kind": "video",
                "title": "Removal video",
                "participant_membership_ids": [membership["id"]],
            },
            headers=headers,
        )
        assert media.status_code == 201
        radio = client.post(
            f"/api/group/spaces/{space_id}/radio/sessions",
            json={
                "title": "Removal radio",
                "participant_membership_ids": [membership["id"]],
            },
            headers=headers,
        )
        assert radio.status_code == 201
        removed = client.patch(
            f"/api/group/spaces/{space_id}/memberships/{membership['id']}",
            json={"status": "removed"},
            headers=headers,
        )
        assert removed.status_code == 200

        client.cookies.set(app.state.settings.guilua_session_cookie, member.session_id)
        assert client.get(f"/api/group/spaces/{space_id}/messages").status_code == 403
        assert client.get(f"/api/group/spaces/{space_id}/sessions").status_code == 403
        assert client.get(f"/api/group/spaces/{space_id}/radio/sessions").status_code == 403
        assert client.get(f"/api/group/spaces/{space_id}/translation/profile").status_code == 403

    with app.state.database.session() as db:
        media_participant = db.scalar(
            select(GroupMediaParticipant).where(
                GroupMediaParticipant.membership_id == membership["id"]
            )
        )
        radio_participant = db.scalar(
            select(GroupRadioParticipant).where(
                GroupRadioParticipant.membership_id == membership["id"]
            )
        )
        assert media_participant is not None
        assert media_participant.invite_status == "left"
        assert radio_participant is not None
        assert radio_participant.status == "removed"
