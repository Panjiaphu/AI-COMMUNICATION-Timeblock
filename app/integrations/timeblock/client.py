from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.communication.schemas import AuthorizedSession
from app.core.config import Settings


class TimeblockIntegrationError(RuntimeError):
    pass


@dataclass(slots=True)
class TimeblockClient:
    settings: Settings

    async def authorize_session(self, session_id: str, session_token: str, participant_id: str) -> AuthorizedSession:
        if self.settings.app_env == "development" and not self.settings.timeblock_api_url:
            if session_token != "development-session":
                raise TimeblockIntegrationError("invalid_development_session")
            return AuthorizedSession(
                session_id=session_id,
                room_id=f"room-{session_id}",
                workspace_id="development",
                participant_id=participant_id,
            )

        if not self.settings.timeblock_api_url or not self.settings.timeblock_api_key:
            raise TimeblockIntegrationError("timeblock_not_configured")

        url = f"{self.settings.timeblock_api_url.rstrip('/')}/api/communication/sessions/{session_id}/authorize"
        headers = {
            "Authorization": f"Bearer {self.settings.timeblock_api_key}",
            "X-Session-Token": session_token,
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url, headers=headers, json={"participant_id": participant_id})
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise TimeblockIntegrationError("timeblock_authorization_failed") from exc
        return AuthorizedSession.model_validate(response.json())

    async def submit_session_result(self, payload: dict) -> None:
        if not self.settings.timeblock_api_url or not self.settings.timeblock_api_key:
            if self.settings.app_env == "development":
                return
            raise TimeblockIntegrationError("timeblock_not_configured")
        url = f"{self.settings.timeblock_api_url.rstrip('/')}/api/communication/session-results"
        headers = {"Authorization": f"Bearer {self.settings.timeblock_api_key}"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise TimeblockIntegrationError("timeblock_result_callback_failed") from exc
