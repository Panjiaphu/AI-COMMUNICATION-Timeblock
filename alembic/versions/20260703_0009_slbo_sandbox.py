"""add slbo sandbox wallet and game ledgers

Revision ID: 20260703_0009
Revises: 20260703_0008
Create Date: 2026-07-03 11:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260703_0009"
down_revision = "20260703_0008"
branch_labels = None
depends_on = None


wallet_ledger_type = sa.Enum(
    "DEPOSIT_APPROVED",
    "WITHDRAW_APPROVED",
    "BO_STAKE",
    "BO_PAYOUT",
    "RAPID_STAKE",
    "RAPID_PAYOUT",
    "ADJUSTMENT",
    name="walletledgertype",
)
sandbox_request_type = sa.Enum("DEPOSIT", "WITHDRAW", name="sandboxrequesttype")
sandbox_request_status = sa.Enum("PENDING", "APPROVED", "REJECTED", "CANCELLED", name="sandboxrequeststatus")
game_request_status = sa.Enum(
    "PENDING_CONFIRMATION",
    "ACCEPTED",
    "REJECTED_BY_SESSION_CONDITION",
    "REFUNDED",
    "WON",
    "LOST",
    "CANCELLED_BY_SYSTEM",
    name="gamerequeststatus",
)
bo_side = sa.Enum("BUY", "SELL", name="boside")
rapid_play_type = sa.Enum(
    "BAO_LO_2",
    "BAO_LO_3",
    "XIEN_2",
    "XIEN_3",
    "HEAD",
    "TAIL",
    "EVEN_ODD",
    name="rapidplaytype",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for enum in (
            wallet_ledger_type,
            sandbox_request_type,
            sandbox_request_status,
            game_request_status,
            bo_side,
            rapid_play_type,
        ):
            enum.create(bind, checkfirst=True)

    op.create_table(
        "internal_wallets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="SLB_POINT"),
        sa.Column("available_balance", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("locked_balance", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_deposit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_withdraw", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_profit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_loss", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_internal_wallets_user_id", "internal_wallets", ["user_id"])
    op.create_index("ix_internal_wallets_currency", "internal_wallets", ["currency"])
    op.create_index("ix_internal_wallets_is_active", "internal_wallets", ["is_active"])
    op.create_index("ix_internal_wallets_user_currency", "internal_wallets", ["user_id", "currency"], unique=True)

    op.create_table(
        "point_ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("wallet_id", sa.Integer(), nullable=False),
        sa.Column("entry_type", wallet_ledger_type, nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("balance_before", sa.Numeric(18, 4), nullable=False),
        sa.Column("balance_after", sa.Numeric(18, 4), nullable=False),
        sa.Column("reference_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("reference_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["wallet_id"], ["internal_wallets.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_point_ledger_entries_user_id", "point_ledger_entries", ["user_id"])
    op.create_index("ix_point_ledger_entries_wallet_id", "point_ledger_entries", ["wallet_id"])
    op.create_index("ix_point_ledger_entries_entry_type", "point_ledger_entries", ["entry_type"])
    op.create_index("ix_point_ledger_entries_reference_type", "point_ledger_entries", ["reference_type"])
    op.create_index("ix_point_ledger_entries_reference_id", "point_ledger_entries", ["reference_id"])
    op.create_index("ix_point_ledger_entries_created_by_user_id", "point_ledger_entries", ["created_by_user_id"])
    op.create_index("ix_point_ledger_entries_created_at", "point_ledger_entries", ["created_at"])
    op.create_index("ix_point_ledger_user_created", "point_ledger_entries", ["user_id", "created_at"])

    op.create_table(
        "platform_treasury_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="SLB_POINT"),
        sa.Column("available_balance", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("reserve_floor", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_platform_profit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_platform_loss", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_platform_treasury_accounts_currency", "platform_treasury_accounts", ["currency"], unique=True)
    op.create_index("ix_platform_treasury_accounts_status", "platform_treasury_accounts", ["status"])

    op.create_table(
        "platform_ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("treasury_id", sa.Integer(), nullable=False),
        sa.Column("entry_type", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("balance_before", sa.Numeric(18, 4), nullable=False),
        sa.Column("balance_after", sa.Numeric(18, 4), nullable=False),
        sa.Column("reference_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("reference_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["treasury_id"], ["platform_treasury_accounts.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_platform_ledger_entries_treasury_id", "platform_ledger_entries", ["treasury_id"])
    op.create_index("ix_platform_ledger_entries_entry_type", "platform_ledger_entries", ["entry_type"])
    op.create_index("ix_platform_ledger_entries_reference_type", "platform_ledger_entries", ["reference_type"])
    op.create_index("ix_platform_ledger_entries_reference_id", "platform_ledger_entries", ["reference_id"])
    op.create_index("ix_platform_ledger_entries_created_by_user_id", "platform_ledger_entries", ["created_by_user_id"])
    op.create_index("ix_platform_ledger_entries_created_at", "platform_ledger_entries", ["created_at"])

    op.create_table(
        "sandbox_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_code", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("request_type", sandbox_request_type, nullable=False),
        sa.Column("status", sandbox_request_status, nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="SLB_POINT"),
        sa.Column("member_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("admin_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_sandbox_transactions_reference_code", "sandbox_transactions", ["reference_code"], unique=True)
    op.create_index("ix_sandbox_transactions_user_id", "sandbox_transactions", ["user_id"])
    op.create_index("ix_sandbox_transactions_request_type", "sandbox_transactions", ["request_type"])
    op.create_index("ix_sandbox_transactions_status", "sandbox_transactions", ["status"])
    op.create_index("ix_sandbox_transactions_currency", "sandbox_transactions", ["currency"])
    op.create_index("ix_sandbox_transactions_reviewed_by_user_id", "sandbox_transactions", ["reviewed_by_user_id"])

    op.create_table(
        "bo_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_code", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_code", sa.String(length=32), nullable=False),
        sa.Column("asset", sa.String(length=16), nullable=False),
        sa.Column("side", bo_side, nullable=False),
        sa.Column("stake_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("payout_ratio", sa.Numeric(10, 4), nullable=False, server_default="1.95"),
        sa.Column("entry_price", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("result_price", sa.Numeric(18, 8), nullable=False, server_default="0"),
        sa.Column("status", game_request_status, nullable=False),
        sa.Column("profit_amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("result_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_bo_orders_reference_code", "bo_orders", ["reference_code"], unique=True)
    op.create_index("ix_bo_orders_user_id", "bo_orders", ["user_id"])
    op.create_index("ix_bo_orders_session_code", "bo_orders", ["session_code"])
    op.create_index("ix_bo_orders_asset", "bo_orders", ["asset"])
    op.create_index("ix_bo_orders_side", "bo_orders", ["side"])
    op.create_index("ix_bo_orders_status", "bo_orders", ["status"])
    op.create_index("ix_bo_orders_created_at", "bo_orders", ["created_at"])
    op.create_index("ix_bo_orders_settled_at", "bo_orders", ["settled_at"])
    op.create_index("ix_bo_orders_user_created", "bo_orders", ["user_id", "created_at"])

    op.create_table(
        "rapid_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_code", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_code", sa.String(length=32), nullable=False),
        sa.Column("play_type", rapid_play_type, nullable=False),
        sa.Column("selection", sa.String(length=80), nullable=False),
        sa.Column("stake_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("payout_ratio", sa.Numeric(10, 4), nullable=False),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("result_code", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("status", game_request_status, nullable=False),
        sa.Column("result_amount", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_rapid_entries_reference_code", "rapid_entries", ["reference_code"], unique=True)
    op.create_index("ix_rapid_entries_user_id", "rapid_entries", ["user_id"])
    op.create_index("ix_rapid_entries_session_code", "rapid_entries", ["session_code"])
    op.create_index("ix_rapid_entries_play_type", "rapid_entries", ["play_type"])
    op.create_index("ix_rapid_entries_selection", "rapid_entries", ["selection"])
    op.create_index("ix_rapid_entries_status", "rapid_entries", ["status"])
    op.create_index("ix_rapid_entries_created_at", "rapid_entries", ["created_at"])
    op.create_index("ix_rapid_entries_settled_at", "rapid_entries", ["settled_at"])
    op.create_index("ix_rapid_entries_user_created", "rapid_entries", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_rapid_entries_user_created", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_settled_at", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_created_at", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_status", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_selection", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_play_type", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_session_code", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_user_id", table_name="rapid_entries")
    op.drop_index("ix_rapid_entries_reference_code", table_name="rapid_entries")
    op.drop_table("rapid_entries")

    op.drop_index("ix_bo_orders_user_created", table_name="bo_orders")
    op.drop_index("ix_bo_orders_settled_at", table_name="bo_orders")
    op.drop_index("ix_bo_orders_created_at", table_name="bo_orders")
    op.drop_index("ix_bo_orders_status", table_name="bo_orders")
    op.drop_index("ix_bo_orders_side", table_name="bo_orders")
    op.drop_index("ix_bo_orders_asset", table_name="bo_orders")
    op.drop_index("ix_bo_orders_session_code", table_name="bo_orders")
    op.drop_index("ix_bo_orders_user_id", table_name="bo_orders")
    op.drop_index("ix_bo_orders_reference_code", table_name="bo_orders")
    op.drop_table("bo_orders")

    op.drop_index("ix_sandbox_transactions_reviewed_by_user_id", table_name="sandbox_transactions")
    op.drop_index("ix_sandbox_transactions_currency", table_name="sandbox_transactions")
    op.drop_index("ix_sandbox_transactions_status", table_name="sandbox_transactions")
    op.drop_index("ix_sandbox_transactions_request_type", table_name="sandbox_transactions")
    op.drop_index("ix_sandbox_transactions_user_id", table_name="sandbox_transactions")
    op.drop_index("ix_sandbox_transactions_reference_code", table_name="sandbox_transactions")
    op.drop_table("sandbox_transactions")

    op.drop_index("ix_platform_ledger_entries_created_at", table_name="platform_ledger_entries")
    op.drop_index("ix_platform_ledger_entries_created_by_user_id", table_name="platform_ledger_entries")
    op.drop_index("ix_platform_ledger_entries_reference_id", table_name="platform_ledger_entries")
    op.drop_index("ix_platform_ledger_entries_reference_type", table_name="platform_ledger_entries")
    op.drop_index("ix_platform_ledger_entries_entry_type", table_name="platform_ledger_entries")
    op.drop_index("ix_platform_ledger_entries_treasury_id", table_name="platform_ledger_entries")
    op.drop_table("platform_ledger_entries")

    op.drop_index("ix_platform_treasury_accounts_status", table_name="platform_treasury_accounts")
    op.drop_index("ix_platform_treasury_accounts_currency", table_name="platform_treasury_accounts")
    op.drop_table("platform_treasury_accounts")

    op.drop_index("ix_point_ledger_user_created", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_created_at", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_created_by_user_id", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_reference_id", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_reference_type", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_entry_type", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_wallet_id", table_name="point_ledger_entries")
    op.drop_index("ix_point_ledger_entries_user_id", table_name="point_ledger_entries")
    op.drop_table("point_ledger_entries")

    op.drop_index("ix_internal_wallets_user_currency", table_name="internal_wallets")
    op.drop_index("ix_internal_wallets_is_active", table_name="internal_wallets")
    op.drop_index("ix_internal_wallets_currency", table_name="internal_wallets")
    op.drop_index("ix_internal_wallets_user_id", table_name="internal_wallets")
    op.drop_table("internal_wallets")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for enum in (
            rapid_play_type,
            bo_side,
            game_request_status,
            sandbox_request_status,
            sandbox_request_type,
            wallet_ledger_type,
        ):
            enum.drop(bind, checkfirst=True)
