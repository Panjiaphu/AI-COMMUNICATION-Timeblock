from __future__ import annotations

from decimal import Decimal, InvalidOperation
import time

from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.i18n import resolve_locale
from app.core.security import get_current_user, require_user, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import BoOrder, BoSide, RapidEntry
from app.services import slbo as slbo_service
from app.services import slbo_delayed_settlement  # noqa: F401 - load delayed settlement wrapper before route/API helpers
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
    settle_due_bo_orders,
)


router = APIRouter()


def _format_decimal(value) -> str:
    return f"{Decimal(str(value or 0)):.4f}"


def _format_price8(value) -> str:
    return f"{Decimal(str(value or 0)):.8f}"


def _server_now_ms() -> int:
    return int(time.time() * 1000)


def _session_index(clock: dict, now_ms: int | None = None) -> int:
    raw = str(clock.get("session_code", "S0")).upper().removeprefix("S")
    return int(raw) if raw.isdigit() else int((now_ms or _server_now_ms()) // 1000) // int(clock.get("total_seconds") or 60)


def _session_payload(clock: dict, *, now_ms: int | None = None) -> dict:
    server_now_ms = now_ms or _server_now_ms()
    total_seconds = int(clock["total_seconds"])
    open_seconds = int(clock["open_seconds"])
    processing_seconds = max(0, total_seconds - open_seconds)
    index = _session_index(clock, server_now_ms)
    start_ms = index * total_seconds * 1000
    cutoff_ms = start_ms + open_seconds * 1000
    close_ms = start_ms + total_seconds * 1000
    next_start_ms = close_ms
    state = "open" if server_now_ms < cutoff_ms else "processing"
    remaining_ms = max(0, (cutoff_ms if state == "open" else close_ms) - server_now_ms)
    elapsed_ms = max(0, min(total_seconds * 1000, server_now_ms - start_ms))
    return {
        "session_code": str(clock["session_code"]),
        "state": state,
        "phase_label": "Đang đặt lệnh" if state == "open" else "Đang xử lý kết quả",
        "remaining": int((remaining_ms + 999) // 1000),
        "elapsed": int(elapsed_ms // 1000),
        "total_seconds": total_seconds,
        "open_seconds": open_seconds,
        "processing_seconds": processing_seconds,
        "server_now_ts": server_now_ms,
        "current_session_start_ts": start_ms,
        "current_session_cutoff_ts": cutoff_ms,
        "current_session_close_ts": close_ms,
        "next_session_start_ts": next_start_ms,
    }


def _bo_result_payload(result: dict) -> dict:
    return {
        "session_code": result["session_code"],
        "asset": result["asset"],
        "result_side": result["result_side"],
        "entry_price": _format_price8(result["entry_price"]),
        "result_price": _format_price8(result["result_price"]),
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
        "entry_price": _format_price8(order.entry_price),
        "result_price": _format_price8(order.result_price),
        "profit_amount": _format_decimal(order.profit_amount),
        "status": order.status.value,
        "result_note": order.result_note,
        "settled_at": order.settled_at.isoformat() if order.settled_at else None,
        "created_at": order.created_at.isoformat(),
    }


def _bo_order_marker(order: BoOrder) -> dict:
    return {
        "reference_code": order.reference_code,
        "side": order.side.value,
        "stake_amount": _format_decimal(order.stake_amount),
        "entry_price": _format_price8(order.entry_price),
        "created_at": order.created_at.isoformat(),
        "session_code": order.session_code,
        "asset": order.asset,
        "status": order.status.value,
        "result_price": _format_price8(order.result_price),
        "profit_amount": _format_decimal(order.profit_amount),
        "settled_at": order.settled_at.isoformat() if order.settled_at else None,
        "marker_type": "entry" if order.settled_at is None else "result",
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


@router.get("/bo")
def bo_room_pro(request: Request, db: Session = Depends(get_db)):
    if not get_settings().bo_public_enabled:
        return RedirectResponse(f"/?lang={resolve_locale(request)}", status_code=303)
    user = get_current_user(request, db)
    wallet = ensure_wallet(db, user) if user else None
    if user and wallet:
        grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    settled_count = settle_due_bo_orders(db)
    orders = (
        db.query(BoOrder)
        .filter(BoOrder.user_id == user.id)
        .order_by(BoOrder.created_at.desc())
        .limit(20)
        .all()
        if user
        else []
    )
    market = get_bo_market_snapshot()
    bo_recent_results = get_recent_bo_session_results(db, "BTC", 5, market)
    db.commit()
    if wallet:
        db.refresh(wallet)
    return templates.TemplateResponse(
        request=request,
        name="bo.html",
        context=context(
            request,
            user=user,
            wallet=wallet,
            orders=orders,
            market=market,
            bo_assets=slbo_service.BO_ASSETS,
            bo_clock=bo_session_clock(),
            bo_result=bo_recent_results[0] if bo_recent_results else None,
            bo_recent_results=bo_recent_results,
            bo_recent_results_json=[_bo_result_payload(item) for item in bo_recent_results],
            sandbox=slbo_service.sandbox_flags(),
            bo_settled_count=settled_count,
        ),
    )


@router.post("/bo/orders")
def create_bo_order_pro(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    asset: str = Form(...),
    side: str = Form(...),
    stake_amount: str = Form(...),
):
    if not get_settings().bo_public_enabled:
        return RedirectResponse(f"/?lang={resolve_locale(request)}", status_code=303)
    verify_csrf(request, csrf_token)
    user = require_user(request, db)
    locale = resolve_locale(request)
    try:
        order = slbo_service.place_bo_order(
            db,
            user=user,
            asset_code=asset,
            side=BoSide(side),
            stake_amount=Decimal(stake_amount),
        )
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/bo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/bo?lang={locale}&created={order.reference_code}&session={order.session_code}", status_code=303)


@router.get("/api/slbo/room-state")
def slbo_room_state_pro(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    wallet = None
    if user:
        wallet = ensure_wallet(db, user)
        grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    settle_due_bo_orders(db)
    now_ms = _server_now_ms()
    bo_clock = bo_session_clock()
    bo_meta = _session_payload(bo_clock, now_ms=now_ms)
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
            "server_now_ts": now_ms,
            "bo_clock": bo_meta,
            "rapid_clock": _session_payload(rapid_clock, now_ms=now_ms),
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
                "delayed_settlement": True,
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
    user = get_current_user(request, db)
    settle_due_bo_orders(db)
    now_ms = _server_now_ms()
    bo_clock = bo_session_clock()
    bo_meta = _session_payload(bo_clock, now_ms=now_ms)
    market = get_bo_market_snapshot()
    chart = get_bo_system_candles(db, asset_code=asset, interval=interval, limit=limit, market=market)
    recent_results = get_recent_bo_session_results(db, chart["asset"], 5, market)
    latest = chart["candles"][-1] if chart["candles"] else None
    current_result = None
    if now_ms >= int(bo_meta["current_session_close_ts"]):
        rows = [item for item in recent_results if item["session_code"] == bo_meta["session_code"]]
        current_result = _bo_result_payload(rows[0]) if rows else None
    marker_query = []
    if user:
        marker_query = (
            db.query(BoOrder)
            .filter(BoOrder.user_id == user.id, BoOrder.asset == chart["asset"])
            .order_by(BoOrder.created_at.desc())
            .limit(20)
            .all()
        )
    db.commit()
    return JSONResponse(
        {
            "server_now_ts": now_ms,
            "asset": chart["asset"],
            "symbol": chart["symbol"],
            "interval": chart["interval"],
            "interval_seconds": chart["interval_seconds"],
            "settlement_interval": "1m",
            "settlement_source": "BO System Chart",
            "tradingview_role": "reference_only",
            "delayed_settlement": True,
            "updated_at": chart["updated_at"].isoformat(),
            "latest": _bo_candle_payload(latest) if latest else None,
            "candles": [_bo_candle_payload(item) for item in chart["candles"]],
            "recent_results": [_bo_result_payload(item) for item in recent_results],
            "member_order_markers": [_bo_order_marker(order) for order in marker_query],
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
