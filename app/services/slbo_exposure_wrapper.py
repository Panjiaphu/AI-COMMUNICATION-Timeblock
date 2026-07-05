from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import slbo as core
from app.services.slbo_exposure_guard import assert_session_exposure


_ORIGINAL_PLACE_BO_ORDER = core.place_bo_order


def _amount(value, places="0.0001") -> Decimal:
    try:
        parsed = Decimal(str(value or 0)).quantize(Decimal(places))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_exposure_setting") from exc
    return parsed if parsed > 0 else Decimal(places)


def ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS slbo_bo_exposure_controls (
                id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                max_total_stake NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
                max_gap_percent NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
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
            INSERT INTO slbo_bo_exposure_controls (id, enabled, max_total_stake, max_gap_percent, note, created_at, updated_at)
            SELECT 1, 0, 0.0000, 0.00, 'BO exposure guard', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM slbo_bo_exposure_controls WHERE id = 1)
            """
        )
    )
    db.commit()


def get_exposure_controls(db: Session) -> dict:
    ensure_table(db)
    row = db.execute(text("SELECT * FROM slbo_bo_exposure_controls WHERE id = 1")).mappings().first()
    if not row:
        return {
            "enabled": False,
            "max_total_stake": Decimal("0.0000"),
            "max_gap_percent": Decimal("0.00"),
            "note": "BO exposure guard",
        }
    return {
        "enabled": bool(row["enabled"]),
        "max_total_stake": _amount(row["max_total_stake"]),
        "max_gap_percent": _amount(row["max_gap_percent"], "0.01"),
        "note": row.get("note") or "",
        "updated_by_user_id": row.get("updated_by_user_id"),
        "updated_at": row.get("updated_at"),
    }


def update_exposure_controls(
    db: Session,
    *,
    enabled: bool,
    max_total_stake,
    max_gap_percent,
    note: str = "",
    admin_user_id: int | None = None,
) -> dict:
    ensure_table(db)
    db.execute(
        text(
            """
            UPDATE slbo_bo_exposure_controls
            SET enabled = :enabled,
                max_total_stake = :max_total_stake,
                max_gap_percent = :max_gap_percent,
                note = :note,
                updated_by_user_id = :admin_user_id,
                updated_at = :updated_at
            WHERE id = 1
            """
        ),
        {
            "enabled": 1 if enabled else 0,
            "max_total_stake": _amount(max_total_stake),
            "max_gap_percent": _amount(max_gap_percent, "0.01"),
            "note": str(note or "")[:500],
            "admin_user_id": admin_user_id,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    db.commit()
    return get_exposure_controls(db)


def place_bo_order(db: Session, *, user, asset_code: str, side, stake_amount):
    controls = get_exposure_controls(db)
    if controls["enabled"]:
        clock = core.bo_session_clock()
        assert_session_exposure(
            db,
            session_code=str(clock["session_code"]),
            asset_code=asset_code,
            side=side.value if hasattr(side, "value") else str(side),
            stake_amount=stake_amount,
            max_total_stake=controls["max_total_stake"],
            max_gap_percent=controls["max_gap_percent"],
        )
    return _ORIGINAL_PLACE_BO_ORDER(
        db,
        user=user,
        asset_code=asset_code,
        side=side,
        stake_amount=stake_amount,
    )


core.place_bo_order = place_bo_order
