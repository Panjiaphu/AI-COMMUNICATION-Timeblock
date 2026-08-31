"""add native Group V3 spaces, messages, attachments and audit

Revision ID: 20260831_0013
Revises: 20260704_0012
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0013"
down_revision = "20260704_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_spaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_by_type", sa.String(16), nullable=False),
        sa.Column("created_by_id", sa.String(128), nullable=False),
        sa.Column("created_by_user_id", sa.String(128), nullable=False),
        sa.Column("lifecycle_status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("message_sequence", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("lifecycle_status IN ('active','archived','deleted')", name="ck_group_spaces_lifecycle"),
    )
    op.create_index("ix_group_spaces_status_updated", "group_spaces", ["lifecycle_status", "updated_at"])

    op.create_table(
        "group_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("principal_type", sa.String(16), nullable=False),
        sa.Column("principal_id", sa.String(128), nullable=False),
        sa.Column("principal_user_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("left_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("space_id", "principal_type", "principal_id", "principal_user_id", name="uq_group_membership_principal"),
        sa.CheckConstraint("role IN ('owner','admin','member')", name="ck_group_membership_role"),
        sa.CheckConstraint("status IN ('active','left','removed')", name="ck_group_membership_status"),
    )
    op.create_index("ix_group_memberships_principal_status", "group_memberships", ["principal_type", "principal_id", "principal_user_id", "status"])
    op.create_index("ix_group_memberships_space_status", "group_memberships", ["space_id", "status", "role"])

    op.create_table(
        "group_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("sender_type", sa.String(16), nullable=False),
        sa.Column("sender_id", sa.String(128), nullable=False),
        sa.Column("sender_user_id", sa.String(128), nullable=False),
        sa.Column("sender_display_name", sa.String(120), nullable=False),
        sa.Column("client_message_id", sa.String(128)),
        sa.Column("content_type", sa.String(16), nullable=False, server_default="text"),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("encryption_version", sa.String(32), nullable=False),
        sa.Column("reply_to_id", sa.String(36), sa.ForeignKey("group_messages.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("edited_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("space_id", "sequence", name="uq_group_message_sequence"),
        sa.UniqueConstraint("space_id", "sender_type", "sender_id", "sender_user_id", "client_message_id", name="uq_group_message_client_id"),
        sa.CheckConstraint("content_type IN ('text','system','attachment')", name="ck_group_messages_content_type"),
        sa.CheckConstraint("status IN ('active','deleted')", name="ck_group_messages_status"),
    )
    op.create_index("ix_group_messages_space_sequence", "group_messages", ["space_id", "sequence"])
    op.create_index("ix_group_messages_reply_to", "group_messages", ["reply_to_id"])

    op.create_table(
        "group_message_reactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("message_id", sa.String(36), sa.ForeignKey("group_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("principal_type", sa.String(16), nullable=False),
        sa.Column("principal_id", sa.String(128), nullable=False),
        sa.Column("principal_user_id", sa.String(128), nullable=False),
        sa.Column("reaction", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("message_id", "principal_type", "principal_id", "principal_user_id", "reaction", name="uq_group_reaction_actor"),
    )
    op.create_index("ix_group_reactions_message", "group_message_reactions", ["message_id", "reaction"])

    op.create_table(
        "group_message_pins",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.String(36), sa.ForeignKey("group_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pinned_by_type", sa.String(16), nullable=False),
        sa.Column("pinned_by_id", sa.String(128), nullable=False),
        sa.Column("pinned_by_user_id", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("space_id", "message_id", name="uq_group_pin_message"),
    )
    op.create_index("ix_group_pins_space_created", "group_message_pins", ["space_id", "created_at"])

    op.create_table(
        "group_attachments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.String(36), sa.ForeignKey("group_messages.id", ondelete="SET NULL")),
        sa.Column("uploader_type", sa.String(16), nullable=False),
        sa.Column("uploader_id", sa.String(128), nullable=False),
        sa.Column("uploader_user_id", sa.String(128), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(160), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("payload_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("encryption_version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('pending','attached','deleted')", name="ck_group_attachments_status"),
    )
    op.create_index("ix_group_attachments_space_status", "group_attachments", ["space_id", "status", "created_at"])
    op.create_index("ix_group_attachments_message", "group_attachments", ["message_id"])

    op.create_table(
        "group_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(128), nullable=False),
        sa.Column("actor_user_id", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(40), nullable=False, server_default=""),
        sa.Column("resource_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("outcome", sa.String(24), nullable=False, server_default="success"),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_group_audit_space_created", "group_audit_events", ["space_id", "created_at", "id"])
    op.create_index("ix_group_audit_actor", "group_audit_events", ["actor_type", "actor_id", "actor_user_id", "created_at"])

    op.create_table(
        "group_idempotency_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("endpoint", sa.String(120), nullable=False),
        sa.Column("actor_key", sa.String(320), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("endpoint", "actor_key", "idempotency_key", name="uq_group_idempotency_actor"),
    )
    op.create_index("ix_group_idempotency_created", "group_idempotency_records", ["created_at"])


def downgrade() -> None:
    op.drop_table("group_idempotency_records")
    op.drop_table("group_audit_events")
    op.drop_table("group_attachments")
    op.drop_table("group_message_pins")
    op.drop_table("group_message_reactions")
    op.drop_table("group_messages")
    op.drop_table("group_memberships")
    op.drop_table("group_spaces")
