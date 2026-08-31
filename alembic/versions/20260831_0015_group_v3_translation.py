"""add native Group V3 translation consent quota and FINAL history

Revision ID: 20260831_0015
Revises: 20260831_0014
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0015"
down_revision = "20260831_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_language_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("spoken_language", sa.String(8), nullable=False, server_default="vi"),
        sa.Column("preferred_output_language", sa.String(8), nullable=False, server_default="vi"),
        sa.Column("auto_translate_enabled", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("auto_read_enabled", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("show_original_enabled", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("space_id", "membership_id", name="uq_group_language_profile_member"),
    )
    op.create_index("ix_group_language_profiles_target", "group_language_profiles", ["space_id", "preferred_output_language", "auto_read_enabled"])

    op.create_table(
        "group_translation_consents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("policy_version", sa.String(40), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("space_id", "membership_id", name="uq_group_translation_consent_member"),
        sa.CheckConstraint("status IN ('granted','denied','revoked')", name="ck_group_translation_consents_status"),
    )
    op.create_index("ix_group_translation_consents_space_status", "group_translation_consents", ["space_id", "status"])

    op.create_table(
        "group_translation_quota_ledgers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("billing_subject", sa.String(160), nullable=False),
        sa.Column("media_kind", sa.String(16), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("limit_target_seconds", sa.BigInteger(), nullable=False),
        sa.Column("authority_consumed_target_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("consumed_target_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("reserved_target_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("authority", sa.String(32), nullable=False, server_default="timeblock"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("billing_subject", "media_kind", "period_start", name="uq_group_translation_quota_period"),
        sa.CheckConstraint("media_kind IN ('audio','video','radio')", name="ck_group_translation_quota_kind"),
    )
    op.create_index("ix_group_translation_quota_subject", "group_translation_quota_ledgers", ["billing_subject", "period_end"])

    op.create_table(
        "group_translation_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quota_ledger_id", sa.String(36), sa.ForeignKey("group_translation_quota_ledgers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("payer_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("actor_key", sa.String(320), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("runtime_kind", sa.String(16), nullable=False),
        sa.Column("runtime_id", sa.String(36), nullable=False),
        sa.Column("segment_id", sa.String(128), nullable=False),
        sa.Column("source_language", sa.String(8), nullable=False),
        sa.Column("target_language", sa.String(8), nullable=False),
        sa.Column("reserved_target_seconds", sa.Integer(), nullable=False),
        sa.Column("settled_target_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="reserved"),
        sa.Column("provider_session_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("provider_secret_expires_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("space_id", "runtime_kind", "runtime_id", "segment_id", "target_language", name="uq_group_translation_target_once"),
        sa.UniqueConstraint("actor_key", "idempotency_key", name="uq_group_translation_reservation_idempotency"),
        sa.CheckConstraint("runtime_kind IN ('call','video','radio')", name="ck_group_translation_reservation_runtime"),
        sa.CheckConstraint("status IN ('reserved','settled','released','expired')", name="ck_group_translation_reservation_status"),
    )
    op.create_index("ix_group_translation_reservations_runtime", "group_translation_reservations", ["runtime_kind", "runtime_id", "status"])
    op.create_index("ix_group_translation_reservations_expiry", "group_translation_reservations", ["status", "expires_at"])

    op.create_table(
        "group_translation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("reservation_id", sa.String(36), sa.ForeignKey("group_translation_reservations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("speaker_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("runtime_kind", sa.String(16), nullable=False),
        sa.Column("runtime_id", sa.String(36), nullable=False),
        sa.Column("segment_id", sa.String(128), nullable=False),
        sa.Column("source_language", sa.String(8), nullable=False),
        sa.Column("target_language", sa.String(8), nullable=False),
        sa.Column("state", sa.String(8), nullable=False, server_default="FINAL"),
        sa.Column("original_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("original_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("translated_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("translated_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("encryption_version", sa.String(32), nullable=False),
        sa.Column("duration_target_seconds", sa.Integer(), nullable=False),
        sa.Column("confidence_millis", sa.Integer()),
        sa.Column("final_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("reservation_id", name="uq_group_translation_event_reservation"),
        sa.CheckConstraint("state = 'FINAL'", name="ck_group_translation_events_final_only"),
    )
    op.create_index("ix_group_translation_events_runtime", "group_translation_events", ["runtime_kind", "runtime_id", "final_at"])
    op.create_index("ix_group_translation_events_space", "group_translation_events", ["space_id", "final_at"])

    op.create_table(
        "group_tts_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("translation_event_id", sa.String(36), sa.ForeignKey("group_translation_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("auto_read_snapshot", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("failure_code", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("translation_event_id", "recipient_membership_id", name="uq_group_tts_event_recipient"),
        sa.CheckConstraint("status IN ('pending','claimed','completed','failed','suppressed')", name="ck_group_tts_jobs_status"),
    )
    op.create_index("ix_group_tts_recipient_status", "group_tts_jobs", ["recipient_membership_id", "status", "created_at"])


def downgrade() -> None:
    op.drop_table("group_tts_jobs")
    op.drop_table("group_translation_events")
    op.drop_table("group_translation_reservations")
    op.drop_table("group_translation_quota_ledgers")
    op.drop_table("group_translation_consents")
    op.drop_table("group_language_profiles")
