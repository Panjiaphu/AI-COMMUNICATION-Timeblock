from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import InternalWallet, User
from app.services.slbo_member_outcome_settings import profit_percent


def _money(value, default=Decimal("0.0000")) -> Decimal:
    if value is None or value == "":
        value = default
    try:
        parsed = Decimal(str(value)).quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_amount") from exc
    if parsed < Decimal("0"):
        return Decimal("0.0000")
    return parsed


def ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS slbo_demo_order_controls (
                id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                positive_member_lock_enabled INTEGER NOT NULL DEFAULT 0,
                large_order_threshold NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
                large_order_mode TEXT NOT NULL DEFAULT 'session_condition_unavailable',
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
            INSERT INTO slbo_demo_order_controls (
                id, enabled, positive_member_lock_enabled, large_order_threshold,
                large_order_mode, note, created_at, updated_at
            )
            SELECT 1, 1, 0, 0.0000, 'session_condition_unavailable', 'Demo order controls', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM slbo_demo_order_controls WHERE id = 1)
            """
        )
    )
    db.commit()


def get_controls(db: Session) -> dict:
    ensure_table(db)
    row = db.execute(text("SELECT * FROM slbo_demo_order_controls WHERE id = 1")).mappings().first()
    if not row:
        return {
            "enabled": True,
            "positive_member_lock_enabled": False,
            "large_order_threshold": Decimal("0.0000"),
            "large_order_mode": "session_condition_unavailable",
            "note": "Demo order controls",
            "updated_by_user_id": None,
            "updated_at": None,
        }
    return {
        "enabled": bool(row["enabled"]),
        "positive_member_lock_enabled": bool(row["positive_member_lock_enabled"]),
        "large_order_threshold": _money(row["large_order_threshold"]),
        "large_order_mode": row.get("large_order_mode") or "session_condition_unavailable",
        "note": row.get("note") or "",
        "updated_by_user_id": row.get("updated_by_user_id"),
        "updated_at": row.get("updated_at"),
    }


def update_controls(
    db: Session,
    *,
    enabled: bool,
    positive_member_lock_enabled: bool,
    large_order_threshold,
    large_order_mode: str,
    note: str = "",
    admin_user_id: int | None = None,
) -> dict:
    ensure_table(db)
    mode = (large_order_mode or "session_condition_unavailable").strip()
    if mode not in {"session_condition_unavailable", "reject", "review"}:
        mode = "session_condition_unavailable"
    threshold = _money(large_order_threshold)
    db.execute(
        text(
            """
            UPDATE slbo_demo_order_controls
            SET enabled = :enabled,
                positive_member_lock_enabled = :positive_lock,
                large_order_threshold = :large_threshold,
                large_order_mode = :large_mode,
                note = :note,
                updated_by_user_id = :admin_user_id,
                updated_at = :updated_at
            WHERE id = 1
            """
        ),
        {
            "enabled": 1 if enabled else 0,
            "positive_lock": 1 if positive_member_lock_enabled else 0,
            "large_threshold": threshold,
            "large_mode": mode,
            "note": str(note or "")[:500],
            "admin_user_id": admin_user_id,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    db.commit()
    return get_controls(db)


def positive_member_count(db: Session, wallets: list[InternalWallet] | None = None) -> int:
    wallets = wallets if wallets is not None else db.query(InternalWallet).all()
    return sum(1 for wallet in wallets if profit_percent(wallet) > Decimal("0.00"))


def check_order_controls(db: Session, *, user: User, wallet: InternalWallet, stake_amount) -> None:
    controls = get_controls(db)
    if not controls["enabled"]:
        return
    threshold = _money(controls["large_order_threshold"])
    stake = _money(stake_amount)
    if threshold > 0 and stake >= threshold:
        mode = controls["large_order_mode"]
        if mode == "reject":
            raise ValueError("large_order_rejected")
        if mode == "review":
            raise ValueError("large_order_review_required")
        raise ValueError("large_order_risk_blocked")
    if controls["positive_member_lock_enabled"] and profit_percent(wallet) > Decimal("0.00"):
        raise ValueError("positive_member_risk_locked")
