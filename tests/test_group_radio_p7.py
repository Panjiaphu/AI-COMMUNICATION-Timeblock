from __future__ import annotations

import asyncio

import pytest

from app.group_radio.floor import GroupRadioFloorError, RadioFloorManager


def test_floor_has_one_owner_and_same_attempt_is_idempotent():
    manager = RadioFloorManager(lease_seconds=15, max_burst_seconds=30)

    async def run():
        first = await manager.acquire("group-radio:room-1", "member:1", "generation-1")
        same = await manager.acquire("group-radio:room-1", "member:1", "generation-1")
        assert same.lease_id == first.lease_id
        with pytest.raises(GroupRadioFloorError, match="floor_busy"):
            await manager.acquire("group-radio:room-1", "member:2", "generation-2")
        return first

    lease = asyncio.run(run())
    assert lease.state == "TALKING"


def test_finalize_releases_before_downstream_and_is_idempotent():
    manager = RadioFloorManager()

    async def run():
        lease = await manager.acquire("group-radio:room-2", "member:1", "generation-1")
        released = await manager.finalize("group-radio:room-2", lease.lease_id)
        repeated = await manager.finalize("group-radio:room-2", lease.lease_id)
        snapshot = await manager.snapshot("group-radio:room-2")
        return released, repeated, snapshot

    released, repeated, snapshot = asyncio.run(run())
    assert released["state"] == "FINALIZING_BURST"
    assert repeated["status"] == "released"
    assert snapshot == {"room_id": "group-radio:room-2", "state": "READY", "active": False}


def test_heartbeat_and_leave_reject_other_owners():
    manager = RadioFloorManager()

    async def run():
        lease = await manager.acquire("group-radio:room-3", "member:1", "generation-1")
        with pytest.raises(GroupRadioFloorError, match="floor_not_owned"):
            await manager.heartbeat("group-radio:room-3", "wrong")
        with pytest.raises(GroupRadioFloorError, match="floor_not_owned"):
            await manager.leave("group-radio:room-3", "wrong")
        await manager.leave("group-radio:room-3", lease.lease_id)
        return await manager.snapshot("group-radio:room-3")

    assert asyncio.run(run())["state"] == "READY"


def test_listener_leave_does_not_release_active_speaker():
    manager = RadioFloorManager()

    async def run():
        lease = await manager.acquire("group-radio:room-4", "member:speaker", "generation-1")
        result = await manager.leave(
            "group-radio:room-4", participant_id="member:listener"
        )
        snapshot = await manager.snapshot("group-radio:room-4")
        return lease, result, snapshot

    lease, result, snapshot = asyncio.run(run())
    assert result["status"] == "ready"
    assert result["active_participant_id"] == "member:speaker"
    assert snapshot["active"] is True
    assert snapshot["lease_id"] == lease.lease_id
