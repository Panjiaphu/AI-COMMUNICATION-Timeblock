from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.db import Database
from app.group_v3.auth import GroupActor
from app.group_v3.crypto import GroupCrypto
from app.group_v3.service import GroupServiceError
from app.models import (
    GroupAuditEvent,
    GroupLanguageProfile,
    GroupMediaParticipant,
    GroupMediaSession,
    GroupMembership,
    GroupRadioBurst,
    GroupRadioParticipant,
    GroupRadioProcessingJob,
    GroupRadioSession,
    GroupTranslationConsent,
    GroupTranslationEvent,
    GroupTranslationQuotaLedger,
    GroupTranslationReservation,
    GroupTtsJob,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _parse_time(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class GroupTranslationService:
    def __init__(self, database: Database, settings: Settings, crypto: GroupCrypto):
        self.database = database
        self.settings = settings
        self.crypto = crypto

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
    def _audit(db, actor: GroupActor, space_id: str, event_type: str, resource_type: str, resource_id: str, metadata: dict | None = None) -> None:
        db.add(
            GroupAuditEvent(
                id=str(uuid4()),
                space_id=space_id,
                actor_type=actor.principal_type,
                actor_id=actor.principal_id,
                actor_user_id=actor.principal_user_id,
                event_type=event_type,
                resource_type=resource_type,
                resource_id=resource_id,
                metadata_json=json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
        )

    @staticmethod
    def _profile_payload(item: GroupLanguageProfile) -> dict:
        return {
            "spoken_language": item.spoken_language,
            "preferred_output_language": item.preferred_output_language,
            "auto_translate_enabled": bool(item.auto_translate_enabled),
            "auto_read_enabled": bool(item.auto_read_enabled),
            "show_original_enabled": bool(item.show_original_enabled),
            "updated_at": _iso(item.updated_at),
        }

    def get_profile(self, actor: GroupActor, space_id: str) -> dict:
        with self.database.session() as db:
            membership = self._membership(db, space_id, actor)
            profile = db.scalar(select(GroupLanguageProfile).where(GroupLanguageProfile.space_id == space_id, GroupLanguageProfile.membership_id == membership.id))
            if not profile:
                return {
                    "spoken_language": "vi",
                    "preferred_output_language": actor.locale,
                    "auto_translate_enabled": True,
                    "auto_read_enabled": False,
                    "show_original_enabled": True,
                    "updated_at": None,
                }
            return self._profile_payload(profile)

    def update_profile(self, actor: GroupActor, space_id: str, values: dict) -> dict:
        with self.database.session() as db:
            with db.begin():
                membership = self._membership(db, space_id, actor)
                profile = db.scalar(select(GroupLanguageProfile).where(GroupLanguageProfile.space_id == space_id, GroupLanguageProfile.membership_id == membership.id))
                if not profile:
                    profile = GroupLanguageProfile(id=str(uuid4()), space_id=space_id, membership_id=membership.id)
                    db.add(profile)
                profile.spoken_language = values["spoken_language"]
                profile.preferred_output_language = values["preferred_output_language"]
                profile.auto_translate_enabled = int(values["auto_translate_enabled"])
                profile.auto_read_enabled = int(values["auto_read_enabled"])
                profile.show_original_enabled = int(values["show_original_enabled"])
                profile.updated_at = _now()
                self._audit(db, actor, space_id, "translation.profile_updated", "language_profile", profile.id)
                return self._profile_payload(profile)

    def get_consent(self, actor: GroupActor, space_id: str) -> dict:
        with self.database.session() as db:
            membership = self._membership(db, space_id, actor)
            consent = db.scalar(select(GroupTranslationConsent).where(GroupTranslationConsent.space_id == space_id, GroupTranslationConsent.membership_id == membership.id))
            return {
                "status": consent.status if consent else "not_set",
                "policy_version": consent.policy_version if consent else self.settings.group_translation_policy_version,
                "decided_at": _iso(consent.decided_at) if consent else None,
            }

    def update_consent(self, actor: GroupActor, space_id: str, status: str, policy_version: str) -> dict:
        if policy_version != self.settings.group_translation_policy_version:
            raise GroupServiceError("group_translation_policy_version_mismatch", 409)
        with self.database.session() as db:
            with db.begin():
                membership = self._membership(db, space_id, actor)
                consent = db.scalar(select(GroupTranslationConsent).where(GroupTranslationConsent.space_id == space_id, GroupTranslationConsent.membership_id == membership.id))
                if not consent:
                    consent = GroupTranslationConsent(id=str(uuid4()), space_id=space_id, membership_id=membership.id, status=status, policy_version=policy_version, decided_at=_now())
                    db.add(consent)
                else:
                    consent.status = status
                    consent.policy_version = policy_version
                    consent.decided_at = _now()
                    consent.updated_at = _now()
                self._audit(db, actor, space_id, "translation.consent_updated", "translation_consent", consent.id, {"status": status, "policy_version": policy_version})
                return {"status": consent.status, "policy_version": consent.policy_version, "decided_at": _iso(consent.decided_at)}

    @staticmethod
    def _quota_claim(actor: GroupActor, media_kind: str) -> tuple[dict, int, int]:
        entitlement = actor.entitlement or {}
        quota = entitlement.get("group_translation_quota")
        if not isinstance(quota, dict) or quota.get("authority") != "timeblock" or quota.get("period") != "monthly":
            raise GroupServiceError("group_translation_quota_unavailable", 403)
        prefix = "video" if media_kind == "video" else "audio"
        try:
            limit_seconds = int(quota.get(f"{prefix}_limit_target_seconds") or 0)
            remaining_seconds = int(quota.get(f"{prefix}_remaining_target_seconds") or 0)
        except (TypeError, ValueError) as exc:
            raise GroupServiceError("group_translation_quota_invalid", 403) from exc
        return quota, max(0, limit_seconds), max(0, min(remaining_seconds, limit_seconds))

    def _sync_ledger(self, db, actor: GroupActor, media_kind: str) -> GroupTranslationQuotaLedger:
        quota, limit_seconds, remaining_seconds = self._quota_claim(actor, media_kind)
        period_start = _parse_time(quota.get("period_start"))
        period_end = _parse_time(quota.get("period_end"))
        if not period_start or not period_end or period_start >= period_end or period_end <= _now():
            raise GroupServiceError("group_translation_quota_period_invalid", 403)
        billing_subject = str(actor.entitlement.get("billing_subject") or "")
        if not billing_subject or len(billing_subject) > 160:
            raise GroupServiceError("group_translation_billing_subject_invalid", 403)
        ledger_kind = "video" if media_kind == "video" else "audio"
        ledger = db.scalar(
            select(GroupTranslationQuotaLedger)
            .where(
                GroupTranslationQuotaLedger.billing_subject == billing_subject,
                GroupTranslationQuotaLedger.media_kind == ledger_kind,
                GroupTranslationQuotaLedger.period_start == period_start,
            )
            .with_for_update()
        )
        authority_consumed = max(0, limit_seconds - remaining_seconds)
        if not ledger:
            ledger = GroupTranslationQuotaLedger(
                id=str(uuid4()),
                billing_subject=billing_subject,
                media_kind=ledger_kind,
                period_start=period_start,
                period_end=period_end,
                limit_target_seconds=limit_seconds,
                authority_consumed_target_seconds=authority_consumed,
                authority="timeblock",
            )
            db.add(ledger)
            db.flush()
        else:
            ledger.period_end = period_end
            ledger.limit_target_seconds = limit_seconds
            ledger.authority_consumed_target_seconds = max(ledger.authority_consumed_target_seconds, authority_consumed)
            ledger.updated_at = _now()
        return ledger

    @staticmethod
    def _quota_payload(ledger: GroupTranslationQuotaLedger) -> dict:
        unavailable = ledger.authority_consumed_target_seconds + ledger.consumed_target_seconds + ledger.reserved_target_seconds
        return {
            "authority": ledger.authority,
            "media_kind": ledger.media_kind,
            "period_start": _iso(ledger.period_start),
            "period_end": _iso(ledger.period_end),
            "limit_target_seconds": ledger.limit_target_seconds,
            "authority_consumed_target_seconds": ledger.authority_consumed_target_seconds,
            "consumed_target_seconds": ledger.consumed_target_seconds,
            "reserved_target_seconds": ledger.reserved_target_seconds,
            "remaining_target_seconds": max(0, ledger.limit_target_seconds - unavailable),
        }

    def quota(self, actor: GroupActor, space_id: str, media_kind: str) -> dict:
        with self.database.session() as db:
            with db.begin():
                self._membership(db, space_id, actor)
                ledger = self._sync_ledger(db, actor, media_kind)
                return self._quota_payload(ledger)

    @staticmethod
    def _require_media_runtime(db, actor: GroupActor, space_id: str, runtime_kind: str, runtime_id: str):
        if runtime_kind == "radio":
            burst = db.get(GroupRadioBurst, runtime_id)
            if not burst or burst.space_id != space_id or burst.state not in {"finalizing", "final"}:
                raise GroupServiceError("group_translation_runtime_not_active", 409)
            radio_session = db.get(GroupRadioSession, burst.radio_session_id)
            if not radio_session or radio_session.status != "ready":
                raise GroupServiceError("group_translation_runtime_not_active", 409)
            participant = db.scalar(
                select(GroupRadioParticipant).where(
                    GroupRadioParticipant.radio_session_id == radio_session.id,
                    GroupRadioParticipant.principal_type == actor.principal_type,
                    GroupRadioParticipant.principal_id == actor.principal_id,
                    GroupRadioParticipant.principal_user_id == actor.principal_user_id,
                    GroupRadioParticipant.status == "joined",
                )
            )
            if not participant or participant.membership_id != burst.speaker_membership_id:
                raise GroupServiceError("group_translation_radio_speaker_required", 403)
            joined_membership_ids = list(db.scalars(select(GroupRadioParticipant.membership_id).where(GroupRadioParticipant.radio_session_id == radio_session.id, GroupRadioParticipant.status == "joined")).all())
            consented = set(db.scalars(select(GroupTranslationConsent.membership_id).where(GroupTranslationConsent.space_id == space_id, GroupTranslationConsent.membership_id.in_(joined_membership_ids), GroupTranslationConsent.status == "granted")).all())
            if len(consented) != len(set(joined_membership_ids)):
                raise GroupServiceError("group_translation_all_participant_consent_required", 409)
            return burst, participant
        if runtime_kind not in {"call", "video"}:
            raise GroupServiceError("group_translation_runtime_not_ready", 409)
        session = db.get(GroupMediaSession, runtime_id)
        expected_kind = "video" if runtime_kind == "video" else "audio"
        if not session or session.space_id != space_id or session.media_kind != expected_kind or session.status != "active":
            raise GroupServiceError("group_translation_runtime_not_active", 409)
        participant = db.scalar(
            select(GroupMediaParticipant).where(
                GroupMediaParticipant.session_id == session.id,
                GroupMediaParticipant.principal_type == actor.principal_type,
                GroupMediaParticipant.principal_id == actor.principal_id,
                GroupMediaParticipant.principal_user_id == actor.principal_user_id,
                GroupMediaParticipant.invite_status == "joined",
            )
        )
        if not participant:
            raise GroupServiceError("group_translation_participant_required", 403)
        joined_membership_ids = list(db.scalars(select(GroupMediaParticipant.membership_id).where(GroupMediaParticipant.session_id == session.id, GroupMediaParticipant.invite_status == "joined")).all())
        consented = set(db.scalars(select(GroupTranslationConsent.membership_id).where(GroupTranslationConsent.space_id == space_id, GroupTranslationConsent.membership_id.in_(joined_membership_ids), GroupTranslationConsent.status == "granted")).all())
        if len(consented) != len(set(joined_membership_ids)):
            raise GroupServiceError("group_translation_all_participant_consent_required", 409)
        return session, participant

    def _release_expired(self, db) -> None:
        now = _now()
        expired = list(db.scalars(select(GroupTranslationReservation).where(GroupTranslationReservation.status == "reserved", GroupTranslationReservation.expires_at <= now).with_for_update()).all())
        for reservation in expired:
            ledger = db.get(GroupTranslationQuotaLedger, reservation.quota_ledger_id)
            if ledger:
                ledger.reserved_target_seconds = max(0, ledger.reserved_target_seconds - reservation.reserved_target_seconds)
                ledger.updated_at = now
            reservation.status = "expired"
            reservation.settled_at = now

    def reserve(
        self,
        actor: GroupActor,
        space_id: str,
        values: dict,
        idempotency_key: str | None,
    ) -> dict:
        if not self.settings.group_translation_enabled:
            raise GroupServiceError("group_translation_disabled", 503)
        key = str(idempotency_key or "").strip()
        if not 8 <= len(key) <= 128 or any(character.isspace() for character in key):
            raise GroupServiceError("idempotency_key_required", 400)
        if values["source_language"] == values["target_language"]:
            raise GroupServiceError("group_translation_source_target_same", 400)
        seconds = min(values["estimated_target_seconds"], self.settings.group_translation_max_segment_seconds)
        with self.database.session() as db:
            try:
                with db.begin():
                    membership = self._membership(db, space_id, actor)
                    runtime, _runtime_participant = self._require_media_runtime(db, actor, space_id, values["runtime_kind"], values["runtime_id"])
                    if values["runtime_kind"] == "radio":
                        try:
                            radio_targets = set(json.loads(runtime.target_languages_json))
                        except json.JSONDecodeError:
                            radio_targets = set()
                        if values["target_language"] not in radio_targets or values["segment_id"] != runtime.id:
                            raise GroupServiceError("group_radio_translation_target_not_planned", 409)
                    self._release_expired(db)
                    existing = db.scalar(select(GroupTranslationReservation).where(GroupTranslationReservation.space_id == space_id, GroupTranslationReservation.runtime_kind == values["runtime_kind"], GroupTranslationReservation.runtime_id == values["runtime_id"], GroupTranslationReservation.segment_id == values["segment_id"], GroupTranslationReservation.target_language == values["target_language"]).with_for_update())
                    if existing and existing.status in {"reserved", "settled"}:
                        raise GroupServiceError("group_translation_target_already_active", 409)
                    ledger = self._sync_ledger(db, actor, values["runtime_kind"])
                    unavailable = ledger.authority_consumed_target_seconds + ledger.consumed_target_seconds + ledger.reserved_target_seconds
                    if seconds <= 0 or unavailable + seconds > ledger.limit_target_seconds:
                        raise GroupServiceError("group_translation_quota_exceeded", 429)
                    expires_at = _now() + timedelta(seconds=self.settings.group_translation_reservation_ttl_seconds)
                    if existing:
                        if existing.actor_key != actor.key:
                            raise GroupServiceError("group_translation_target_owned_by_other_actor", 409)
                        existing.quota_ledger_id = ledger.id
                        existing.payer_membership_id = membership.id
                        existing.actor_key = actor.key
                        existing.idempotency_key = key
                        existing.source_language = values["source_language"]
                        existing.reserved_target_seconds = seconds
                        existing.settled_target_seconds = 0
                        existing.status = "reserved"
                        existing.provider_session_id = ""
                        existing.provider_secret_expires_at = None
                        existing.expires_at = expires_at
                        existing.settled_at = None
                        reservation = existing
                    else:
                        reservation = GroupTranslationReservation(
                            id=str(uuid4()),
                            space_id=space_id,
                            quota_ledger_id=ledger.id,
                            payer_membership_id=membership.id,
                            actor_key=actor.key,
                            idempotency_key=key,
                            runtime_kind=values["runtime_kind"],
                            runtime_id=values["runtime_id"],
                            segment_id=values["segment_id"],
                            source_language=values["source_language"],
                            target_language=values["target_language"],
                            reserved_target_seconds=seconds,
                            expires_at=expires_at,
                        )
                        db.add(reservation)
                    ledger.reserved_target_seconds += seconds
                    ledger.updated_at = _now()
                    if values["runtime_kind"] == "radio":
                        processing = db.scalar(select(GroupRadioProcessingJob).where(GroupRadioProcessingJob.burst_id == runtime.id).with_for_update())
                        if not processing or processing.status not in {"ready", "processing"}:
                            raise GroupServiceError("group_radio_processing_not_ready", 409)
                        processing.status = "processing"
                        processing.updated_at = _now()
                    self._audit(db, actor, space_id, "translation.reserved", "translation_reservation", reservation.id, {"runtime_kind": reservation.runtime_kind, "target_language": reservation.target_language, "target_seconds": seconds})
                    db.flush()
                    return {
                        "reservation_id": reservation.id,
                        "source_language": reservation.source_language,
                        "target_language": reservation.target_language,
                        "expires_at": _iso(reservation.expires_at),
                        "quota": self._quota_payload(ledger),
                    }
            except IntegrityError as exc:
                raise GroupServiceError("group_translation_reservation_conflict", 409) from exc

    def mark_provider_secret(self, actor: GroupActor, reservation_id: str, provider_session_id: str, expires_at: int | None) -> None:
        with self.database.session() as db:
            with db.begin():
                reservation = db.scalar(select(GroupTranslationReservation).where(GroupTranslationReservation.id == reservation_id).with_for_update())
                if not reservation or reservation.actor_key != actor.key or reservation.status != "reserved":
                    raise GroupServiceError("group_translation_reservation_not_active", 409)
                reservation.provider_session_id = provider_session_id
                reservation.provider_secret_expires_at = datetime.fromtimestamp(expires_at, timezone.utc) if expires_at else None

    def release(self, actor: GroupActor, space_id: str, reservation_id: str, *, reason: str = "released") -> dict:
        with self.database.session() as db:
            with db.begin():
                self._membership(db, space_id, actor)
                reservation = db.scalar(select(GroupTranslationReservation).where(GroupTranslationReservation.id == reservation_id, GroupTranslationReservation.space_id == space_id).with_for_update())
                if not reservation or reservation.actor_key != actor.key:
                    raise GroupServiceError("group_translation_reservation_not_found", 404)
                ledger = db.get(GroupTranslationQuotaLedger, reservation.quota_ledger_id)
                if reservation.status == "reserved":
                    ledger.reserved_target_seconds = max(0, ledger.reserved_target_seconds - reservation.reserved_target_seconds)
                    ledger.updated_at = _now()
                    reservation.status = "released"
                    reservation.settled_at = _now()
                    self._audit(db, actor, space_id, "translation.released", "translation_reservation", reservation.id, {"reason": reason[:80]})
                return {"reservation_id": reservation.id, "status": reservation.status, "quota": self._quota_payload(ledger)}

    def finalize(self, actor: GroupActor, space_id: str, values: dict) -> dict:
        event_id = str(uuid4())
        with self.database.session() as db:
            try:
                with db.begin():
                    self._membership(db, space_id, actor)
                    reservation = db.scalar(select(GroupTranslationReservation).where(GroupTranslationReservation.id == values["reservation_id"], GroupTranslationReservation.space_id == space_id).with_for_update())
                    if not reservation or reservation.actor_key != actor.key:
                        raise GroupServiceError("group_translation_reservation_not_found", 404)
                    existing = db.scalar(select(GroupTranslationEvent).where(GroupTranslationEvent.reservation_id == reservation.id))
                    if existing:
                        return {"event": self._event_payload(existing), "tts_jobs_created": 0, "idempotent": True}
                    if reservation.status != "reserved" or reservation.expires_at <= _now():
                        raise GroupServiceError("group_translation_reservation_not_active", 409)
                    if values["actual_target_seconds"] > reservation.reserved_target_seconds:
                        raise GroupServiceError("group_translation_actual_exceeds_reservation", 409)
                    runtime, _participant = self._require_media_runtime(db, actor, space_id, reservation.runtime_kind, reservation.runtime_id)
                    if reservation.runtime_kind == "radio":
                        speaker = db.scalar(select(GroupRadioParticipant).where(GroupRadioParticipant.radio_session_id == runtime.radio_session_id, GroupRadioParticipant.membership_id == values["speaker_membership_id"], GroupRadioParticipant.status == "joined"))
                    else:
                        speaker = db.scalar(select(GroupMediaParticipant).where(GroupMediaParticipant.session_id == runtime.id, GroupMediaParticipant.membership_id == values["speaker_membership_id"], GroupMediaParticipant.invite_status == "joined"))
                    if not speaker:
                        raise GroupServiceError("group_translation_speaker_not_joined", 409)
                    original_ciphertext, original_nonce, version = self.crypto.encrypt_text(values["original_text"], aad=f"group-translation-original:{space_id}:{event_id}")
                    translated_ciphertext, translated_nonce, translated_version = self.crypto.encrypt_text(values["translated_text"], aad=f"group-translation-translated:{space_id}:{event_id}")
                    if translated_version != version:
                        raise GroupServiceError("group_translation_encryption_version_mismatch", 500)
                    now = _now()
                    event = GroupTranslationEvent(
                        id=event_id,
                        reservation_id=reservation.id,
                        space_id=space_id,
                        speaker_membership_id=values["speaker_membership_id"],
                        runtime_kind=reservation.runtime_kind,
                        runtime_id=reservation.runtime_id,
                        segment_id=reservation.segment_id,
                        source_language=reservation.source_language,
                        target_language=reservation.target_language,
                        state="FINAL",
                        original_ciphertext=original_ciphertext,
                        original_nonce=original_nonce,
                        translated_ciphertext=translated_ciphertext,
                        translated_nonce=translated_nonce,
                        encryption_version=version,
                        duration_target_seconds=values["actual_target_seconds"],
                        confidence_millis=round(values["confidence"] * 1000) if values.get("confidence") is not None else None,
                        final_at=now,
                    )
                    db.add(event)
                    ledger = db.get(GroupTranslationQuotaLedger, reservation.quota_ledger_id)
                    ledger.reserved_target_seconds = max(0, ledger.reserved_target_seconds - reservation.reserved_target_seconds)
                    ledger.consumed_target_seconds += values["actual_target_seconds"]
                    ledger.updated_at = now
                    reservation.status = "settled"
                    reservation.settled_target_seconds = values["actual_target_seconds"]
                    reservation.settled_at = now
                    if reservation.runtime_kind == "radio":
                        runtime.state = "final"
                        runtime.finalized_at = now
                        runtime.updated_at = now
                        processing = db.scalar(select(GroupRadioProcessingJob).where(GroupRadioProcessingJob.burst_id == runtime.id).with_for_update())
                        if processing:
                            processing.status = "completed"
                            processing.updated_at = now
                    recipients = list(
                        db.execute(
                            select(GroupMembership, GroupLanguageProfile)
                            .join(GroupLanguageProfile, GroupLanguageProfile.membership_id == GroupMembership.id)
                            .join(GroupTranslationConsent, GroupTranslationConsent.membership_id == GroupMembership.id)
                            .where(
                                GroupMembership.space_id == space_id,
                                GroupMembership.status == "active",
                                GroupLanguageProfile.space_id == space_id,
                                GroupLanguageProfile.preferred_output_language == reservation.target_language,
                                GroupLanguageProfile.auto_read_enabled == 1,
                                GroupTranslationConsent.space_id == space_id,
                                GroupTranslationConsent.status == "granted",
                            )
                        ).all()
                    )
                    for membership, _profile in recipients:
                        db.add(GroupTtsJob(id=str(uuid4()), translation_event_id=event.id, recipient_membership_id=membership.id, language=reservation.target_language, auto_read_snapshot=1, status="pending"))
                    self._audit(db, actor, space_id, "translation.final_persisted", "translation_event", event.id, {"state": "FINAL", "target_language": event.target_language, "tts_jobs_created": len(recipients)})
                    db.flush()
                    return {"event": self._event_payload(event, values["original_text"], values["translated_text"]), "tts_jobs_created": len(recipients), "idempotent": False, "quota": self._quota_payload(ledger)}
            except IntegrityError as exc:
                raise GroupServiceError("group_translation_final_conflict", 409) from exc

    def _event_payload(self, event: GroupTranslationEvent, original: str | None = None, translated: str | None = None) -> dict:
        if original is None:
            original = self.crypto.decrypt_text(event.original_ciphertext, event.original_nonce, aad=f"group-translation-original:{event.space_id}:{event.id}", version=event.encryption_version)
        if translated is None:
            translated = self.crypto.decrypt_text(event.translated_ciphertext, event.translated_nonce, aad=f"group-translation-translated:{event.space_id}:{event.id}", version=event.encryption_version)
        return {
            "id": event.id,
            "runtime_kind": event.runtime_kind,
            "runtime_id": event.runtime_id,
            "segment_id": event.segment_id,
            "speaker_membership_id": event.speaker_membership_id,
            "source_language": event.source_language,
            "target_language": event.target_language,
            "state": "FINAL",
            "original_text": original,
            "translated_text": translated,
            "duration_target_seconds": event.duration_target_seconds,
            "confidence": round(event.confidence_millis / 1000, 3) if event.confidence_millis is not None else None,
            "final_at": _iso(event.final_at),
        }

    def history(self, actor: GroupActor, space_id: str, runtime_kind: str | None, runtime_id: str | None, limit: int) -> list[dict]:
        with self.database.session() as db:
            self._membership(db, space_id, actor)
            query = select(GroupTranslationEvent).where(GroupTranslationEvent.space_id == space_id, GroupTranslationEvent.state == "FINAL")
            if runtime_kind:
                query = query.where(GroupTranslationEvent.runtime_kind == runtime_kind)
            if runtime_id:
                query = query.where(GroupTranslationEvent.runtime_id == runtime_id)
            events = list(db.scalars(query.order_by(GroupTranslationEvent.final_at.desc()).limit(limit)).all())
            return [self._event_payload(item) for item in events]

    def claim_tts_job(self, actor: GroupActor, space_id: str) -> dict | None:
        with self.database.session() as db:
            with db.begin():
                membership = self._membership(db, space_id, actor)
                job = db.scalar(select(GroupTtsJob).join(GroupTranslationEvent, GroupTranslationEvent.id == GroupTtsJob.translation_event_id).where(GroupTtsJob.recipient_membership_id == membership.id, GroupTtsJob.status == "pending", GroupTranslationEvent.space_id == space_id).order_by(GroupTtsJob.created_at).with_for_update(skip_locked=True))
                if not job:
                    return None
                event = db.get(GroupTranslationEvent, job.translation_event_id)
                job.status = "claimed"
                job.claimed_at = _now()
                translated = self.crypto.decrypt_text(event.translated_ciphertext, event.translated_nonce, aad=f"group-translation-translated:{event.space_id}:{event.id}", version=event.encryption_version)
                return {
                    "id": job.id,
                    "translation_event_id": event.id,
                    "language": job.language,
                    "text": translated,
                    "status": job.status,
                    "final_visible_event_id": event.id,
                }

    def ack_tts_job(self, actor: GroupActor, space_id: str, job_id: str, status: str, failure_code: str) -> dict:
        with self.database.session() as db:
            with db.begin():
                membership = self._membership(db, space_id, actor)
                job = db.scalar(select(GroupTtsJob).join(GroupTranslationEvent, GroupTranslationEvent.id == GroupTtsJob.translation_event_id).where(GroupTtsJob.id == job_id, GroupTtsJob.recipient_membership_id == membership.id, GroupTranslationEvent.space_id == space_id).with_for_update())
                if not job:
                    raise GroupServiceError("group_tts_job_not_found", 404)
                if job.status not in {"claimed", status}:
                    raise GroupServiceError("group_tts_job_not_claimed", 409)
                job.status = status
                job.failure_code = failure_code if status == "failed" else ""
                job.completed_at = _now()
                return {"id": job.id, "status": job.status, "completed_at": _iso(job.completed_at)}
