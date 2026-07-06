from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session


DEFAULT_POLICY = {
    "activity_l1": Decimal("0.20"),
    "activity_l2": Decimal("0.08"),
    "activity_l3": Decimal("0.03"),
    "loss_l1": Decimal("6.00"),
    "loss_l2": Decimal("2.00"),
    "loss_l3": Decimal("1.00"),
    "auto_payout_enabled": True,
    "dust_balance_limit": Decimal("1.0000"),
    "min_commission_payout": Decimal("0.0001"),
    "note": "Default 3-level referral policy for internal points.",
}


def _decimal(value, places: str = "0.0001") -> Decimal:
    try:
        parsed = Decimal(str(value if value is not None else 0)).quantize(Decimal(places))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_referral_policy_number") from exc
    if parsed < 0:
        raise ValueError("negative_referral_policy_number")
    return parsed


def ensure_referral_policy_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS referral_commission_policy (
                id INTEGER PRIMARY KEY,
                activity_l1 NUMERIC(8, 4) NOT NULL DEFAULT 0.2000,
                activity_l2 NUMERIC(8, 4) NOT NULL DEFAULT 0.0800,
                activity_l3 NUMERIC(8, 4) NOT NULL DEFAULT 0.0300,
                loss_l1 NUMERIC(8, 4) NOT NULL DEFAULT 6.0000,
                loss_l2 NUMERIC(8, 4) NOT NULL DEFAULT 2.0000,
                loss_l3 NUMERIC(8, 4) NOT NULL DEFAULT 1.0000,
                auto_payout_enabled INTEGER NOT NULL DEFAULT 1,
                dust_balance_limit NUMERIC(18, 4) NOT NULL DEFAULT 1.0000,
                min_commission_payout NUMERIC(18, 4) NOT NULL DEFAULT 0.0001,
                note TEXT NOT NULL DEFAULT '',
                updated_by_user_id INTEGER NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db.execute(
        text(
            """
            INSERT INTO referral_commission_policy (
                id, activity_l1, activity_l2, activity_l3, loss_l1, loss_l2, loss_l3,
                auto_payout_enabled, dust_balance_limit, min_commission_payout, note, created_at, updated_at
            )
            SELECT 1, 0.2000, 0.0800, 0.0300, 6.0000, 2.0000, 1.0000,
                   1, 1.0000, 0.0001, 'Default 3-level referral policy for internal points.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM referral_commission_policy WHERE id = 1)
            """
        )
    )
    db.commit()


def get_referral_policy(db: Session) -> dict:
    ensure_referral_policy_table(db)
    row = db.execute(text("SELECT * FROM referral_commission_policy WHERE id = 1")).mappings().first()
    if not row:
        return dict(DEFAULT_POLICY)
    return {
        "activity_l1": _decimal(row.get("activity_l1")),
        "activity_l2": _decimal(row.get("activity_l2")),
        "activity_l3": _decimal(row.get("activity_l3")),
        "loss_l1": _decimal(row.get("loss_l1")),
        "loss_l2": _decimal(row.get("loss_l2")),
        "loss_l3": _decimal(row.get("loss_l3")),
        "auto_payout_enabled": bool(row.get("auto_payout_enabled")),
        "dust_balance_limit": _decimal(row.get("dust_balance_limit")),
        "min_commission_payout": _decimal(row.get("min_commission_payout")),
        "note": row.get("note") or "",
        "updated_by_user_id": row.get("updated_by_user_id"),
        "updated_at": row.get("updated_at"),
    }


def update_referral_policy(
    db: Session,
    *,
    activity_l1,
    activity_l2,
    activity_l3,
    loss_l1,
    loss_l2,
    loss_l3,
    auto_payout_enabled: bool,
    dust_balance_limit,
    min_commission_payout,
    note: str = "",
    admin_user_id: int | None = None,
) -> dict:
    ensure_referral_policy_table(db)
    values = {
        "activity_l1": _decimal(activity_l1),
        "activity_l2": _decimal(activity_l2),
        "activity_l3": _decimal(activity_l3),
        "loss_l1": _decimal(loss_l1),
        "loss_l2": _decimal(loss_l2),
        "loss_l3": _decimal(loss_l3),
        "auto_payout_enabled": 1 if auto_payout_enabled else 0,
        "dust_balance_limit": _decimal(dust_balance_limit),
        "min_commission_payout": _decimal(min_commission_payout),
        "note": str(note or "")[:500],
        "admin_user_id": admin_user_id,
        "updated_at": datetime.now(timezone.utc),
    }
    for key in ["activity_l1", "activity_l2", "activity_l3", "loss_l1", "loss_l2", "loss_l3"]:
        if values[key] > Decimal("100.0000"):
            raise ValueError("referral_rate_too_high")
    db.execute(
        text(
            """
            UPDATE referral_commission_policy
            SET activity_l1 = :activity_l1,
                activity_l2 = :activity_l2,
                activity_l3 = :activity_l3,
                loss_l1 = :loss_l1,
                loss_l2 = :loss_l2,
                loss_l3 = :loss_l3,
                auto_payout_enabled = :auto_payout_enabled,
                dust_balance_limit = :dust_balance_limit,
                min_commission_payout = :min_commission_payout,
                note = :note,
                updated_by_user_id = :admin_user_id,
                updated_at = :updated_at
            WHERE id = 1
            """
        ),
        values,
    )
    db.commit()
    return get_referral_policy(db)


def activity_rates(policy: dict) -> dict[int, Decimal]:
    return {1: policy["activity_l1"], 2: policy["activity_l2"], 3: policy["activity_l3"]}


def loss_deposit_rates(policy: dict) -> dict[int, Decimal]:
    return {1: policy["loss_l1"], 2: policy["loss_l2"], 3: policy["loss_l3"]}
