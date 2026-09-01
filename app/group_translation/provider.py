from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings


class GroupTranslationProviderError(RuntimeError):
    """Raised when the OpenAI translation provider cannot issue a session."""


@dataclass(frozen=True, slots=True)
class TranslationClientSecret:
    value: str
    expires_at: int | None
    session_id: str
    request_id: str | None = None


class OpenAIGroupTranslationProvider:
    """Issue short-lived OpenAI translation secrets without exposing API keys."""

    endpoint = "https://api.openai.com/v1/realtime/translations/client_secrets"

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self.settings.group_translation_enabled and self.settings.openai_api_key)

    def synthetic_validate(self) -> dict[str, object]:
        """Validate provider configuration without issuing a client secret."""
        if not self.settings.group_translation_enabled:
            raise GroupTranslationProviderError("group_translation_disabled")
        if not str(self.settings.openai_api_key or "").strip():
            raise GroupTranslationProviderError("group_translation_provider_not_configured")
        return {
            "provider": "openai-realtime-translate",
            "status": "configured",
            "model": self.settings.openai_realtime_translation_model,
            "transcription_model": self.settings.openai_realtime_transcription_model,
            "client_secret_ttl_seconds": self.settings.group_translation_client_secret_ttl_seconds,
        }

    @staticmethod
    def _safety_identifier(principal_id: str) -> str:
        return hashlib.sha256(str(principal_id).encode("utf-8")).hexdigest()

    async def create_client_secret(
        self,
        *,
        source_language: str,
        target_language: str,
        principal_id: str,
    ) -> TranslationClientSecret:
        if not self.settings.group_translation_enabled:
            raise GroupTranslationProviderError("group_translation_disabled")
        api_key = str(self.settings.openai_api_key or "").strip()
        if not api_key:
            raise GroupTranslationProviderError("group_translation_provider_not_configured")
        if source_language == target_language:
            raise GroupTranslationProviderError("source_target_must_differ")
        payload = {
            "expires_after": {
                "anchor": "created_at",
                "seconds": self.settings.group_translation_client_secret_ttl_seconds,
            },
            "session": {
                "model": self.settings.openai_realtime_translation_model,
                "audio": {
                    "input": {
                        "transcription": {
                            "model": self.settings.openai_realtime_transcription_model,
                        },
                        "noise_reduction": None,
                    },
                    "output": {"language": target_language},
                },
            }
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "OpenAI-Safety-Identifier": self._safety_identifier(principal_id),
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(self.endpoint, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise GroupTranslationProviderError("group_translation_provider_unavailable") from exc
        if response.status_code >= 400:
            raise GroupTranslationProviderError("group_translation_provider_rejected")
        try:
            data: Any = response.json()
        except ValueError as exc:
            raise GroupTranslationProviderError("group_translation_provider_invalid_response") from exc
        secret = data.get("value") if isinstance(data, dict) else None
        if not isinstance(secret, str) and isinstance(data, dict):
            nested = data.get("client_secret")
            if isinstance(nested, dict):
                secret = nested.get("value")
        if not isinstance(secret, str) or not secret.strip() or len(secret) > 4096:
            raise GroupTranslationProviderError("group_translation_provider_invalid_response")
        expires_at = data.get("expires_at") if isinstance(data, dict) else None
        try:
            expires_at = int(expires_at) if expires_at is not None else None
        except (TypeError, ValueError):
            expires_at = None
        request_id = response.headers.get("x-request-id") or response.headers.get("x-openai-request-id")
        session_data = data.get("session") if isinstance(data, dict) else None
        session_id = session_data.get("id") if isinstance(session_data, dict) else None
        if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 128:
            raise GroupTranslationProviderError("group_translation_provider_invalid_response")
        return TranslationClientSecret(
            value=secret.strip(),
            expires_at=expires_at,
            session_id=session_id.strip(),
            request_id=request_id,
        )
