from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from app.core.config import Settings


class GroupMediaProviderError(RuntimeError):
    def __init__(self, code: str, status_code: int = 503):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _jwt_json(value: dict) -> str:
    return _b64url(json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def room_name(session_id: str) -> str:
    digest = hashlib.sha256(f"group-v3-session:{session_id}".encode("utf-8")).hexdigest()[:40]
    return f"ai-gv3-{digest}"


def participant_identity(session_id: str, membership_id: str) -> str:
    digest = hashlib.sha256(f"group-v3-participant:{session_id}:{membership_id}".encode("utf-8")).hexdigest()[:40]
    return f"gv3-{digest}"


@dataclass(frozen=True, slots=True)
class GroupMediaGrant:
    provider: str
    url: str
    room: str
    participant_identity: str
    token: str
    expires_at: str
    media_kind: str
    desired_video_subscriptions: tuple[str, ...]


class LiveKitGroupMediaProvider:
    def __init__(self, settings: Settings):
        self.enabled = bool(settings.group_v3_enabled and settings.group_media_enabled)
        self.url = str(settings.group_livekit_url or "").strip().rstrip("/")
        self.api_key = str(settings.group_livekit_api_key or "").strip()
        self.api_secret = str(settings.group_livekit_api_secret or "").strip()
        self.region = settings.group_livekit_region
        self.ttl_seconds = settings.group_livekit_token_ttl_seconds

    def _validated_client_url(self) -> str:
        if not self.enabled:
            raise GroupMediaProviderError("group_media_disabled")
        parsed = urlparse(self.url)
        if parsed.scheme not in {"https", "wss"} or not parsed.netloc or parsed.query or parsed.fragment:
            raise GroupMediaProviderError("group_livekit_url_invalid")
        if not self.api_key or not self.api_secret:
            raise GroupMediaProviderError("group_livekit_credentials_missing")
        if self.region != "Singapore" or self.ttl_seconds != 300:
            raise GroupMediaProviderError("group_livekit_policy_invalid")
        scheme = "wss" if parsed.scheme == "https" else parsed.scheme
        return f"{scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"

    def synthetic_validate(self) -> dict[str, object]:
        """Validate the configured LiveKit contract without minting a token."""
        url = self._validated_client_url()
        return {
            "provider": "livekit-cloud",
            "status": "configured",
            "url_origin": url,
            "region": self.region,
            "token_ttl_seconds": self.ttl_seconds,
        }

    def issue_grant(
        self,
        *,
        room: str,
        identity: str,
        media_kind: str,
        desired_video_subscriptions: tuple[str, ...],
        can_publish: bool = True,
    ) -> GroupMediaGrant:
        client_url = self._validated_client_url()
        if media_kind not in {"audio", "video"}:
            raise GroupMediaProviderError("group_media_kind_invalid", 400)
        now = int(time.time())
        expires = datetime.now(timezone.utc) + timedelta(seconds=self.ttl_seconds)
        grants = {
            "roomJoin": True,
            "room": room,
            "canPublish": can_publish,
            "canSubscribe": True,
            "canPublishData": True,
            "canPublishSources": (["microphone"] if media_kind == "audio" else ["microphone", "camera"]) if can_publish else [],
        }
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "iss": self.api_key,
            "sub": identity,
            "nbf": now - 1,
            "exp": now + self.ttl_seconds,
            "video": grants,
            "metadata": json.dumps(
                {
                    "application": "ai-communication-group-v3",
                    "region": self.region,
                    "media_kind": media_kind,
                    "can_publish": can_publish,
                    "desired_video_subscriptions": list(desired_video_subscriptions),
                },
                separators=(",", ":"),
            ),
        }
        signing_input = f"{_jwt_json(header)}.{_jwt_json(payload)}".encode("ascii")
        signature = hmac.new(self.api_secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        token = f"{signing_input.decode('ascii')}.{_b64url(signature)}"
        return GroupMediaGrant(
            provider="livekit-cloud",
            url=client_url,
            room=room,
            participant_identity=identity,
            token=token,
            expires_at=_iso(expires),
            media_kind=media_kind,
            desired_video_subscriptions=desired_video_subscriptions,
        )
