"""add native Group V3 radio sessions bursts and processing jobs

Revision ID: 20260831_0016
Revises: 20260831_0015
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0016"
down_revision = "20260831_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_radio_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_by_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("livekit_room_name", sa.String(80), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ready"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ended_by_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="SET NULL")),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('ready','ended')", name="ck_group_radio_sessions_status"),
    )
    op.create_index("ix_group_radio_sessions_space_status", "group_radio_sessions", ["space_id", "status", "created_at"])

    op.create_table(
        "group_radio_participants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("radio_session_id", sa.String(36), sa.ForeignKey("group_radio_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("principal_type", sa.String(16), nullable=False),
        sa.Column("principal_id", sa.String(128), nullable=False),
        sa.Column("principal_user_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("livekit_identity", sa.String(80), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="invited"),
        sa.Column("device_state", sa.String(16), nullable=False, server_default="ready"),
        sa.Column("joined_at", sa.DateTime(timezone=True)),
        sa.Column("left_at", sa.DateTime(timezone=True)),
        sa.Column("device_lost_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("radio_session_id", "membership_id", name="uq_group_radio_participant_member"),
        sa.UniqueConstraint("radio_session_id", "livekit_identity", name="uq_group_radio_participant_identity"),
        sa.CheckConstraint("status IN ('invited','joined','left','removed')", name="ck_group_radio_participants_status"),
        sa.CheckConstraint("device_state IN ('ready','lost')", name="ck_group_radio_participants_device"),
    )
    op.create_index("ix_group_radio_participants_session_status", "group_radio_participants", ["radio_session_id", "status"])
    op.create_index("ix_group_radio_participants_principal", "group_radio_participants", ["principal_type", "principal_id", "principal_user_id", "status"])

    op.create_table(
        "group_radio_bursts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("radio_session_id", sa.String(36), sa.ForeignKey("group_radio_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("speaker_participant_id", sa.String(36), sa.ForeignKey("group_radio_participants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("speaker_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("floor_token_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="talking"),
        sa.Column("source_language", sa.String(8), nullable=False, server_default="vi"),
        sa.Column("target_languages_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("stop_reason", sa.String(40), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True)),
        sa.Column("finalized_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("state IN ('talking','finalizing','final','device_lost','failed')", name="ck_group_radio_bursts_state"),
    )
    op.create_index("ix_group_radio_bursts_session_created", "group_radio_bursts", ["radio_session_id", "created_at"])
    op.create_index("ix_group_radio_bursts_state", "group_radio_bursts", ["state", "updated_at"])

    op.create_table(
        "group_radio_processing_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("burst_id", sa.String(36), sa.ForeignKey("group_radio_bursts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ready"),
        sa.Column("failure_code", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("burst_id", name="uq_group_radio_processing_burst"),
        sa.CheckConstraint("status IN ('ready','processing','completed','failed','suppressed')", name="ck_group_radio_processing_status"),
    )
    op.create_index("ix_group_radio_processing_status", "group_radio_processing_jobs", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("group_radio_processing_jobs")
    op.drop_table("group_radio_bursts")
    op.drop_table("group_radio_participants")
    op.drop_table("group_radio_sessions")
