"""add internal point transfer and wallet request details

Revision ID: 20260703_0010
Revises: 20260703_0009
Create Date: 2026-07-03 12:40:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260703_0010"
down_revision = "20260703_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE walletledgertype ADD VALUE IF NOT EXISTS 'TRANSFER_IN'")
        op.execute("ALTER TYPE walletledgertype ADD VALUE IF NOT EXISTS 'TRANSFER_OUT'")

    op.add_column(
        "sandbox_transactions",
        sa.Column("transfer_channel", sa.String(length=80), nullable=False, server_default=""),
    )
    op.add_column(
        "sandbox_transactions",
        sa.Column("account_name", sa.String(length=120), nullable=False, server_default=""),
    )
    op.add_column(
        "sandbox_transactions",
        sa.Column("account_identifier", sa.String(length=255), nullable=False, server_default=""),
    )

    op.create_table(
        "point_transfers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_code", sa.String(length=32), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("receiver_user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="SLB_POINT"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="completed"),
        sa.Column("memo", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["receiver_user_id"], ["users.id"]),
    )
    op.create_index("ix_point_transfers_reference_code", "point_transfers", ["reference_code"], unique=True)
    op.create_index("ix_point_transfers_sender_user_id", "point_transfers", ["sender_user_id"])
    op.create_index("ix_point_transfers_receiver_user_id", "point_transfers", ["receiver_user_id"])
    op.create_index("ix_point_transfers_currency", "point_transfers", ["currency"])
    op.create_index("ix_point_transfers_status", "point_transfers", ["status"])
    op.create_index("ix_point_transfers_created_at", "point_transfers", ["created_at"])
    op.create_index("ix_point_transfers_sender_created", "point_transfers", ["sender_user_id", "created_at"])
    op.create_index("ix_point_transfers_receiver_created", "point_transfers", ["receiver_user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_point_transfers_receiver_created", table_name="point_transfers")
    op.drop_index("ix_point_transfers_sender_created", table_name="point_transfers")
    op.drop_index("ix_point_transfers_created_at", table_name="point_transfers")
    op.drop_index("ix_point_transfers_status", table_name="point_transfers")
    op.drop_index("ix_point_transfers_currency", table_name="point_transfers")
    op.drop_index("ix_point_transfers_receiver_user_id", table_name="point_transfers")
    op.drop_index("ix_point_transfers_sender_user_id", table_name="point_transfers")
    op.drop_index("ix_point_transfers_reference_code", table_name="point_transfers")
    op.drop_table("point_transfers")

    op.drop_column("sandbox_transactions", "account_identifier")
    op.drop_column("sandbox_transactions", "account_name")
    op.drop_column("sandbox_transactions", "transfer_channel")
