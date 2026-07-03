"""add rapid result boards

Revision ID: 20260703_0011
Revises: 20260703_0010
Create Date: 2026-07-03 23:20:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260703_0011"
down_revision = "20260703_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rapid_result_boards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_code", sa.String(length=32), nullable=False),
        sa.Column("special_number", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("result_payload", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rapid_result_boards_session_code", "rapid_result_boards", ["session_code"], unique=True)
    op.create_index("ix_rapid_result_boards_special_number", "rapid_result_boards", ["special_number"])
    op.create_index("ix_rapid_result_boards_created_at", "rapid_result_boards", ["created_at"])
    op.create_index("ix_rapid_result_boards_settled_at", "rapid_result_boards", ["settled_at"])
    op.create_index("ix_rapid_result_boards_created", "rapid_result_boards", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_rapid_result_boards_created", table_name="rapid_result_boards")
    op.drop_index("ix_rapid_result_boards_settled_at", table_name="rapid_result_boards")
    op.drop_index("ix_rapid_result_boards_created_at", table_name="rapid_result_boards")
    op.drop_index("ix_rapid_result_boards_special_number", table_name="rapid_result_boards")
    op.drop_index("ix_rapid_result_boards_session_code", table_name="rapid_result_boards")
    op.drop_table("rapid_result_boards")
