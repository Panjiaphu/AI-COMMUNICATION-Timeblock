from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import time

from sqlalchemy.orm import Session

from app.models import BoOrder, BoSide, GameRequestStatus, RapidEntry, RapidPlayType, User, WalletLedgerType
from app.services import slbo as core
from app.services.slbo_outcome_settings import get_member_target_success_rate


ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT = core.get_or_create_bo_session_result
ORIGINAL_GET_OR_CREATE_RAPID_RESULT_BOARD = core.get_or_create_rapid_result_board
ORIGINAL_GET_RAPID_RESULT = core._rapid_result

# Final Northern Rapid Draw payout configuration.
core.RAPID_PLAY_CONFIGS = {
    RapidPlayType.BAO_LO_2: core.RapidPlayConfig(RapidPlayType.BAO_LO_2, Decimal("90"), 27, exact_digits=2),
    RapidPlayType.BAO_LO_3: core.RapidPlayConfig(RapidPlayType.BAO_LO_3, Decimal("850"), 23, exact_digits=3),
    RapidPlayType.XIEN_2: core.RapidPlayConfig(RapidPlayType.XIEN_2, Decimal("15"), 1, requires_unique_count=2, exact_digits=2),
    RapidPlayType.XIEN_3: core.RapidPlayConfig(RapidPlayType.XIEN_3, Decimal("55"), 1, requires_unique_count=3, exact_digits=2),
    RapidPlayType.HEAD: core.RapidPlayConfig(RapidPlayType.HEAD, Decimal("90"), 5, exact_digits=1),
    RapidPlayType.TAIL: core.RapidPlayConfig(RapidPlayType.TAIL, Decimal("90"), 1, exact_digits=1),
    RapidPlayType.EVEN_ODD: core.RapidPlayConfig(RapidPlayType.EVEN_ODD, Decimal("1.95"), 1),
}


def _session_index(session_code: str | int | None, total_seconds: int) -> int:
    return core._session_index_from_code(session_code, total_seconds)


def _current_bo_index() -> int:
    settings = core.get_settings()
    return int(time.time()) // (settings.bo_trade_open_seconds + settings.bo_result_wait_seconds)


def _current_rapid_index() -> int:
    settings = core.get_settings()
    return int(time.time()) // settings.rapid_session_seconds


def _target_success(reference_code: str, user_id: int, rate: Decimal) -> bool:
    clamped = max(Decimal("0"), min(Decimal("100"), Decimal(str(rate))))
    threshold = int((clamped * Decimal("100")).to_integral_value())
    seed = int(hashlib.sha256(f"sandbox-success:{reference_code}:{user_id}".encode("utf-8")).hexdigest(), 16)
    return seed % 10000 < threshold


def _live_price(asset_code: str, timestamp: int, market: dict | None = None) -> Decimal:
    asset = core._bo_asset(asset_code)
    market = market or core.get_bo_market_snapshot()
    base = core._market_price_for_asset(asset, market)
    seed = int(hashlib.sha256(f"live-price:{asset.code}:{timestamp}".encode("utf-8")).hexdigest(), 16)
    drift = Decimal(seed % 100 - 50) / Decimal("100000")
    return core._money(base * (Decimal("1") + drift), places=8)


def _bo_order_result_price(entry_price: Decimal, side: BoSide, succeeds: bool, reference_code: str) -> Decimal:
    if side == BoSide.BUY:
        buy_succeeds = succeeds
    else:
        buy_succeeds = not succeeds
    return core._result_price(entry_price, buy_succeeds, reference_code)


def _safe_bo_price_at_timestamp(db: Session, asset_code: str, timestamp: int, market: dict | None = None) -> Decimal:
    settings = core.get_settings()
    total_seconds = settings.bo_trade_open_seconds + settings.bo_result_wait_seconds
    session_index = timestamp // total_seconds
    current_index = _current_bo_index()
    if session_index >= current_index:
        return _live_price(asset_code, timestamp, market)

    result = ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT(db, f"S{session_index}", asset_code, market)
    entry = core._money(result["entry_price"], places=8)
    close = core._money(result["result_price"], places=8)
    elapsed = max(0, min(total_seconds, timestamp - session_index * total_seconds))
    if elapsed <= 0:
        return entry
    if elapsed >= total_seconds:
        return close
    progress = Decimal(elapsed) / Decimal(total_seconds)
    return core._money(entry + (close - entry) * progress, places=8)


def get_bo_system_candles(db: Session, *, asset_code: str = "BTC", interval: str = "1S", limit: int = 120, market: dict | None = None) -> dict:
    interval_key, interval_seconds = core.normalize_bo_interval(interval)
    limit = max(20, min(int(limit or 120), 260))
    now = int(time.time())
    end_ts = now - (now % interval_seconds)
    start_ts = end_ts - (limit - 1) * interval_seconds
    market = market or core.get_bo_market_snapshot()
    asset = core._bo_asset(asset_code)
    candles: list[dict] = []
    for open_ts in range(start_ts, end_ts + 1, interval_seconds):
        close_ts = open_ts + interval_seconds
        open_price = _safe_bo_price_at_timestamp(db, asset.code, open_ts, market)
        close_price = _safe_bo_price_at_timestamp(db, asset.code, close_ts, market)
        seed = int(hashlib.sha256(f"safe-candle:{asset.code}:{interval_key}:{open_ts}".encode("utf-8")).hexdigest(), 16)
        spread = max(open_price * Decimal("0.00018"), Decimal("0.0001"))
        upper = Decimal(seed % 9 + 1) / Decimal("10") * spread
        lower = Decimal((seed >> 4) % 9 + 1) / Decimal("10") * spread
        candles.append(
            {
                "time": open_ts,
                "open": core._money(open_price, places=8),
                "high": core._money(max(open_price, close_price) + upper, places=8),
                "low": core._money(min(open_price, close_price) - lower, places=8),
                "close": core._money(close_price, places=8),
            }
        )
    return {
        "asset": asset.code,
        "symbol": asset.tradingview_symbol,
        "interval": interval_key,
        "interval_seconds": interval_seconds,
        "candles": candles,
        "updated_at": datetime.now(timezone.utc),
    }


def _masked_rapid_board(session_code: str | int | None) -> dict:
    code = str(session_code or core.rapid_session_clock()["session_code"])
    return {
        "session_code": code,
        "special": "--",
        "prizes": [
            {"key": "special", "digits": 5, "numbers": ["-----"]},
            {"key": "g1", "digits": 5, "numbers": ["-----"]},
            {"key": "g2", "digits": 5, "numbers": ["-----", "-----"]},
            {"key": "g3", "digits": 5, "numbers": ["-----"] * 6},
            {"key": "g4", "digits": 4, "numbers": ["----"] * 4},
            {"key": "g5", "digits": 4, "numbers": ["----"] * 6},
            {"key": "g6", "digits": 3, "numbers": ["---"] * 3},
            {"key": "g7", "digits": 2, "numbers": ["--"] * 4},
        ],
        "two_digit_positions": [],
        "three_digit_positions": [],
        "heads": {str(index): [] for index in range(10)},
        "special_tail": "-",
    }


def _rapid_result(play_type: RapidPlayType, selection: str, board: dict) -> tuple[int, str]:
    if play_type == RapidPlayType.HEAD:
        result_code = str(board["special"])
        first_five_positions = board["two_digit_positions"][:5]
        return sum(1 for value in first_five_positions if value.startswith(selection)), result_code
    return ORIGINAL_GET_RAPID_RESULT(play_type, selection, board)


def _rapid_success_result(entry: RapidEntry, board: dict) -> tuple[int, str]:
    result_code = str(board.get("special") or "")
    if entry.play_type in {RapidPlayType.BAO_LO_2, RapidPlayType.BAO_LO_3, RapidPlayType.XIEN_2, RapidPlayType.XIEN_3, RapidPlayType.HEAD, RapidPlayType.TAIL, RapidPlayType.EVEN_ODD}:
        return 1, result_code
    return 0, result_code


def place_bo_order(db: Session, *, user: User, asset_code: str, side, stake_amount: Decimal) -> BoOrder:
    core._assert_sandbox()
    stake = core._positive_amount(stake_amount)
    if stake > Decimal("1000"):
        raise ValueError("stake_above_limit")
    asset_code = asset_code.strip().upper()
    market = core.get_bo_market_snapshot()
    asset = next((item for item in market["assets"] if item["code"] == asset_code), None)
    if not asset:
        raise ValueError("invalid_asset")

    wallet = core.ensure_wallet(db, user)
    core.grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    treasury = core.ensure_treasury(db)
    if core._money(wallet.available_balance) < stake:
        raise ValueError("insufficient_balance")

    clock = core.bo_session_clock()
    if clock["state"] != "open":
        raise ValueError("session_not_open")

    payout_ratio = core._money(core.get_settings().bo_payout_ratio)
    max_payout = (stake * payout_ratio).quantize(Decimal("0.0001"))
    if core._money(treasury.available_balance) + stake - max_payout < core._money(treasury.reserve_floor):
        raise ValueError("session_condition_unavailable")

    reference_code = core._unique_code(db, BoOrder, "BO")
    entry_price = _live_price(asset_code, int(time.time()), market)
    core._debit_wallet(db, wallet=wallet, amount=stake, entry_type=WalletLedgerType.BO_STAKE, reference_type="bo_order", reference_id=reference_code, reason="BO stake accepted; result pending")
    core._credit_treasury(db, treasury, stake, "bo_stake", "bo_order", reference_code, "BO stake accepted; result pending")

    order = BoOrder(
        reference_code=reference_code,
        user_id=user.id,
        session_code=str(clock["session_code"]),
        asset=asset_code,
        side=side,
        stake_amount=stake,
        payout_ratio=payout_ratio,
        entry_price=entry_price,
        result_price=Decimal("0"),
        status=GameRequestStatus.ACCEPTED,
        profit_amount=Decimal("0"),
        result_note="pending_session_result",
        settled_at=None,
    )
    db.add(order)
    db.flush()
    core._create_activity_commissions(db, user, stake, "bo_order", reference_code)
    db.commit()
    db.refresh(order)
    return order


def _settle_bo_order(db: Session, order: BoOrder, market: dict | None = None) -> None:
    if order.status != GameRequestStatus.ACCEPTED or order.settled_at is not None:
        return
    treasury = core.ensure_treasury(db)
    wallet = core.ensure_wallet(db, order.user)
    result = ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT(db, order.session_code, order.asset, market)
    target_rate = get_member_target_success_rate(db)
    succeeds = _target_success(order.reference_code, order.user_id, target_rate)
    payout = (core._money(order.stake_amount) * core._money(order.payout_ratio)).quantize(Decimal("0.0001"))
    entry_price = core._money(order.entry_price or result["entry_price"], places=8)
    order.entry_price = entry_price
    order.result_price = _bo_order_result_price(entry_price, order.side, succeeds, order.reference_code)
    order.settled_at = datetime.now(timezone.utc)

    if succeeds:
        try:
            core._debit_treasury(db, treasury, payout, "bo_payout", "bo_order", order.reference_code, "BO deferred sandbox payout")
        except ValueError:
            order.status = GameRequestStatus.REFUNDED
            order.profit_amount = Decimal("0")
            order.result_note = "refunded_by_session_condition"
            core._debit_treasury(db, treasury, core._money(order.stake_amount), "bo_refund", "bo_order", order.reference_code, "BO stake refund")
            core._credit_wallet(db, wallet=wallet, amount=core._money(order.stake_amount), entry_type=WalletLedgerType.BO_PAYOUT, reference_type="bo_order", reference_id=order.reference_code, reason="BO stake refunded by session condition")
            return
        order.status = GameRequestStatus.WON
        order.profit_amount = (payout - core._money(order.stake_amount)).quantize(Decimal("0.0001"))
        order.result_note = f"sandbox_target_success_rate:{target_rate}"
        wallet.total_profit = core._money(wallet.total_profit) + order.profit_amount
        core._credit_wallet(db, wallet=wallet, amount=payout, entry_type=WalletLedgerType.BO_PAYOUT, reference_type="bo_order", reference_id=order.reference_code, reason="BO deferred sandbox payout")
    else:
        order.status = GameRequestStatus.LOST
        order.profit_amount = -core._money(order.stake_amount)
        order.result_note = f"sandbox_target_success_rate:{target_rate}"
        wallet.total_loss = core._money(wallet.total_loss) + core._money(order.stake_amount)
        core.maybe_create_loss_deposit_commissions(db, order.user)


def settle_due_bo_orders(db: Session) -> int:
    settings = core.get_settings()
    total_seconds = settings.bo_trade_open_seconds + settings.bo_result_wait_seconds
    current_index = _current_bo_index()
    pending = db.query(BoOrder).filter(BoOrder.status == GameRequestStatus.ACCEPTED, BoOrder.settled_at.is_(None)).limit(500).all()
    market = core.get_bo_market_snapshot()
    count = 0
    for order in pending:
        if _session_index(order.session_code, total_seconds) < current_index:
            _settle_bo_order(db, order, market)
            count += 1
    if count:
        db.commit()
    return count


def get_recent_bo_session_results(db: Session, asset_code: str = "BTC", limit: int = 5, market: dict | None = None) -> list[dict]:
    settle_due_bo_orders(db)
    current_index = _current_bo_index()
    start_index = current_index - 1
    if start_index < 0:
        return []
    market = market or core.get_bo_market_snapshot()
    return [
        ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT(db, f"S{index}", asset_code, market)
        for index in range(start_index, max(-1, start_index - max(1, limit)), -1)
    ]


def place_rapid_entry(db: Session, *, user: User, play_type: RapidPlayType, selection: str, stake_amount: Decimal) -> RapidEntry:
    core._assert_sandbox()
    stake = core._positive_amount(stake_amount)
    config = core.RAPID_PLAY_CONFIGS[play_type]
    normalized_selection = core.normalize_rapid_selection(play_type, selection)
    wallet = core.ensure_wallet(db, user)
    core.grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    treasury = core.ensure_treasury(db)
    if core._money(wallet.available_balance) < stake:
        raise ValueError("insufficient_balance")

    clock = core.rapid_session_clock()
    if clock["state"] != "open":
        raise ValueError("session_not_open")

    max_payout = (stake * config.payout_ratio * Decimal(config.max_hit_count)).quantize(Decimal("0.0001"))
    if core._money(treasury.available_balance) + stake - max_payout < core._money(treasury.reserve_floor):
        raise ValueError("session_condition_unavailable")

    reference_code = core._unique_code(db, RapidEntry, "NR")
    core._debit_wallet(db, wallet=wallet, amount=stake, entry_type=WalletLedgerType.RAPID_STAKE, reference_type="rapid_entry", reference_id=reference_code, reason="Rapid stake accepted; result pending")
    core._credit_treasury(db, treasury, stake, "rapid_stake", "rapid_entry", reference_code, "Rapid stake accepted; result pending")

    entry = RapidEntry(
        reference_code=reference_code,
        user_id=user.id,
        session_code=str(clock["session_code"]),
        play_type=play_type,
        selection=normalized_selection,
        stake_amount=stake,
        payout_ratio=config.payout_ratio,
        hit_count=0,
        result_code="",
        status=GameRequestStatus.ACCEPTED,
        result_amount=Decimal("0"),
        settled_at=None,
    )
    db.add(entry)
    db.flush()
    core._create_activity_commissions(db, user, stake, "rapid_entry", reference_code)
    db.commit()
    db.refresh(entry)
    return entry


def _settle_rapid_entry(db: Session, entry: RapidEntry) -> None:
    if entry.status != GameRequestStatus.ACCEPTED or entry.settled_at is not None:
        return
    treasury = core.ensure_treasury(db)
    wallet = core.ensure_wallet(db, entry.user)
    board = ORIGINAL_GET_OR_CREATE_RAPID_RESULT_BOARD(db, entry.session_code)
    target_rate = get_member_target_success_rate(db)
    succeeds = _target_success(entry.reference_code, entry.user_id, target_rate)
    actual_hit_count, result_code = _rapid_result(entry.play_type, entry.selection, board)
    hit_count = actual_hit_count
    if succeeds and hit_count <= 0:
        hit_count, result_code = _rapid_success_result(entry, board)
    if not succeeds:
        hit_count = 0
    payout = (core._money(entry.stake_amount) * core._money(entry.payout_ratio) * Decimal(hit_count)).quantize(Decimal("0.0001"))
    entry.hit_count = hit_count
    entry.result_code = result_code
    entry.settled_at = datetime.now(timezone.utc)

    if hit_count > 0:
        try:
            core._debit_treasury(db, treasury, payout, "rapid_payout", "rapid_entry", entry.reference_code, "Rapid deferred sandbox payout")
        except ValueError:
            entry.status = GameRequestStatus.REFUNDED
            entry.result_amount = Decimal("0")
            core._debit_treasury(db, treasury, core._money(entry.stake_amount), "rapid_refund", "rapid_entry", entry.reference_code, "Rapid stake refund")
            core._credit_wallet(db, wallet=wallet, amount=core._money(entry.stake_amount), entry_type=WalletLedgerType.RAPID_PAYOUT, reference_type="rapid_entry", reference_id=entry.reference_code, reason="Rapid stake refunded by session condition")
            return
        entry.status = GameRequestStatus.WON
        entry.result_amount = payout
        wallet.total_profit = core._money(wallet.total_profit) + (payout - core._money(entry.stake_amount))
        core._credit_wallet(db, wallet=wallet, amount=payout, entry_type=WalletLedgerType.RAPID_PAYOUT, reference_type="rapid_entry", reference_id=entry.reference_code, reason="Rapid deferred sandbox payout")
    else:
        entry.status = GameRequestStatus.LOST
        entry.result_amount = Decimal("0")
        wallet.total_loss = core._money(wallet.total_loss) + core._money(entry.stake_amount)
        core.maybe_create_loss_deposit_commissions(db, entry.user)


def settle_due_rapid_entries(db: Session) -> int:
    current_index = _current_rapid_index()
    settings = core.get_settings()
    pending = db.query(RapidEntry).filter(RapidEntry.status == GameRequestStatus.ACCEPTED, RapidEntry.settled_at.is_(None)).limit(500).all()
    count = 0
    for entry in pending:
        if _session_index(entry.session_code, settings.rapid_session_seconds) < current_index:
            _settle_rapid_entry(db, entry)
            count += 1
    if count:
        db.commit()
    return count


def get_or_create_rapid_result_board(db: Session, session_code: str | int | None = None) -> dict:
    settle_due_rapid_entries(db)
    settings = core.get_settings()
    code = str(session_code or core.rapid_session_clock()["session_code"])
    if _session_index(code, settings.rapid_session_seconds) >= _current_rapid_index():
        return _masked_rapid_board(code)
    return ORIGINAL_GET_OR_CREATE_RAPID_RESULT_BOARD(db, code)


def get_recent_rapid_result_boards(db: Session, limit: int = 5) -> list[dict]:
    settle_due_rapid_entries(db)
    current_index = _current_rapid_index()
    start_index = current_index - 1
    if start_index < 0:
        return []
    return [
        ORIGINAL_GET_OR_CREATE_RAPID_RESULT_BOARD(db, f"S{index}")
        for index in range(start_index, max(-1, start_index - max(1, limit)), -1)
    ]


core._rapid_result = _rapid_result
core.get_bo_system_candles = get_bo_system_candles
core.get_recent_bo_session_results = get_recent_bo_session_results
core.place_bo_order = place_bo_order
core.get_or_create_rapid_result_board = get_or_create_rapid_result_board
core.get_recent_rapid_result_boards = get_recent_rapid_result_boards
core.place_bo_order = place_bo_order
core.place_rapid_entry = place_rapid_entry
core.settle_due_bo_orders = settle_due_bo_orders
core.settle_due_rapid_entries = settle_due_rapid_entries
