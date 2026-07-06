from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import BoOrder, GameRequestStatus
from app.services import slbo as core


_ORIGINAL_PLACE_BO_ORDER = core.place_bo_order
_ORIGINAL_SETTLE_DUE_BO_ORDERS = getattr(core, "settle_due_bo_orders", None)
_ORIGINAL_GET_RECENT_BO_SESSION_RESULTS = core.get_recent_bo_session_results


def _canonical_session_entry(db: Session, order: BoOrder, market: dict | None = None) -> Decimal:
    result = core.get_or_create_bo_session_result(db, order.session_code, order.asset, market)
    return core._money(result["entry_price"], places=8)


def normalize_pending_bo_order_entries(db: Session, *, market: dict | None = None, limit: int = 500) -> int:
    """Align pending BO orders with the 1-minute settlement candle open.

    Orders are accepted only during the 0-30s order window. Settlement belongs to
    the full 60s BO System Chart candle, so the stored order entry must match the
    canonical session open rather than an intra-window tick. This is idempotent
    and does not create payout ledger entries.
    """

    pending = (
        db.query(BoOrder)
        .filter(BoOrder.status == GameRequestStatus.ACCEPTED, BoOrder.settled_at.is_(None))
        .order_by(BoOrder.created_at.asc())
        .limit(limit)
        .all()
    )
    market = market or core.get_bo_market_snapshot()
    changed = 0
    for order in pending:
        canonical_entry = _canonical_session_entry(db, order, market)
        if core._money(order.entry_price, places=8) != canonical_entry:
            order.entry_price = canonical_entry
            order.result_note = "pending_60s_session_result"
            changed += 1
    if changed:
        db.flush()
    return changed


def place_bo_order(db: Session, *, user, asset_code: str, side, stake_amount):
    order = _ORIGINAL_PLACE_BO_ORDER(
        db,
        user=user,
        asset_code=asset_code,
        side=side,
        stake_amount=stake_amount,
    )
    if order.status == GameRequestStatus.ACCEPTED and order.settled_at is None:
        market = core.get_bo_market_snapshot()
        order.entry_price = _canonical_session_entry(db, order, market)
        order.result_price = Decimal("0")
        order.profit_amount = Decimal("0")
        order.result_note = "pending_60s_session_result"
        db.commit()
        db.refresh(order)
    return order


def settle_due_bo_orders(db: Session) -> int:
    normalize_pending_bo_order_entries(db)
    if _ORIGINAL_SETTLE_DUE_BO_ORDERS:
        return int(_ORIGINAL_SETTLE_DUE_BO_ORDERS(db) or 0)
    return 0


def get_recent_bo_session_results(db: Session, asset_code: str = "BTC", limit: int = 5, market: dict | None = None) -> list[dict]:
    settle_due_bo_orders(db)
    return _ORIGINAL_GET_RECENT_BO_SESSION_RESULTS(db, asset_code, limit, market)


core.normalize_pending_bo_order_entries = normalize_pending_bo_order_entries
core.place_bo_order = place_bo_order
core.settle_due_bo_orders = settle_due_bo_orders
core.get_recent_bo_session_results = get_recent_bo_session_results
