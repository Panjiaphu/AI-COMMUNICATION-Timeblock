from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import BoOrder, GameRequestStatus


def _amount(value) -> Decimal:
    parsed = Decimal(str(value or 0)).quantize(Decimal("0.0001"))
    return parsed if parsed > 0 else Decimal("0.0000")


def session_side_totals(db: Session, *, session_code: str, asset_code: str) -> dict:
    orders = (
        db.query(BoOrder)
        .filter(BoOrder.session_code == str(session_code), BoOrder.asset == asset_code.strip().upper())
        .all()
    )
    active = {GameRequestStatus.ACCEPTED, GameRequestStatus.WON, GameRequestStatus.LOST}
    buy_total = Decimal("0.0000")
    sell_total = Decimal("0.0000")
    for order in orders:
        if order.status not in active:
            continue
        if order.side.value == "buy":
            buy_total += _amount(order.stake_amount)
        elif order.side.value == "sell":
            sell_total += _amount(order.stake_amount)
    total = buy_total + sell_total
    gap_percent = Decimal("0.00")
    if total > 0:
        gap_percent = (abs(buy_total - sell_total) / total * Decimal("100")).quantize(Decimal("0.01"))
    return {
        "buy_total": buy_total,
        "sell_total": sell_total,
        "total": total,
        "gap_percent": gap_percent,
    }


def assert_session_exposure(
    db: Session,
    *,
    session_code: str,
    asset_code: str,
    side: str,
    stake_amount,
    max_total_stake=Decimal("0"),
    max_gap_percent=Decimal("0"),
) -> None:
    max_total = _amount(max_total_stake)
    max_gap = Decimal(str(max_gap_percent or 0)).quantize(Decimal("0.01"))
    if max_total <= 0 and max_gap <= 0:
        return
    snap = session_side_totals(db, session_code=session_code, asset_code=asset_code)
    buy_total = _amount(snap["buy_total"])
    sell_total = _amount(snap["sell_total"])
    stake = _amount(stake_amount)
    if str(side) == "buy":
        buy_total += stake
    else:
        sell_total += stake
    total = buy_total + sell_total
    if max_total > 0 and total > max_total:
        raise ValueError("exposure_limit_reached")
    if max_gap > 0 and total > 0:
        gap_percent = (abs(buy_total - sell_total) / total * Decimal("100")).quantize(Decimal("0.01"))
        if gap_percent > max_gap:
            raise ValueError("exposure_limit_reached")
