"""add referral affiliate system

Revision ID: 20260703_0008
Revises: 20260620_0007
Create Date: 2026-07-03 09:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260703_0008"
down_revision = "20260620_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    op.add_column("users", sa.Column("uid", sa.String(length=24), nullable=False, server_default=""))
    op.add_column("users", sa.Column("referral_code", sa.String(length=24), nullable=False, server_default=""))
    op.add_column("users", sa.Column("referred_by_user_id", sa.Integer(), nullable=True))

    users = bind.execute(sa.text("SELECT id FROM users ORDER BY id ASC")).fetchall()
    for row in users:
        user_id = int(row[0])
        uid = f"GL{user_id:08d}"
        code = f"GL{user_id:08d}"
        bind.execute(
            sa.text("UPDATE users SET uid = :uid, referral_code = :code WHERE id = :id"),
            {"uid": uid, "code": code, "id": user_id},
        )

    op.create_index("ix_users_uid", "users", ["uid"], unique=True)
    op.create_index("ix_users_referral_code", "users", ["referral_code"], unique=True)
    op.create_index("ix_users_referred_by_user_id", "users", ["referred_by_user_id"])
    if dialect != "sqlite":
        op.create_foreign_key(
            "fk_users_referred_by_user_id_users",
            "users",
            "users",
            ["referred_by_user_id"],
            ["id"],
        )

    commission_type = sa.Enum("ACTIVITY", "LOSS_DEPOSIT", name="referralcommissiontype")
    commission_status = sa.Enum("PENDING", "APPROVED", "PAID", "VOID", name="referralcommissionstatus")
    if dialect == "postgresql":
        commission_type.create(bind, checkfirst=True)
        commission_status.create(bind, checkfirst=True)

    op.create_table(
        "referral_commissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference_code", sa.String(length=32), nullable=False),
        sa.Column("beneficiary_user_id", sa.Integer(), nullable=False),
        sa.Column("source_user_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("commission_type", commission_type, nullable=False),
        sa.Column("rate_percent", sa.Numeric(8, 4), nullable=False),
        sa.Column("base_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="POINT"),
        sa.Column("status", commission_status, nullable=False),
        sa.Column("reference_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("reference_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["beneficiary_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["source_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_referral_commissions_reference_code", "referral_commissions", ["reference_code"], unique=True)
    op.create_index("ix_referral_commissions_beneficiary_user_id", "referral_commissions", ["beneficiary_user_id"])
    op.create_index("ix_referral_commissions_source_user_id", "referral_commissions", ["source_user_id"])
    op.create_index("ix_referral_commissions_level", "referral_commissions", ["level"])
    op.create_index("ix_referral_commissions_commission_type", "referral_commissions", ["commission_type"])
    op.create_index("ix_referral_commissions_status", "referral_commissions", ["status"])
    op.create_index("ix_referral_commissions_currency", "referral_commissions", ["currency"])
    op.create_index(
        "ix_referral_commissions_beneficiary_created",
        "referral_commissions",
        ["beneficiary_user_id", "created_at"],
    )
    op.create_index(
        "ix_referral_commissions_source_created",
        "referral_commissions",
        ["source_user_id", "created_at"],
    )
    op.create_index(
        "ix_referral_commissions_level_type",
        "referral_commissions",
        ["level", "commission_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_referral_commissions_level_type", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_source_created", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_beneficiary_created", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_currency", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_status", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_commission_type", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_level", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_source_user_id", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_beneficiary_user_id", table_name="referral_commissions")
    op.drop_index("ix_referral_commissions_reference_code", table_name="referral_commissions")
    op.drop_table("referral_commissions")

    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.drop_constraint("fk_users_referred_by_user_id_users", "users", type_="foreignkey")
    op.drop_index("ix_users_referred_by_user_id", table_name="users")
    op.drop_index("ix_users_referral_code", table_name="users")
    op.drop_index("ix_users_uid", table_name="users")
    op.drop_column("users", "referred_by_user_id")
    op.drop_column("users", "referral_code")
    op.drop_column("users", "uid")
