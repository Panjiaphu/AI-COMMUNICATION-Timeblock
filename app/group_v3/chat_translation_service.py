from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.db import Database
from app.group_translation.provider import (
    GroupTranslationProviderError,
    OpenAIGroupTranslationProvider,
)
from app.group_v3.auth import GroupActor
from app.group_v3.crypto import GroupCrypto
from app.group_v3.service import GroupServiceError
from app.models import (
    GroupAuditEvent,
    GroupChatTranslation,
    GroupLanguageProfile,
    GroupMembership,
    GroupMessage,
    GroupTranslationConsent,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


class GroupChatTranslationService:
    def __init__(
        self,
        database: Database,
        settings: Settings,
        crypto: GroupCrypto,
        provider: OpenAIGroupTranslationProvider,
    ) -> None:
        self.database = database
        self.settings = settings
        self.crypto = crypto
        self.provider = provider

    @staticmethod
    def _membership(db, space_id: str, actor: GroupActor) -> GroupMembership:
        membership = db.scalar(
            select(GroupMembership).where(
                GroupMembership.space_id == space_id,
                GroupMembership.principal_type == actor.principal_type,
                GroupMembership.principal_id == actor.principal_id,
                GroupMembership.principal_user_id == actor.principal_user_id,
                GroupMembership.status == "active",
            )
        )
        if not membership:
            raise GroupServiceError("group_membership_required", 403)
        return membership

    @staticmethod
    def _audit(
        db,
        actor: GroupActor,
        space_id: str,
        event_type: str,
        translation_id: str,
        *,
        outcome: str = "success",
        metadata: dict | None = None,
    ) -> None:
        db.add(
            GroupAuditEvent(
                id=str(uuid4()),
                space_id=space_id,
                actor_type=actor.principal_type,
                actor_id=actor.principal_id,
                actor_user_id=actor.principal_user_id,
                event_type=event_type,
                resource_type="chat_translation",
                resource_id=translation_id,
                outcome=outcome,
                metadata_json=json.dumps(
                    metadata or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ),
            )
        )

    def _message_text(self, message: GroupMessage) -> str:
        return self.crypto.decrypt_text(
            message.content_ciphertext,
            message.content_nonce,
            aad=f"group-message:{message.space_id}:{message.id}",
            version=message.encryption_version,
        )

    @staticmethod
    def _fingerprint(message: GroupMessage, text: str) -> str:
        revision = _iso(message.edited_at) or _iso(message.created_at) or ""
        return hashlib.sha256(
            f"{message.id}\0{revision}\0{text}".encode("utf-8")
        ).hexdigest()

    def _payload(self, item: GroupChatTranslation, translated_text: str | None = None) -> dict:
        if item.status == "final" and translated_text is None:
            if not item.translated_ciphertext or not item.translated_nonce:
                raise GroupServiceError("group_chat_translation_corrupt", 500)
            translated_text = self.crypto.decrypt_text(
                item.translated_ciphertext,
                item.translated_nonce,
                aad=f"group-chat-translation:{item.space_id}:{item.id}",
                version=item.encryption_version,
            )
        return {
            "id": item.id,
            "message_id": item.message_id,
            "source_language": item.source_language,
            "target_language": item.target_language,
            "state": item.status.upper(),
            "translated_text": translated_text or "",
            "provider_model": item.provider_model if item.status == "final" else "",
            "final_at": _iso(item.final_at),
        }

    def _prepare(
        self,
        actor: GroupActor,
        space_id: str,
        message_id: str,
        idempotency_key: str,
    ) -> dict:
        if not self.settings.group_translation_enabled:
            raise GroupServiceError("group_translation_disabled", 503)
        key = str(idempotency_key or "").strip()
        if not 8 <= len(key) <= 128 or any(character.isspace() for character in key):
            raise GroupServiceError("idempotency_key_required", 400)
        with self.database.session() as db:
            try:
                with db.begin():
                    membership = self._membership(db, space_id, actor)
                    consent = db.scalar(
                        select(GroupTranslationConsent).where(
                            GroupTranslationConsent.space_id == space_id,
                            GroupTranslationConsent.membership_id == membership.id,
                        )
                    )
                    if (
                        not consent
                        or consent.status != "granted"
                        or consent.policy_version != self.settings.group_translation_policy_version
                    ):
                        raise GroupServiceError("group_translation_consent_required", 409)
                    profile = db.scalar(
                        select(GroupLanguageProfile).where(
                            GroupLanguageProfile.space_id == space_id,
                            GroupLanguageProfile.membership_id == membership.id,
                        )
                    )
                    target_language = (
                        profile.preferred_output_language if profile else actor.locale
                    )
                    if profile and not profile.auto_translate_enabled:
                        raise GroupServiceError("group_chat_auto_translation_disabled", 409)
                    message = db.scalar(
                        select(GroupMessage).where(
                            GroupMessage.id == message_id,
                            GroupMessage.space_id == space_id,
                            GroupMessage.status == "active",
                        )
                    )
                    if not message:
                        raise GroupServiceError("group_message_not_found", 404)
                    if message.content_type != "text":
                        raise GroupServiceError("group_chat_translation_text_only", 409)
                    original_text = self._message_text(message)
                    source_language = message.source_language
                    if source_language == target_language:
                        return {"skipped": True, "reason": "source_target_same"}
                    fingerprint = self._fingerprint(message, original_text)
                    by_key = db.scalar(
                        select(GroupChatTranslation).where(
                            GroupChatTranslation.recipient_membership_id == membership.id,
                            GroupChatTranslation.idempotency_key == key,
                        )
                    )
                    if by_key:
                        if by_key.message_id != message.id or by_key.message_fingerprint != fingerprint:
                            raise GroupServiceError("idempotency_key_conflict", 409)
                        if by_key.status == "failed":
                            raise GroupServiceError(
                                by_key.failure_code or "group_translation_provider_failed", 503
                            )
                        return {
                            "item": by_key,
                            "start_provider": False,
                            "idempotent": True,
                        }
                    existing = db.scalar(
                        select(GroupChatTranslation)
                        .where(
                            GroupChatTranslation.message_id == message.id,
                            GroupChatTranslation.recipient_membership_id == membership.id,
                            GroupChatTranslation.target_language == target_language,
                            GroupChatTranslation.message_fingerprint == fingerprint,
                        )
                        .with_for_update()
                    )
                    stale_before = _now() - timedelta(seconds=45)
                    if existing and existing.status == "final":
                        return {
                            "item": existing,
                            "start_provider": False,
                            "idempotent": True,
                        }
                    if existing and existing.status == "pending":
                        updated_at = existing.updated_at
                        if updated_at.tzinfo is None:
                            updated_at = updated_at.replace(tzinfo=timezone.utc)
                        if updated_at > stale_before:
                            return {
                                "item": existing,
                                "start_provider": False,
                                "idempotent": True,
                            }
                    if existing:
                        item = existing
                        item.idempotency_key = key
                        item.source_language = source_language
                        item.status = "pending"
                        item.translated_ciphertext = None
                        item.translated_nonce = None
                        item.encryption_version = ""
                        item.provider_model = ""
                        item.provider_request_id = ""
                        item.failure_code = ""
                        item.final_at = None
                        item.updated_at = _now()
                    else:
                        item = GroupChatTranslation(
                            id=str(uuid4()),
                            space_id=space_id,
                            message_id=message.id,
                            recipient_membership_id=membership.id,
                            idempotency_key=key,
                            message_fingerprint=fingerprint,
                            source_language=source_language,
                            target_language=target_language,
                            status="pending",
                        )
                        db.add(item)
                    self._audit(
                        db,
                        actor,
                        space_id,
                        "chat_translation.requested",
                        item.id,
                        metadata={
                            "message_id": message.id,
                            "source_language": source_language,
                            "target_language": target_language,
                        },
                    )
                    db.flush()
                    return {
                        "item": item,
                        "start_provider": True,
                        "idempotent": False,
                        "original_text": original_text,
                    }
            except IntegrityError as exc:
                raise GroupServiceError("group_chat_translation_conflict", 409) from exc

    def _mark_failed(
        self,
        actor: GroupActor,
        space_id: str,
        translation_id: str,
        failure_code: str,
    ) -> None:
        with self.database.session() as db:
            with db.begin():
                item = db.scalar(
                    select(GroupChatTranslation)
                    .where(
                        GroupChatTranslation.id == translation_id,
                        GroupChatTranslation.space_id == space_id,
                    )
                    .with_for_update()
                )
                if not item or item.status != "pending":
                    return
                item.status = "failed"
                item.failure_code = failure_code[:80]
                item.updated_at = _now()
                self._audit(
                    db,
                    actor,
                    space_id,
                    "chat_translation.failed",
                    item.id,
                    outcome="failure",
                    metadata={"failure_code": item.failure_code},
                )

    def _finalize(
        self,
        actor: GroupActor,
        space_id: str,
        translation_id: str,
        translated_text: str,
        provider_model: str,
        provider_request_id: str | None,
    ) -> dict:
        with self.database.session() as db:
            with db.begin():
                item = db.scalar(
                    select(GroupChatTranslation)
                    .where(
                        GroupChatTranslation.id == translation_id,
                        GroupChatTranslation.space_id == space_id,
                    )
                    .with_for_update()
                )
                if not item:
                    raise GroupServiceError("group_chat_translation_not_found", 404)
                if item.status == "final":
                    return self._payload(item)
                if item.status != "pending":
                    raise GroupServiceError("group_chat_translation_not_pending", 409)
                message = db.get(GroupMessage, item.message_id)
                if not message or message.status != "active":
                    raise GroupServiceError("group_message_not_found", 404)
                current_text = self._message_text(message)
                if self._fingerprint(message, current_text) != item.message_fingerprint:
                    item.status = "failed"
                    item.failure_code = "group_message_changed_during_translation"
                    item.updated_at = _now()
                    raise GroupServiceError("group_message_changed_during_translation", 409)
                ciphertext, nonce, version = self.crypto.encrypt_text(
                    translated_text,
                    aad=f"group-chat-translation:{space_id}:{item.id}",
                )
                item.translated_ciphertext = ciphertext
                item.translated_nonce = nonce
                item.encryption_version = version
                item.provider_model = provider_model[:80]
                item.provider_request_id = str(provider_request_id or "")[:128]
                item.failure_code = ""
                item.status = "final"
                item.final_at = _now()
                item.updated_at = item.final_at
                self._audit(
                    db,
                    actor,
                    space_id,
                    "chat_translation.final_persisted",
                    item.id,
                    metadata={
                        "message_id": item.message_id,
                        "state": "FINAL",
                        "target_language": item.target_language,
                    },
                )
                return self._payload(item, translated_text)

    async def translate(
        self,
        actor: GroupActor,
        space_id: str,
        message_id: str,
        idempotency_key: str,
    ) -> dict:
        prepared = self._prepare(actor, space_id, message_id, idempotency_key)
        if prepared.get("skipped"):
            return {"translation": None, "skipped": True, "reason": prepared["reason"]}
        item = prepared["item"]
        if not prepared["start_provider"]:
            if item.status == "final":
                return {"translation": self._payload(item), "idempotent": True}
            return {"translation": self._payload(item), "pending": True, "idempotent": True}
        try:
            result = await self.provider.translate_text(
                source_text=prepared["original_text"],
                source_language=item.source_language,
                target_language=item.target_language,
                principal_id=actor.key,
                idempotency_key=item.idempotency_key,
            )
        except GroupTranslationProviderError as exc:
            code = str(exc)
            self._mark_failed(actor, space_id, item.id, code)
            status_code = 503 if code in {
                "group_translation_disabled",
                "group_translation_provider_not_configured",
                "group_translation_provider_unavailable",
            } else 502
            raise GroupServiceError(code, status_code) from exc
        try:
            payload = self._finalize(
                actor,
                space_id,
                item.id,
                result.text,
                result.model,
                result.request_id,
            )
        except GroupServiceError as exc:
            if exc.code in {
                "group_message_not_found",
                "group_message_changed_during_translation",
            }:
                self._mark_failed(actor, space_id, item.id, exc.code)
            raise
        return {"translation": payload, "idempotent": False}

    def history(self, actor: GroupActor, space_id: str, limit: int) -> list[dict]:
        with self.database.session() as db:
            membership = self._membership(db, space_id, actor)
            profile = db.scalar(
                select(GroupLanguageProfile).where(
                    GroupLanguageProfile.space_id == space_id,
                    GroupLanguageProfile.membership_id == membership.id,
                )
            )
            target_language = profile.preferred_output_language if profile else actor.locale
            rows = list(
                db.scalars(
                    select(GroupChatTranslation)
                    .where(
                        GroupChatTranslation.space_id == space_id,
                        GroupChatTranslation.recipient_membership_id == membership.id,
                        GroupChatTranslation.status == "final",
                        GroupChatTranslation.target_language == target_language,
                    )
                    .order_by(GroupChatTranslation.final_at.desc())
                    .limit(limit)
                ).all()
            )
            payloads = []
            for item in rows:
                message = db.get(GroupMessage, item.message_id)
                if not message or message.status != "active":
                    continue
                if self._fingerprint(message, self._message_text(message)) != item.message_fingerprint:
                    continue
                payloads.append(self._payload(item))
            return payloads
