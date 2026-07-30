from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import httpx

from app.communication.schemas import AuthorizedSession
from app.core.config import Settings


class TimeblockIntegrationError(RuntimeError):
    pass


@dataclass(slots=True)
class TimeblockClient:
    settings: Settings

    async def _post(self, path: str, payload: dict[str, Any], *, idempotency_key: str | None = None) -> dict:
        if not self.settings.timeblock_api_url or not self.settings.timeblock_api_key:
            raise TimeblockIntegrationError('timeblock_not_configured')
        headers = {'Authorization': f'Bearer {self.settings.timeblock_api_key}'}
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
        try:
            async with httpx.AsyncClient(timeout=self.settings.timeblock_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.timeblock_api_url.rstrip('/')}{path}",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise TimeblockIntegrationError('timeblock_request_failed') from exc
        return response.json() if response.content else {}

    async def authorize_session(self, session_id: str, session_token: str, participant_id: str) -> AuthorizedSession:
        if self.settings.app_env in {'development', 'test'} and not self.settings.timeblock_api_url:
            if session_token != 'development-session':
                raise TimeblockIntegrationError('invalid_development_session')
            return AuthorizedSession(
                session_id=session_id,
                room_id=f'room-{session_id}',
                workspace_id='development',
                participant_id=participant_id,
            )
        if not self.settings.timeblock_api_url or not self.settings.timeblock_api_key:
            raise TimeblockIntegrationError('timeblock_not_configured')
        # PROVISIONAL_CONTRACT: replace path only after the Timeblock API contract is approved.
        data = await self._post(
            f'/api/communication/sessions/{session_id}/authorize',
            {'participant_id': participant_id, 'session_token': session_token},
        )
        return AuthorizedSession.model_validate(data)

    async def refresh_session(self, session_id: str, session_token: str, participant_id: str) -> AuthorizedSession:
        if self.settings.app_env in {'development', 'test'} and not self.settings.timeblock_api_url:
            return await self.authorize_session(session_id, session_token, participant_id)
        # PROVISIONAL_CONTRACT: reconnect authorization remains fail-closed until Timeblock confirms the path.
        data = await self._post(
            f'/api/communication/sessions/{session_id}/refresh',
            {'participant_id': participant_id, 'session_token': session_token},
        )
        return AuthorizedSession.model_validate(data)

    async def fetch_glossary(self, workspace_id: str, version: str | None = None) -> dict:
        return await self._post('/api/communication/glossary', {'workspace_id': workspace_id, 'version': version})

    async def submit_session_result(self, payload: dict, idempotency_key: str | None = None) -> None:
        if self.settings.app_env in {'development', 'test'} and not self.settings.timeblock_api_url:
            return
        await self._post(
            '/api/communication/session-results',
            payload,
            idempotency_key=idempotency_key or str(uuid4()),
        )

    async def submit_usage(self, events: list[dict], idempotency_key: str | None = None) -> None:
        if self.settings.app_env in {'development', 'test'} and not self.settings.timeblock_api_url:
            return
        await self._post(
            '/api/communication/usage',
            {'events': events},
            idempotency_key=idempotency_key or str(uuid4()),
        )
