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
        try:
            data = response.json() if response.content else {}
        except ValueError as exc:
            raise TimeblockIntegrationError('timeblock_invalid_response') from exc
        if not isinstance(data, dict):
            raise TimeblockIntegrationError('timeblock_invalid_response')
        return data

    @staticmethod
    def _bind_authorized_session(
        data: dict,
        session_id: str,
        participant_id: str,
        workspace_id: str | None = None,
    ) -> AuthorizedSession:
        try:
            authorized = AuthorizedSession.model_validate(data)
        except Exception as exc:
            raise TimeblockIntegrationError('timeblock_invalid_response') from exc
        if authorized.session_id != session_id or authorized.participant_id != participant_id:
            raise TimeblockIntegrationError('authorization_boundary_mismatch')
        if workspace_id is not None and authorized.workspace_id != workspace_id:
            raise TimeblockIntegrationError('authorization_boundary_mismatch')
        return authorized

    @staticmethod
    def _authorization_payload(
        participant_id: str,
        session_token: str,
        *,
        workspace_id: str | None = None,
        issuer: str | None = None,
        audience: str | None = None,
    ) -> dict[str, str]:
        payload = {'participant_id': participant_id, 'session_token': session_token}
        if workspace_id:
            payload['workspace_id'] = workspace_id
        if issuer:
            payload['issuer'] = issuer
        if audience:
            payload['audience'] = audience
        return payload

    async def authorize_session(
        self,
        session_id: str,
        session_token: str,
        participant_id: str,
        *,
        workspace_id: str | None = None,
        issuer: str | None = None,
        audience: str | None = None,
    ) -> AuthorizedSession:
        if self.settings.development_session_fallback_enabled:
            if session_token != 'development-session':
                raise TimeblockIntegrationError('invalid_development_session')
            return AuthorizedSession(
                session_id=session_id,
                room_id=f'room-{session_id}',
                workspace_id=workspace_id or 'development',
                participant_id=participant_id,
            )
        data = await self._post(
            f'/api/communication/sessions/{session_id}/authorize',
            self._authorization_payload(
                participant_id,
                session_token,
                workspace_id=workspace_id,
                issuer=issuer,
                audience=audience,
            ),
        )
        return self._bind_authorized_session(data, session_id, participant_id, workspace_id)

    async def refresh_session(
        self,
        session_id: str,
        session_token: str,
        participant_id: str,
        *,
        workspace_id: str | None = None,
        issuer: str | None = None,
        audience: str | None = None,
    ) -> AuthorizedSession:
        if self.settings.development_session_fallback_enabled:
            return await self.authorize_session(
                session_id,
                session_token,
                participant_id,
                workspace_id=workspace_id,
                issuer=issuer,
                audience=audience,
            )
        data = await self._post(
            f'/api/communication/sessions/{session_id}/refresh',
            self._authorization_payload(
                participant_id,
                session_token,
                workspace_id=workspace_id,
                issuer=issuer,
                audience=audience,
            ),
        )
        return self._bind_authorized_session(data, session_id, participant_id, workspace_id)

    async def fetch_glossary(self, workspace_id: str, version: str | None = None) -> dict:
        return await self._post('/api/communication/glossary', {'workspace_id': workspace_id, 'version': version})

    async def submit_session_result(self, payload: dict, idempotency_key: str | None = None) -> None:
        if self.settings.development_session_fallback_enabled:
            return
        await self._post(
            '/api/communication/session-results',
            payload,
            idempotency_key=idempotency_key or str(uuid4()),
        )

    async def submit_usage(self, events: list[dict], idempotency_key: str | None = None) -> None:
        if self.settings.development_session_fallback_enabled:
            return
        await self._post(
            '/api/communication/usage',
            {'events': events},
            idempotency_key=idempotency_key or str(uuid4()),
        )
