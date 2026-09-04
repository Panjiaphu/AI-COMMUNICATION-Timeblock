"""add durable native Group invitations

Revision ID: 20260903_0019
Revises: 20260902_0018
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260903_0019"
down_revision = "20260902_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_invitations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "space_id",
            sa.String(36),
            sa.ForeignKey("group_spaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(128), nullable=False),
        sa.Column("target_public_id", sa.String(128), nullable=False),
        sa.Column("target_display_name", sa.String(120), nullable=False),
        sa.Column(
            "invited_by_membership_id",
            sa.String(36),
            sa.ForeignKey("group_memberships.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("pending_key", sa.String(320)),
        sa.Column("accepted_by_user_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("rejected_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("pending_key", name="uq_group_invitation_pending_key"),
        sa.CheckConstraint(
            "target_type IN ('member','business')",
            name="ck_group_invitations_target_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending','accepted','rejected','cancelled','expired')",
            name="ck_group_invitations_status",
        ),
    )
    op.create_index(
        "ix_group_invitations_space_status",
        "group_invitations",
        ["space_id", "status", "created_at"],
    )
    op.create_index(
        "ix_group_invitations_target_status",
        "group_invitations",
        ["target_type", "target_id", "status", "expires_at"],
    )
    op.create_index(
        "ix_group_invitations_status_expiry",
        "group_invitations",
        ["status", "expires_at"],
    )


def downgrade() -> None:
    op.drop_table("group_invitations")
