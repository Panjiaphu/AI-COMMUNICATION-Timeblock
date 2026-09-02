from __future__ import annotations

import asyncio

from app.core.config import Settings
from app.group_translation.provider import OpenAIGroupTranslationProvider


class FakeResponse:
    status_code = 200
    headers = {"x-request-id": "request-123"}

    @staticmethod
    def json():
        return {
            "model": "gpt-4.1-mini-2025-04-14",
            "output_text": "Hello operations team",
            "output": [],
        }


class FakeAsyncClient:
    captured: dict = {}

    def __init__(self, *, timeout):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, *, headers, json):
        self.captured = {"url": url, "headers": headers, "json": json, "timeout": self.timeout}
        FakeAsyncClient.captured = self.captured
        return FakeResponse()


def test_responses_translation_is_server_only_stateless_and_privacy_preserving(monkeypatch):
    monkeypatch.setattr(
        "app.group_translation.provider.httpx.AsyncClient",
        FakeAsyncClient,
    )
    provider = OpenAIGroupTranslationProvider(
        Settings(
            app_env="test",
            debug=True,
            group_translation_enabled=True,
            openai_api_key="render-openai-key-server-only",
            openai_text_translation_model="gpt-4.1-mini",
        )
    )

    result = asyncio.run(
        provider.translate_text(
            source_text="Xin chào đội vận hành",
            source_language="vi",
            target_language="en",
            principal_id="member:42:42",
            idempotency_key="provider-idempotency-1",
        )
    )

    request = FakeAsyncClient.captured
    assert request["url"] == "https://api.openai.com/v1/responses"
    assert request["headers"]["Authorization"] == "Bearer render-openai-key-server-only"
    assert request["headers"]["Idempotency-Key"] == "provider-idempotency-1"
    assert request["json"]["store"] is False
    assert request["json"]["model"] == "gpt-4.1-mini"
    assert request["json"]["safety_identifier"] != "member:42:42"
    assert len(request["json"]["safety_identifier"]) == 64
    assert "render-openai-key-server-only" not in str(request["json"])
    assert result.text == "Hello operations team"
    assert result.request_id == "request-123"
