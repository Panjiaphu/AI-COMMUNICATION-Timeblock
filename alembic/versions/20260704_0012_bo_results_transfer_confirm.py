"""add BO session results and transfer confirmation fields

Revision ID: 20260704_0012
Revises: 20260703_0011
Create Date: 2026-07-04 12:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260704_0012"
down_revision = "20260703_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "bo_session_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_code", sa.String(length=32), nullable=False),
        sa.Column("session_index", sa.Integer(), nullable=False),
        sa.Column("asset", sa.String(length=16), nullable=False),
        sa.Column("entry_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("result_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("result_side", sa.String(length=8), nullable=False),
        sa.Column("change_percent", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bo_session_results_session_code", "bo_session_results", ["session_code"])
    op.create_index("ix_bo_session_results_session_index", "bo_session_results", ["session_index"])
    op.create_index("ix_bo_session_results_asset", "bo_session_results", ["asset"])
    op.create_index("ix_bo_session_results_result_side", "bo_session_results", ["result_side"])
    op.create_index("ix_bo_session_results_created_at", "bo_session_results", ["created_at"])
    op.create_index("ix_bo_session_results_settled_at", "bo_session_results", ["settled_at"])
    op.create_index("ix_bo_session_results_session_asset", "bo_session_results", ["session_code", "asset"], unique=True)
    op.create_index("ix_bo_session_results_asset_index", "bo_session_results", ["asset", "session_index"])

    op.add_column("point_transfers", sa.Column("admin_note", sa.Text(), nullable=False, server_default=""))
    op.add_column("point_transfers", sa.Column("sender_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("point_transfers", sa.Column("receiver_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("point_transfers", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("point_transfers", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("point_transfers", sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True))
    op.create_index("ix_point_transfers_reviewed_by_user_id", "point_transfers", ["reviewed_by_user_id"])
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_point_transfers_reviewed_by_user_id_users",
            "point_transfers",
            "users",
            ["reviewed_by_user_id"],
            ["id"],
        )
    op.execute("UPDATE point_transfers SET sender_confirmed_at = created_at, receiver_confirmed_at = created_at, completed_at = created_at WHERE status = 'completed'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.drop_constraint("fk_point_transfers_reviewed_by_user_id_users", "point_transfers", type_="foreignkey")
    op.drop_index("ix_point_transfers_reviewed_by_user_id", table_name="point_transfers")
    op.drop_column("point_transfers", "reviewed_by_user_id")
    op.drop_column("point_transfers", "cancelled_at")
    op.drop_column("point_transfers", "completed_at")
    op.drop_column("point_transfers", "receiver_confirmed_at")
    op.drop_column("point_transfers", "sender_confirmed_at")
    op.drop_column("point_transfers", "admin_note")

    op.drop_index("ix_bo_session_results_asset_index", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_session_asset", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_settled_at", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_created_at", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_result_side", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_asset", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_session_index", table_name="bo_session_results")
    op.drop_index("ix_bo_session_results_session_code", table_name="bo_session_results")
    op.drop_table("bo_session_results")
