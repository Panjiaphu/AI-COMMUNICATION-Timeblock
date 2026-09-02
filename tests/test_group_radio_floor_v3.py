from __future__ import annotations

import asyncio

import pytest

from app.core.config import Settings
from app.group_v3.radio_floor import DistributedRadioFloor
from app.group_v3.service import GroupServiceError


class FakeAsyncRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def ping(self):
        return True

    async def close(self):
        return None

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


def _floor() -> DistributedRadioFloor:
    settings = Settings(
        app_env="test",
        debug=True,
        group_v3_enabled=True,
        group_radio_v3_enabled=True,
        group_radio_redis_url="redis://group-radio.test:6379",
        group_radio_floor_lease_seconds=15,
        group_radio_heartbeat_seconds=5,
        group_radio_max_burst_seconds=30,
    )
    floor = DistributedRadioFloor(settings)
    floor._client = FakeAsyncRedis()
    return floor


def test_distributed_floor_is_exclusive_renewable_and_owner_released():
    async def scenario():
        floor = _floor()
        await floor.ping()
        first = await floor.acquire(
            "radio-session-1",
            participant_id="participant-1",
            membership_id="membership-1",
            display_name="Nguyen Minh",
        )
        with pytest.raises(GroupServiceError, match="group_radio_floor_busy"):
            await floor.acquire(
                "radio-session-1",
                participant_id="participant-2",
                membership_id="membership-2",
                display_name="Tran An",
            )

        snapshot = await floor.snapshot("radio-session-1")
        assert snapshot["participant_id"] == "participant-1"
        assert snapshot["lease_remaining_ms"] == 15000
        renewed = await floor.heartbeat("radio-session-1", first["token"])
        assert renewed["lease_expires_at_ms"] <= renewed["deadline_ms"]
        await floor.assert_owner("radio-session-1", first["token"], "participant-1")

        with pytest.raises(GroupServiceError, match="group_radio_floor_not_owned"):
            await floor.release("radio-session-1", "wrong-floor-token")
        released = await floor.release("radio-session-1", first["token"])
        assert released == {"released": True, "participant_id": "participant-1"}
        assert await floor.snapshot("radio-session-1") is None

    asyncio.run(scenario())


def test_distributed_floor_enforces_max_burst_deadline(monkeypatch):
    async def scenario():
        floor = _floor()
        monkeypatch.setattr("app.group_v3.radio_floor.time.time", lambda: 1000.0)
        acquired = await floor.acquire(
            "radio-session-2",
            participant_id="participant-1",
            membership_id="membership-1",
            display_name="Nguyen Minh",
        )
        monkeypatch.setattr("app.group_v3.radio_floor.time.time", lambda: 1031.0)
        with pytest.raises(GroupServiceError, match="group_radio_max_burst_reached"):
            await floor.heartbeat("radio-session-2", acquired["token"])
        assert await floor.snapshot("radio-session-2") is None

    asyncio.run(scenario())
