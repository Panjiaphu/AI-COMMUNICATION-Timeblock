from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session


DEFAULT_MEMBER_TARGET_SUCCESS_RATE = Decimal("45.00")


def _clamp_rate(value: Decimal | str | int | float) -> Decimal:
    try:
        rate = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_success_rate") from exc
    if rate < Decimal("0"):
        return Decimal("0.00")
    if rate > Decimal("100"):
        return Decimal("100.00")
    return rate


def ensure_slbo_outcome_settings_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS slbo_outcome_settings (
                id INTEGER PRIMARY KEY,
                member_target_success_rate NUMERIC(5, 2) NOT NULL DEFAULT 45.00,
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
            INSERT INTO slbo_outcome_settings (id, member_target_success_rate, note, created_at, updated_at)
            SELECT 1, :rate, 'Sandbox outcome scenario default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM slbo_outcome_settings WHERE id = 1)
            """
        ),
        {"rate": DEFAULT_MEMBER_TARGET_SUCCESS_RATE},
    )
    db.commit()


def get_slbo_outcome_settings(db: Session) -> dict:
    ensure_slbo_outcome_settings_table(db)
    row = db.execute(
        text(
            """
            SELECT member_target_success_rate, note, updated_by_user_id, created_at, updated_at
            FROM slbo_outcome_settings
            WHERE id = 1
            """
        )
    ).mappings().first()
    if not row:
        return {
            "member_target_success_rate": DEFAULT_MEMBER_TARGET_SUCCESS_RATE,
            "note": "Sandbox outcome scenario default",
            "updated_by_user_id": None,
            "created_at": None,
            "updated_at": None,
        }
    return {
        "member_target_success_rate": _clamp_rate(row["member_target_success_rate"]),
        "note": row.get("note") or "",
        "updated_by_user_id": row.get("updated_by_user_id"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def get_member_target_success_rate(db: Session) -> Decimal:
    return _clamp_rate(get_slbo_outcome_settings(db)["member_target_success_rate"])


def update_member_target_success_rate(
    db: Session,
    *,
    rate: Decimal | str | int | float,
    note: str = "",
    admin_user_id: int | None = None,
) -> dict:
    ensure_slbo_outcome_settings_table(db)
    parsed = _clamp_rate(rate)
    db.execute(
        text(
            """
            UPDATE slbo_outcome_settings
            SET member_target_success_rate = :rate,
                note = :note,
                updated_by_user_id = :admin_user_id,
                updated_at = :updated_at
            WHERE id = 1
            """
        ),
        {
            "rate": parsed,
            "note": note.strip()[:500],
            "admin_user_id": admin_user_id,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    db.commit()
    return get_slbo_outcome_settings(db)
