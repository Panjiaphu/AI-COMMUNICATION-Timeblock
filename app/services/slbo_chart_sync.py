from __future__ import annotations

from decimal import Decimal
import random
import time

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


def _bounded_market_candles(*, asset: str, latest_price: Decimal, interval_seconds: int, limit: int) -> list[dict]:
    """Build a smooth reference chart around the current market price.

    The BO result engine can still use canonical session results, but the visual
    system chart must not drift hundreds of points away from the asset card.
    This keeps all displayed prices in the same range as the market snapshot.
    """

    now = int(time.time())
    end_ts = now - (now % max(1, interval_seconds))
    start_ts = end_ts - (limit - 1) * interval_seconds
    rng = random.Random(f"bo-chart-display:{asset}:{end_ts // max(1, interval_seconds)}")
    closes: list[Decimal] = []
    price = latest_price
    for _ in range(limit):
        step = Decimal(str(rng.uniform(-0.000006, 0.000006)))
        price = price * (Decimal("1") + step)
        closes.append(price)
    if closes and closes[-1] > 0:
        ratio = latest_price / closes[-1]
        closes = [value * ratio for value in closes]
    candles: list[dict] = []
    previous = closes[0] if closes else latest_price
    for index, close in enumerate(closes):
        open_price = previous if index else close * (Decimal("1") + Decimal(str(rng.uniform(-0.000004, 0.000004))))
        wick = max(latest_price * Decimal("0.00008"), Decimal("0.0001"))
        high = max(open_price, close) + wick
        low = min(open_price, close) - wick
        candles.append(
            {
                "time": start_ts + index * interval_seconds,
                "open": core._money(open_price, places=8),
                "high": core._money(high, places=8),
                "low": core._money(low, places=8),
                "close": core._money(close, places=8),
            }
        )
        previous = close
    if candles:
        latest = candles[-1]
        latest["close"] = core._money(latest_price, places=8)
        latest["high"] = core._money(max(Decimal(str(latest["open"])), latest_price) + max(latest_price * Decimal("0.00005"), Decimal("0.0001")), places=8)
        latest["low"] = core._money(min(Decimal(str(latest["open"])), latest_price) - max(latest_price * Decimal("0.00005"), Decimal("0.0001")), places=8)
    return candles


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
    if not latest_price:
        return chart
    interval_seconds = int(chart.get("interval_seconds") or 1)
    chart_limit = max(20, min(int(limit or 120), 260))
    chart["candles"] = _bounded_market_candles(
        asset=str(chart.get("asset") or asset_code),
        latest_price=latest_price,
        interval_seconds=interval_seconds,
        limit=chart_limit,
    )
    chart["latest_price"] = core._money(latest_price, places=8)
    return chart


core.get_bo_system_candles = get_bo_system_candles
