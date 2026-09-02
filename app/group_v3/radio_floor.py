from __future__ import annotations

import json
import secrets
import time

from redis import asyncio as redis_async
from redis.exceptions import RedisError

from app.core.config import Settings
from app.group_v3.service import GroupServiceError


_HEARTBEAT_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
local ttl = tonumber(ARGV[2])
if ttl <= 0 then redis.call('DEL', KEYS[1]); return -1 end
redis.call('PEXPIRE', KEYS[1], ttl)
return ttl
"""

_RELEASE_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
"""


class DistributedRadioFloor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.enabled = bool(settings.group_v3_enabled and settings.group_radio_v3_enabled)
        self._client = None

    def _key(self, session_id: str) -> str:
        return f"{self.settings.group_radio_redis_namespace}:floor:{session_id}"

    def _redis(self):
        if not self.enabled or not self.settings.group_radio_redis_url:
            raise GroupServiceError("group_radio_distributed_floor_disabled", 503)
        if self._client is None:
            self._client = redis_async.from_url(
                self.settings.group_radio_redis_url,
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=3,
                health_check_interval=30,
            )
        return self._client

    async def ping(self) -> None:
        try:
            await self._redis().ping()
        except RedisError as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def acquire(self, session_id: str, *, participant_id: str, membership_id: str, display_name: str) -> dict:
        token = secrets.token_urlsafe(32)
        now_ms = int(time.time() * 1000)
        deadline_ms = now_ms + self.settings.group_radio_max_burst_seconds * 1000
        value = json.dumps(
            {
                "token": token,
                "participant_id": participant_id,
                "membership_id": membership_id,
                "display_name": display_name[:120],
                "acquired_at_ms": now_ms,
                "deadline_ms": deadline_ms,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        ttl_ms = min(self.settings.group_radio_floor_lease_seconds, self.settings.group_radio_max_burst_seconds) * 1000
        try:
            acquired = await self._redis().set(self._key(session_id), value, nx=True, px=ttl_ms)
        except RedisError as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc
        if not acquired:
            raise GroupServiceError("group_radio_floor_busy", 409)
        return {"token": token, "value": value, "deadline_ms": deadline_ms, "lease_expires_at_ms": now_ms + ttl_ms}

    async def _owned_value(self, session_id: str, token: str) -> tuple[str, dict]:
        try:
            value = await self._redis().get(self._key(session_id))
        except RedisError as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc
        if not value:
            raise GroupServiceError("group_radio_floor_not_owned", 409)
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as exc:
            raise GroupServiceError("group_radio_floor_state_invalid", 503) from exc
        supplied = str(token or "")
        stored = str(payload.get("token") or "")
        if not supplied or not stored or not secrets.compare_digest(supplied, stored):
            raise GroupServiceError("group_radio_floor_not_owned", 409)
        return value, payload

    async def heartbeat(self, session_id: str, token: str) -> dict:
        value, payload = await self._owned_value(session_id, token)
        now_ms = int(time.time() * 1000)
        remaining_ms = int(payload.get("deadline_ms") or 0) - now_ms
        ttl_ms = min(self.settings.group_radio_floor_lease_seconds * 1000, remaining_ms)
        try:
            result = int(await self._redis().eval(_HEARTBEAT_SCRIPT, 1, self._key(session_id), value, ttl_ms))
        except (RedisError, TypeError, ValueError) as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc
        if result <= 0:
            raise GroupServiceError("group_radio_max_burst_reached" if result < 0 else "group_radio_floor_not_owned", 409)
        return {"lease_expires_at_ms": now_ms + result, "deadline_ms": int(payload["deadline_ms"])}

    async def release(self, session_id: str, token: str) -> dict:
        value, payload = await self._owned_value(session_id, token)
        try:
            released = int(await self._redis().eval(_RELEASE_SCRIPT, 1, self._key(session_id), value))
        except (RedisError, TypeError, ValueError) as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc
        if released != 1:
            raise GroupServiceError("group_radio_floor_not_owned", 409)
        return {"released": True, "participant_id": payload["participant_id"]}

    async def assert_owner(self, session_id: str, token: str, participant_id: str) -> None:
        _value, payload = await self._owned_value(session_id, token)
        if not secrets.compare_digest(str(payload.get("participant_id") or ""), participant_id):
            raise GroupServiceError("group_radio_floor_not_owned", 409)

    async def snapshot(self, session_id: str) -> dict | None:
        try:
            value = await self._redis().get(self._key(session_id))
            ttl = await self._redis().pttl(self._key(session_id)) if value else -2
        except RedisError as exc:
            raise GroupServiceError("group_radio_floor_unavailable", 503) from exc
        if not value:
            return None
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as exc:
            raise GroupServiceError("group_radio_floor_state_invalid", 503) from exc
        return {
            "participant_id": payload.get("participant_id"),
            "membership_id": payload.get("membership_id"),
            "display_name": payload.get("display_name"),
            "deadline_ms": payload.get("deadline_ms"),
            "lease_remaining_ms": max(0, int(ttl)),
        }
