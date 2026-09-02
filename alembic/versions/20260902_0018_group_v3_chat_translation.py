"""add native Group Chat translation history

Revision ID: 20260902_0018
Revises: 20260901_0017
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260902_0018"
down_revision = "20260901_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "group_messages",
        sa.Column("source_language", sa.String(8), nullable=False, server_default="vi"),
    )
    op.create_check_constraint(
        "ck_group_messages_source_language",
        "group_messages",
        "source_language IN ('vi','en','zh-TW')",
    )
    op.create_table(
        "group_chat_translations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "space_id",
            sa.String(36),
            sa.ForeignKey("group_spaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.String(36),
            sa.ForeignKey("group_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_membership_id",
            sa.String(36),
            sa.ForeignKey("group_memberships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("message_fingerprint", sa.String(64), nullable=False),
        sa.Column("source_language", sa.String(8), nullable=False),
        sa.Column("target_language", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("translated_ciphertext", sa.LargeBinary()),
        sa.Column("translated_nonce", sa.LargeBinary()),
        sa.Column("encryption_version", sa.String(32), nullable=False, server_default=""),
        sa.Column("provider_model", sa.String(80), nullable=False, server_default=""),
        sa.Column("provider_request_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("failure_code", sa.String(80), nullable=False, server_default=""),
        sa.Column("final_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "recipient_membership_id",
            "idempotency_key",
            name="uq_group_chat_translation_idempotency",
        ),
        sa.UniqueConstraint(
            "message_id",
            "recipient_membership_id",
            "target_language",
            "message_fingerprint",
            name="uq_group_chat_translation_message_version",
        ),
        sa.CheckConstraint(
            "status IN ('pending','final','failed')",
            name="ck_group_chat_translations_status",
        ),
        sa.CheckConstraint(
            "source_language IN ('vi','en','zh-TW')",
            name="ck_group_chat_translations_source_language",
        ),
        sa.CheckConstraint(
            "target_language IN ('vi','en','zh-TW')",
            name="ck_group_chat_translations_target_language",
        ),
    )
    op.create_index(
        "ix_group_chat_translations_recipient_final",
        "group_chat_translations",
        ["space_id", "recipient_membership_id", "status", "final_at"],
    )


def downgrade() -> None:
    op.drop_table("group_chat_translations")
    op.drop_constraint(
        "ck_group_messages_source_language",
        "group_messages",
        type_="check",
    )
    op.drop_column("group_messages", "source_language")
