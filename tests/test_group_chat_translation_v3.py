from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.group_translation.provider import (
    GroupTranslationProviderError,
    TextTranslationResult,
)
from app.models import GroupChatTranslation
from tests.test_group_v3_native import (
    AI_ENTITLEMENT,
    PUBLIC_ORIGIN,
    SCOPES,
    _future,
    _handoff_payload,
    _native_app,
)


@dataclass
class FakeTextProvider:
    translated_text: str
    failure_code: str = ""

    def __post_init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    async def translate_text(self, **values) -> TextTranslationResult:
        self.calls.append(dict(values))
        if self.failure_code:
            raise GroupTranslationProviderError(self.failure_code)
        return TextTranslationResult(
            text=self.translated_text,
            model="fake-translation-model",
            request_id="provider-request-1",
        )


def _translation_runtime(tmp_path, translated_text: str):
    app = _native_app(
        tmp_path,
        group_translation_enabled=True,
        openai_api_key="render-server-key-never-sent-to-browser",
    )
    provider = FakeTextProvider(translated_text)
    app.state.group_chat_translation_service.provider = provider
    session = app.state.bff_session_store.create_group_session(
        principal=_handoff_payload("chat")["principal"],
        scope=SCOPES,
        expires_at=_future(),
        handoff_id="handoff-v3-chat-translation",
        surface="chat",
        entitlement=AI_ENTITLEMENT,
    )
    return app, session, provider


def _create_space_message_and_preferences(
    client: TestClient,
    *,
    source_language: str,
    target_language: str,
    original_text: str,
) -> tuple[str, str]:
    headers = {"Origin": PUBLIC_ORIGIN}
    space = client.post(
        "/api/group/spaces",
        json={"title": "Translation QA", "description": "Native Group Chat"},
        headers={**headers, "Idempotency-Key": "translation-space-0001"},
    )
    assert space.status_code == 201
    space_id = space.json()["space"]["id"]
    profile = client.put(
        f"/api/group/spaces/{space_id}/translation/profile",
        json={
            "spoken_language": source_language,
            "preferred_output_language": target_language,
            "auto_translate_enabled": True,
            "auto_read_enabled": False,
            "show_original_enabled": True,
        },
        headers=headers,
    )
    assert profile.status_code == 200
    consent = client.put(
        f"/api/group/spaces/{space_id}/translation/consent",
        json={"status": "granted", "policy_version": "group-translation-v3-2026-08-31"},
        headers=headers,
    )
    assert consent.status_code == 200
    sent = client.post(
        f"/api/group/spaces/{space_id}/messages",
        json={
            "content": original_text,
            "content_type": "text",
            "client_message_id": "translation-message-0001",
            "source_language": source_language,
        },
        headers={**headers, "Idempotency-Key": "translation-message-0001"},
    )
    assert sent.status_code == 201
    return space_id, sent.json()["message"]["id"]


@pytest.mark.parametrize(
    ("source_language", "target_language", "original_text", "translated_text"),
    [
        ("vi", "en", "Xin chào đội vận hành", "Hello operations team"),
        ("vi", "zh-TW", "Xe đã tới cửa số hai", "車輛已抵達二號門"),
        ("en", "vi", "The shipment is ready", "Lô hàng đã sẵn sàng"),
        ("zh-TW", "vi", "請確認交接文件", "Vui lòng xác nhận tài liệu bàn giao"),
    ],
)
def test_chat_translation_is_final_recipient_linked_idempotent_and_encrypted(
    tmp_path,
    source_language: str,
    target_language: str,
    original_text: str,
    translated_text: str,
):
    app, session, provider = _translation_runtime(tmp_path, translated_text)
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        space_id, message_id = _create_space_message_and_preferences(
            client,
            source_language=source_language,
            target_language=target_language,
            original_text=original_text,
        )
        headers = {"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "chat-translation-0001"}
        translated = client.post(
            f"/api/group/spaces/{space_id}/messages/{message_id}/translation",
            headers=headers,
        )
        assert translated.status_code == 200
        payload = translated.json()["translation"]
        assert payload["message_id"] == message_id
        assert payload["source_language"] == source_language
        assert payload["target_language"] == target_language
        assert payload["state"] == "FINAL"
        assert payload["translated_text"] == translated_text

        repeated = client.post(
            f"/api/group/spaces/{space_id}/messages/{message_id}/translation",
            headers=headers,
        )
        assert repeated.status_code == 200
        assert repeated.json()["idempotent"] is True
        assert repeated.json()["translation"]["id"] == payload["id"]
        assert len(provider.calls) == 1

        messages = client.get(f"/api/group/spaces/{space_id}/messages?limit=10")
        assert messages.status_code == 200
        assert messages.json()["messages"][0]["content"] == original_text
        history = client.get(
            f"/api/group/spaces/{space_id}/translation/chat-history?limit=10"
        )
        assert history.status_code == 200
        assert history.json()["translations"][0]["message_id"] == message_id
        assert history.json()["translations"][0]["translated_text"] == translated_text

    with app.state.database.session() as db:
        stored = db.scalar(select(GroupChatTranslation))
        assert stored is not None
        assert stored.status == "final"
        assert translated_text.encode("utf-8") not in stored.translated_ciphertext
        assert stored.encryption_version == "aes-256-gcm-v1"


def test_chat_provider_failure_does_not_break_original_chat_and_can_retry(tmp_path):
    app, session, provider = _translation_runtime(tmp_path, "Recovered translation")
    provider.failure_code = "group_translation_provider_unavailable"
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        space_id, message_id = _create_space_message_and_preferences(
            client,
            source_language="vi",
            target_language="en",
            original_text="Tin nhắn gốc vẫn phải hoạt động",
        )
        failed = client.post(
            f"/api/group/spaces/{space_id}/messages/{message_id}/translation",
            headers={"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "chat-translation-fail-1"},
        )
        assert failed.status_code == 503
        assert failed.json()["detail"] == "group_translation_provider_unavailable"

        messages = client.get(f"/api/group/spaces/{space_id}/messages?limit=10")
        assert messages.status_code == 200
        assert messages.json()["messages"][0]["content"] == "Tin nhắn gốc vẫn phải hoạt động"

        provider.failure_code = ""
        retried = client.post(
            f"/api/group/spaces/{space_id}/messages/{message_id}/translation",
            headers={"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "chat-translation-retry-1"},
        )
        assert retried.status_code == 200
        assert retried.json()["translation"]["state"] == "FINAL"
        assert len(provider.calls) == 2


def test_chat_translation_requires_current_consent_before_provider_execution(tmp_path):
    app, session, provider = _translation_runtime(tmp_path, "Should not run")
    with TestClient(app) as client:
        client.cookies.set(app.state.settings.guilua_session_cookie, session.session_id)
        space = client.post(
            "/api/group/spaces",
            json={"title": "Consent QA", "description": ""},
            headers={"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "consent-space-0001"},
        )
        space_id = space.json()["space"]["id"]
        sent = client.post(
            f"/api/group/spaces/{space_id}/messages",
            json={
                "content": "Không gửi provider khi chưa đồng ý",
                "content_type": "text",
                "client_message_id": "consent-message-0001",
                "source_language": "vi",
            },
            headers={"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "consent-message-0001"},
        )
        denied = client.post(
            f"/api/group/spaces/{space_id}/messages/{sent.json()['message']['id']}/translation",
            headers={"Origin": PUBLIC_ORIGIN, "Idempotency-Key": "consent-translation-1"},
        )
        assert denied.status_code == 409
        assert denied.json()["detail"] == "group_translation_consent_required"
        assert provider.calls == []
