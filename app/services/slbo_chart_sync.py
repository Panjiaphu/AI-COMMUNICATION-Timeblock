from __future__ import annotations

from decimal import Decimal

from app.services import slbo as core


_ORIGINAL_GET_BO_SYSTEM_CANDLES = core.get_bo_system_candles


def _market_latest(asset_code: str, market: dict | None) -> Decimal | None:
    asset = asset_code.strip().upper()
    for item in (market or {}).get("assets", []):
        if item.get("code") == asset:
            try:
                price = Decimal(str(item.get("price") or 0))
            except Exception:  # noqa: BLE001
                return None
            return price if price > 0 else None
    return None


def get_bo_system_candles(db, *, asset_code="BTC", interval="1S", limit=120, market=None):
    market = market or core.get_bo_market_snapshot()
    chart = _ORIGINAL_GET_BO_SYSTEM_CANDLES(
        db,
        asset_code=asset_code,
        interval=interval,
        limit=limit,
        market=market,
    )
    latest_price = _market_latest(chart.get("asset") or asset_code, market)
    candles = chart.get("candles") or []
    if not latest_price or not candles:
        return chart
    latest = candles[-1]
    previous_close = Decimal(str(candles[-2]["close"] if len(candles) > 1 else latest.get("open") or latest_price))
    open_price = previous_close
    close_price = latest_price
    wiggle = max(latest_price * Decimal("0.00035"), Decimal("0.0001"))
    latest["open"] = core._money(open_price, places=8)
    latest["close"] = core._money(close_price, places=8)
    latest["high"] = core._money(max(open_price, close_price) + wiggle, places=8)
    latest["low"] = core._money(min(open_price, close_price) - wiggle, places=8)
    chart["latest_price"] = core._money(latest_price, places=8)
    return chart


core.get_bo_system_candles = get_bo_system_candles
