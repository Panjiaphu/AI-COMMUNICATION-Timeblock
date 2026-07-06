from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import (
    BoOrder,
    BoSessionResult,
    InternalWallet,
    PlatformLedgerEntry,
    PlatformTreasuryAccount,
    PointLedgerEntry,
    PointTransfer,
    RapidEntry,
    RapidResultBoard,
    SandboxTransaction,
)


RESET_KEY = "20260706_admin_slbo_dashboard_reset_5000"
SYSTEM_CAPITAL = Decimal("5000.0000")
CURRENCY = "SLB_POINT"


def _ensure_marker_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS slbo_demo_reset_markers (
                reset_key TEXT PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                note TEXT NOT NULL DEFAULT ''
            )
            """
        )
    )
    db.commit()


def _already_applied(db: Session) -> bool:
    _ensure_marker_table(db)
    row = db.execute(
        text("SELECT reset_key FROM slbo_demo_reset_markers WHERE reset_key = :reset_key"),
        {"reset_key": RESET_KEY},
    ).first()
    return row is not None


def _mark_applied(db: Session) -> None:
    db.execute(
        text(
            """
            INSERT INTO slbo_demo_reset_markers (reset_key, applied_at, note)
            VALUES (:reset_key, :applied_at, :note)
            """
        ),
        {
            "reset_key": RESET_KEY,
            "applied_at": datetime.now(timezone.utc),
            "note": "Reset BO/Rapid demo histories and platform treasury to 5000 SLB_POINT. Control settings preserved.",
        },
    )


def apply_demo_dashboard_reset(db: Session) -> bool:
    """Reset visible BO demo operations once without touching control settings.

    Preserved:
    - users and admin accounts
    - exchange rates
    - email notifications/replies
    - /admin/slbo/controls tables and settings
    - per-member policy settings

    Reset:
    - BO/Rapid demo histories and session results
    - sandbox wallet request histories and point transfers
    - point/platform ledgers
    - member internal wallet demo balances/P&L
    - platform treasury to 5000 SLB_POINT
    """

    if _already_applied(db):
        return False

    db.query(BoOrder).delete(synchronize_session=False)
    db.query(BoSessionResult).delete(synchronize_session=False)
    db.query(RapidEntry).delete(synchronize_session=False)
    db.query(RapidResultBoard).delete(synchronize_session=False)
    db.query(SandboxTransaction).delete(synchronize_session=False)
    db.query(PointTransfer).delete(synchronize_session=False)
    db.query(PointLedgerEntry).delete(synchronize_session=False)
    db.query(PlatformLedgerEntry).delete(synchronize_session=False)

    db.query(InternalWallet).update(
        {
            InternalWallet.available_balance: Decimal("0.0000"),
            InternalWallet.locked_balance: Decimal("0.0000"),
            InternalWallet.total_deposit: Decimal("0.0000"),
            InternalWallet.total_withdraw: Decimal("0.0000"),
            InternalWallet.total_profit: Decimal("0.0000"),
            InternalWallet.total_loss: Decimal("0.0000"),
            InternalWallet.is_active: True,
            InternalWallet.updated_at: datetime.now(timezone.utc),
        },
        synchronize_session=False,
    )

    treasury = db.query(PlatformTreasuryAccount).filter(PlatformTreasuryAccount.currency == CURRENCY).first()
    if not treasury:
        treasury = PlatformTreasuryAccount(currency=CURRENCY)
        db.add(treasury)
        db.flush()
    treasury.available_balance = SYSTEM_CAPITAL
    treasury.reserve_floor = Decimal("0.0000")
    treasury.total_platform_profit = Decimal("0.0000")
    treasury.total_platform_loss = Decimal("0.0000")
    treasury.status = "active"
    treasury.updated_at = datetime.now(timezone.utc)

    db.add(
        PlatformLedgerEntry(
            treasury_id=treasury.id,
            entry_type="demo_reset",
            amount=SYSTEM_CAPITAL,
            balance_before=Decimal("0.0000"),
            balance_after=SYSTEM_CAPITAL,
            reference_type="demo_reset",
            reference_id=RESET_KEY,
            reason="Demo dashboard reset: system capital set to 5000 SLB_POINT.",
        )
    )
    _mark_applied(db)
    db.commit()
    return True
