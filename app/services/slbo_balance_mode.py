from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import BoSessionResult
from app.services import slbo as core
from app.services.slbo_exposure_guard import session_side_totals


def _amount(value, places: str = "0.0001") -> Decimal:
    try:
        parsed = Decimal(str(value or 0)).quantize(Decimal(places))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_balance_mode_setting") from exc
    return parsed if parsed > 0 else Decimal("0")


def ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS slbo_bo_balance_controls (
                id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                min_total_stake NUMERIC(18, 4) NOT NULL DEFAULT 100.0000,
                min_gap_percent NUMERIC(8, 2) NOT NULL DEFAULT 20.00,
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
            INSERT INTO slbo_bo_balance_controls (
                id, enabled, min_total_stake, min_gap_percent, note, created_at, updated_at
            )
            SELECT 1, 0, 100.0000, 20.00, 'BO demo balance mode', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM slbo_bo_balance_controls WHERE id = 1)
            """
        )
    )
    db.commit()


def get_balance_controls(db: Session) -> dict:
    ensure_table(db)
    row = db.execute(text("SELECT * FROM slbo_bo_balance_controls WHERE id = 1")).mappings().first()
    if not row:
        return {
            "enabled": False,
            "min_total_stake": Decimal("100.0000"),
            "min_gap_percent": Decimal("20.00"),
            "note": "BO demo balance mode",
        }
    return {
        "enabled": bool(row["enabled"]),
        "min_total_stake": _amount(row["min_total_stake"]),
        "min_gap_percent": _amount(row["min_gap_percent"], "0.01"),
        "note": row.get("note") or "",
        "updated_by_user_id": row.get("updated_by_user_id"),
        "updated_at": row.get("updated_at"),
    }


def update_balance_controls(
    db: Session,
    *,
    enabled: bool,
    min_total_stake,
    min_gap_percent,
    note: str = "",
    admin_user_id: int | None = None,
) -> dict:
    ensure_table(db)
    db.execute(
        text(
            """
            UPDATE slbo_bo_balance_controls
            SET enabled = :enabled,
                min_total_stake = :min_total_stake,
                min_gap_percent = :min_gap_percent,
                note = :note,
                updated_by_user_id = :admin_user_id,
                updated_at = :updated_at
            WHERE id = 1
            """
        ),
        {
            "enabled": 1 if enabled else 0,
            "min_total_stake": _amount(min_total_stake),
            "min_gap_percent": _amount(min_gap_percent, "0.01"),
            "note": str(note or "")[:500],
            "admin_user_id": admin_user_id,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    db.commit()
    return get_balance_controls(db)


def _selected_low_exposure_side(db: Session, *, session_code: str, asset_code: str) -> tuple[str, dict] | tuple[None, dict]:
    controls = get_balance_controls(db)
    snapshot = session_side_totals(db, session_code=session_code, asset_code=asset_code)
    if not controls["enabled"]:
        return None, {**snapshot, "reason": "balance_mode_disabled"}
    if _amount(snapshot["total"]) < _amount(controls["min_total_stake"]):
        return None, {**snapshot, "reason": "below_min_total_stake"}
    if _amount(snapshot["gap_percent"], "0.01") < _amount(controls["min_gap_percent"], "0.01"):
        return None, {**snapshot, "reason": "below_min_gap_percent"}
    buy_total = _amount(snapshot["buy_total"])
    sell_total = _amount(snapshot["sell_total"])
    if buy_total > sell_total:
        return "sell", {**snapshot, "reason": "low_exposure_side"}
    if sell_total > buy_total:
        return "buy", {**snapshot, "reason": "low_exposure_side"}
    return None, {**snapshot, "reason": "balanced_sides"}


def _reprice_for_side(record: BoSessionResult, result_side: str) -> None:
    entry = core._money(record.entry_price, places=8)
    old_result = core._money(record.result_price, places=8)
    if entry <= 0:
        return
    move = abs(old_result - entry) / entry
    if move <= Decimal("0"):
        move = Decimal("0.0010")
    direction = Decimal("1") if result_side == "buy" else Decimal("-1")
    new_result = core._money(entry * (Decimal("1") + direction * move), places=8)
    record.result_side = result_side
    record.result_price = new_result
    record.change_percent = core._money((new_result - entry) / entry * Decimal("100"), places=4)
    record.source = "demo_balance_mode:low_exposure_side"
    record.settled_at = datetime.now(timezone.utc)


def get_or_create_demo_balanced_bo_result(
    db: Session,
    session_code: str | int | None = None,
    asset_code: str = "BTC",
    market: dict | None = None,
    original_getter=None,
) -> dict:
    getter = original_getter or core.get_or_create_bo_session_result
    result = getter(db, session_code, asset_code, market)
    code = str(result["session_code"])
    asset = str(result["asset"])
    selected_side, meta = _selected_low_exposure_side(db, session_code=code, asset_code=asset)
    if not selected_side:
        return result
    record = (
        db.query(BoSessionResult)
        .filter(BoSessionResult.session_code == code, BoSessionResult.asset == asset)
        .first()
    )
    if not record:
        return result
    if record.source.startswith("demo_balance_mode"):
        return core._bo_record_payload(record)
    if record.result_side != selected_side:
        _reprice_for_side(record, selected_side)
        db.flush()
    else:
        record.source = "demo_balance_mode:low_exposure_side"
        record.settled_at = datetime.now(timezone.utc)
        db.flush()
    return core._bo_record_payload(record)
