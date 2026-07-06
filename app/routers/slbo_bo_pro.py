from __future__ import annotations

from decimal import Decimal
import time

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import BoOrder, RapidEntry
from app.services.slbo import (
    bo_session_clock,
    ensure_wallet,
    get_bo_market_snapshot,
    get_bo_system_candles,
    get_or_create_rapid_result_board,
    get_recent_bo_session_results,
    get_recent_rapid_result_boards,
    grant_initial_member_points_if_needed,
    rapid_session_clock,
)


router = APIRouter()


def _format_decimal(value) -> str:
    return f"{Decimal(str(value or 0)):.4f}"


def _session_index(clock: dict) -> int:
    raw = str(clock.get("session_code", "S0")).upper().removeprefix("S")
    return int(raw) if raw.isdigit() else int(time.time()) // int(clock.get("total_seconds") or 60)


def _session_payload(clock: dict) -> dict:
    total_seconds = int(clock["total_seconds"])
    open_seconds = int(clock["open_seconds"])
    processing_seconds = max(0, total_seconds - open_seconds)
    index = _session_index(clock)
    start_ts = index * total_seconds
    cutoff_ts = start_ts + open_seconds
    close_ts = start_ts + total_seconds
    state = str(clock["state"])
    return {
        "session_code": str(clock["session_code"]),
        "state": state,
        "phase_label": "Đang đặt lệnh" if state == "open" else "Đang xử lý kết quả",
        "remaining": int(clock["remaining"]),
        "elapsed": int(clock["elapsed"]),
        "total_seconds": total_seconds,
        "open_seconds": open_seconds,
        "processing_seconds": processing_seconds,
        "current_session_start_ts": start_ts,
        "current_session_cutoff_ts": cutoff_ts,
        "current_session_close_ts": close_ts,
    }


def _bo_result_payload(result: dict) -> dict:
    return {
        "session_code": result["session_code"],
        "asset": result["asset"],
        "result_side": result["result_side"],
        "entry_price": _format_decimal(result["entry_price"]),
        "result_price": _format_decimal(result["result_price"]),
        "change_percent": _format_decimal(result["change_percent"]),
        "status": "settled",
    }


def _bo_candle_payload(candle: dict) -> dict:
    return {
        "time": int(candle["time"]),
        "open": float(candle["open"]),
        "high": float(candle["high"]),
        "low": float(candle["low"]),
        "close": float(candle["close"]),
    }


def _bo_order_payload(order: BoOrder) -> dict:
    return {
        "reference_code": order.reference_code,
        "session_code": order.session_code,
        "asset": order.asset,
        "side": order.side.value,
        "stake_amount": _format_decimal(order.stake_amount),
        "status": order.status.value,
        "result_price": _format_decimal(order.result_price),
        "created_at": order.created_at.isoformat(),
    }


def _rapid_board_payload(board: dict) -> dict:
    return {
        "session_code": board["session_code"],
        "special": board["special"],
        "prizes": board["prizes"],
        "heads": board["heads"],
        "special_tail": board["special_tail"],
    }


def _rapid_entry_payload(entry: RapidEntry) -> dict:
    return {
        "reference_code": entry.reference_code,
        "session_code": entry.session_code,
        "play_type": entry.play_type.value,
        "selection": entry.selection,
        "stake_amount": _format_decimal(entry.stake_amount),
        "status": entry.status.value,
        "result_code": entry.result_code,
        "result_amount": _format_decimal(entry.result_amount),
        "created_at": entry.created_at.isoformat(),
    }


@router.get("/api/slbo/room-state")
def slbo_room_state_pro(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    wallet = None
    if user:
        wallet = ensure_wallet(db, user)
        grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    bo_clock = bo_session_clock()
    bo_meta = _session_payload(bo_clock)
    rapid_clock = rapid_session_clock()
    market = get_bo_market_snapshot()
    bo_results_by_asset = {
        item["code"]: [_bo_result_payload(result) for result in get_recent_bo_session_results(db, str(item["code"]), 5, market)]
        for item in market["assets"]
    }
    rapid_result = get_or_create_rapid_result_board(db, str(rapid_clock["session_code"]))
    rapid_results = get_recent_rapid_result_boards(db, 5)
    orders = (
        db.query(BoOrder)
        .filter(BoOrder.user_id == user.id)
        .order_by(BoOrder.created_at.desc())
        .limit(10)
        .all()
        if user
        else []
    )
    entries = (
        db.query(RapidEntry)
        .filter(RapidEntry.user_id == user.id)
        .order_by(RapidEntry.created_at.desc())
        .limit(10)
        .all()
        if user
        else []
    )
    db.commit()
    return JSONResponse(
        {
            "bo_clock": bo_meta,
            "rapid_clock": _session_payload(rapid_clock),
            "bo_results_by_asset": bo_results_by_asset,
            "rapid_result": _rapid_board_payload(rapid_result),
            "rapid_results": [_rapid_board_payload(item) for item in rapid_results],
            "wallet": {
                "available_balance": _format_decimal(wallet.available_balance),
                "currency": wallet.currency,
            }
            if wallet
            else None,
            "orders": [_bo_order_payload(order) for order in orders],
            "entries": [_rapid_entry_payload(entry) for entry in entries],
            "settlement": {
                "source": "BO System Chart",
                "tradingview_role": "reference_only",
                "settlement_interval": "1m",
            },
        }
    )


@router.get("/api/slbo/bo-chart")
def slbo_bo_chart_api_pro(
    request: Request,
    db: Session = Depends(get_db),
    asset: str = "BTC",
    interval: str = "1",
    limit: int = 140,
):
    bo_clock = bo_session_clock()
    bo_meta = _session_payload(bo_clock)
    market = get_bo_market_snapshot()
    chart = get_bo_system_candles(db, asset_code=asset, interval=interval, limit=limit, market=market)
    recent_results = get_recent_bo_session_results(db, chart["asset"], 5, market)
    latest = chart["candles"][-1] if chart["candles"] else None
    current_result = None
    if bo_meta["state"] != "open":
        rows = [item for item in recent_results if item["session_code"] == bo_meta["session_code"]]
        current_result = _bo_result_payload(rows[0]) if rows else None
    db.commit()
    return JSONResponse(
        {
            "asset": chart["asset"],
            "symbol": chart["symbol"],
            "interval": chart["interval"],
            "interval_seconds": chart["interval_seconds"],
            "settlement_interval": "1m",
            "settlement_source": "BO System Chart",
            "tradingview_role": "reference_only",
            "updated_at": chart["updated_at"].isoformat(),
            "latest": _bo_candle_payload(latest) if latest else None,
            "candles": [_bo_candle_payload(item) for item in chart["candles"]],
            "recent_results": [_bo_result_payload(item) for item in recent_results],
            "current_session_code": bo_meta["session_code"],
            "current_session_start_ts": bo_meta["current_session_start_ts"],
            "cutoff_ts": bo_meta["current_session_cutoff_ts"],
            "close_ts": bo_meta["current_session_close_ts"],
            "session_result": current_result,
            "processing_zone": {
                "start": bo_meta["current_session_cutoff_ts"],
                "end": bo_meta["current_session_close_ts"],
                "active": bo_meta["state"] == "processing",
                "label": "30s processing / risk-control",
            },
        }
    )
