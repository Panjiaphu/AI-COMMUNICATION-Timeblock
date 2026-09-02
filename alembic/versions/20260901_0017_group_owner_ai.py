"""set AI-COMMUNICATION as the default Group translation ledger authority

Revision ID: 20260901_0017
Revises: 20260831_0016

This migration changes only the default for new rows. Existing rows remain
untouched pending the required production data audit.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0017"
down_revision = "20260831_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "group_translation_quota_ledgers",
        "authority",
        existing_type=sa.String(32),
        existing_nullable=False,
        server_default="ai-communication",
    )


def downgrade() -> None:
    op.alter_column(
        "group_translation_quota_ledgers",
        "authority",
        existing_type=sa.String(32),
        existing_nullable=False,
        server_default="timeblock",
    )
