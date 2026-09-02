"""add native Group V3 call and video sessions

Revision ID: 20260831_0014
Revises: 20260831_0013
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0014"
down_revision = "20260831_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_media_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("group_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("initiated_by_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("livekit_room_name", sa.String(80), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ringing"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("ended_by_membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="SET NULL")),
        sa.Column("end_reason", sa.String(40), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("media_kind IN ('audio','video')", name="ck_group_media_sessions_kind"),
        sa.CheckConstraint("status IN ('ringing','active','ended')", name="ck_group_media_sessions_status"),
    )
    op.create_index("ix_group_media_sessions_space_status", "group_media_sessions", ["space_id", "status", "created_at"])

    op.create_table(
        "group_media_participants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("group_media_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", sa.String(36), sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("principal_type", sa.String(16), nullable=False),
        sa.Column("principal_id", sa.String(128), nullable=False),
        sa.Column("principal_user_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("livekit_identity", sa.String(80), nullable=False),
        sa.Column("invite_status", sa.String(16), nullable=False, server_default="invited"),
        sa.Column("desired_video_subscriptions_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("joined_at", sa.DateTime(timezone=True)),
        sa.Column("rejected_at", sa.DateTime(timezone=True)),
        sa.Column("left_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", "membership_id", name="uq_group_media_participant_member"),
        sa.UniqueConstraint("session_id", "livekit_identity", name="uq_group_media_participant_identity"),
        sa.CheckConstraint("invite_status IN ('invited','joined','rejected','left')", name="ck_group_media_participants_invite"),
    )
    op.create_index("ix_group_media_participants_session_status", "group_media_participants", ["session_id", "invite_status"])
    op.create_index("ix_group_media_participants_principal", "group_media_participants", ["principal_type", "principal_id", "principal_user_id", "invite_status"])


def downgrade() -> None:
    op.drop_table("group_media_participants")
    op.drop_table("group_media_sessions")
