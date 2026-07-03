from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN
import hashlib
import secrets
import time

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    BoOrder,
    BoSide,
    GameRequestStatus,
    InternalWallet,
    PlatformLedgerEntry,
    PlatformTreasuryAccount,
    PointLedgerEntry,
    RapidEntry,
    RapidPlayType,
    ReferralCommission,
    ReferralCommissionStatus,
    ReferralCommissionType,
    SandboxRequestStatus,
    SandboxRequestType,
    SandboxTransaction,
    User,
    WalletLedgerType,
)
from app.services.crypto_market import get_crypto_market_snapshot
from app.services.referrals import create_referral_commissions


CURRENCY = "SLB_POINT"


@dataclass(frozen=True)
class BoAsset:
    code: str
    label: str
    tradingview_symbol: str
    fallback_price: Decimal
    source: str


@dataclass(frozen=True)
class RapidPlayConfig:
    play_type: RapidPlayType
    payout_ratio: Decimal
    max_hit_count: int
    requires_unique_count: int | None = None
    exact_digits: int | None = None


BO_ASSETS: tuple[BoAsset, ...] = (
    BoAsset("BTC", "BTC", "BINANCE:BTCUSDT", Decimal("65000"), "Binance + CoinGecko"),
    BoAsset("ETH", "ETH", "BINANCE:ETHUSDT", Decimal("3200"), "Binance + CoinGecko"),
    BoAsset("GOLD", "Gold", "OANDA:XAUUSD", Decimal("2350"), "TradingView reference"),
    BoAsset("OIL", "Oil", "TVC:USOIL", Decimal("78"), "TradingView reference"),
)


RAPID_PLAY_CONFIGS: dict[RapidPlayType, RapidPlayConfig] = {
    RapidPlayType.BAO_LO_2: RapidPlayConfig(RapidPlayType.BAO_LO_2, Decimal("90"), 5, exact_digits=2),
    RapidPlayType.BAO_LO_3: RapidPlayConfig(RapidPlayType.BAO_LO_3, Decimal("850"), 3, exact_digits=3),
    RapidPlayType.XIEN_2: RapidPlayConfig(RapidPlayType.XIEN_2, Decimal("15"), 1, requires_unique_count=2, exact_digits=2),
    RapidPlayType.XIEN_3: RapidPlayConfig(RapidPlayType.XIEN_3, Decimal("55"), 1, requires_unique_count=3, exact_digits=2),
    RapidPlayType.HEAD: RapidPlayConfig(RapidPlayType.HEAD, Decimal("90"), 5, exact_digits=2),
    RapidPlayType.TAIL: RapidPlayConfig(RapidPlayType.TAIL, Decimal("90"), 1, exact_digits=2),
    RapidPlayType.EVEN_ODD: RapidPlayConfig(RapidPlayType.EVEN_ODD, Decimal("1.95"), 1),
}


def sandbox_flags() -> dict[str, bool | str]:
    settings = get_settings()
    return {
        "app_mode": settings.app_mode,
        "real_money_enabled": settings.real_money_enabled,
        "real_crypto_withdraw_enabled": settings.real_crypto_withdraw_enabled,
        "live_settlement_enabled": settings.live_settlement_enabled,
    }


def session_clock(total_seconds: int, open_seconds: int) -> dict[str, int | str]:
    now = int(time.time())
    session_index = now // total_seconds
    elapsed = now % total_seconds
    state = "open" if elapsed < open_seconds else "processing"
    remaining = (open_seconds - elapsed) if state == "open" else (total_seconds - elapsed)
    return {
        "session_code": f"S{session_index}",
        "state": state,
        "elapsed": elapsed,
        "remaining": max(0, remaining),
        "total_seconds": total_seconds,
        "open_seconds": open_seconds,
    }


def bo_session_clock() -> dict[str, int | str]:
    settings = get_settings()
    return session_clock(settings.bo_trade_open_seconds + settings.bo_result_wait_seconds, settings.bo_trade_open_seconds)


def rapid_session_clock() -> dict[str, int | str]:
    settings = get_settings()
    return session_clock(settings.rapid_session_seconds, settings.rapid_entry_open_seconds)


def get_bo_market_snapshot() -> dict:
    crypto = get_crypto_market_snapshot()
    coin_map = crypto.get("coin_map", {})
    assets = []
    for asset in BO_ASSETS:
        row = coin_map.get(asset.code)
        price = Decimal(str(row.get("price"))) if row and row.get("price") else asset.fallback_price
        change = Decimal(str(row.get("change_24h") or 0)) if row else Decimal("0")
        assets.append(
            {
                "code": asset.code,
                "label": asset.label,
                "price": price,
                "change_24h": change,
                "tradingview_symbol": asset.tradingview_symbol,
                "source": row.get("source") if row else asset.source,
            }
        )
    return {
        "assets": assets,
        "updated_at": datetime.now(timezone.utc),
        "source_status": crypto.get("source_status", {}),
    }


def ensure_wallet(db: Session, user: User, currency: str | None = None) -> InternalWallet:
    code = _currency(currency)
    wallet = (
        db.query(InternalWallet)
        .filter(InternalWallet.user_id == user.id, InternalWallet.currency == code)
        .first()
    )
    if wallet:
        return wallet
    wallet = InternalWallet(user_id=user.id, currency=code)
    db.add(wallet)
    db.flush()
    return wallet


def ensure_treasury(db: Session, currency: str | None = None) -> PlatformTreasuryAccount:
    settings = get_settings()
    code = _currency(currency)
    treasury = db.query(PlatformTreasuryAccount).filter(PlatformTreasuryAccount.currency == code).first()
    if treasury:
        return treasury
    treasury = PlatformTreasuryAccount(
        currency=code,
        available_balance=_money(settings.platform_treasury_initial_balance),
        reserve_floor=_money(settings.platform_treasury_reserve_floor),
    )
    db.add(treasury)
    db.flush()
    return treasury


def create_deposit_request(db: Session, user: User, amount: Decimal, note: str = "") -> SandboxTransaction:
    amount = _positive_amount(amount)
    item = SandboxTransaction(
        reference_code=_unique_code(db, SandboxTransaction, "SD"),
        user_id=user.id,
        request_type=SandboxRequestType.DEPOSIT,
        amount=amount,
        currency=_currency(None),
        member_note=note.strip(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def approve_deposit(
    db: Session,
    *,
    user: User,
    amount: Decimal,
    admin: User | None = None,
    note: str = "",
) -> SandboxTransaction:
    amount = _positive_amount(amount)
    item = SandboxTransaction(
        reference_code=_unique_code(db, SandboxTransaction, "SD"),
        user_id=user.id,
        request_type=SandboxRequestType.DEPOSIT,
        status=SandboxRequestStatus.APPROVED,
        amount=amount,
        currency=_currency(None),
        admin_note=note.strip(),
        reviewed_by_user_id=admin.id if admin else None,
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add(item)
    wallet = ensure_wallet(db, user, item.currency)
    wallet.total_deposit = _money(wallet.total_deposit) + amount
    _credit_wallet(
        db,
        wallet=wallet,
        amount=amount,
        entry_type=WalletLedgerType.DEPOSIT_APPROVED,
        reference_type="sandbox_deposit",
        reference_id=item.reference_code,
        reason=note or "Approved sandbox point deposit",
        created_by=admin,
    )
    db.commit()
    db.refresh(item)
    return item


def place_bo_order(
    db: Session,
    *,
    user: User,
    asset_code: str,
    side: BoSide,
    stake_amount: Decimal,
) -> BoOrder:
    _assert_sandbox()
    stake = _positive_amount(stake_amount)
    asset_code = asset_code.strip().upper()
    asset = next((item for item in get_bo_market_snapshot()["assets"] if item["code"] == asset_code), None)
    if not asset:
        raise ValueError("invalid_asset")
    wallet = ensure_wallet(db, user)
    treasury = ensure_treasury(db)
    if _money(wallet.available_balance) < stake:
        raise ValueError("insufficient_balance")

    clock = bo_session_clock()
    if clock["state"] != "open":
        raise ValueError("session_not_open")

    reference_code = _unique_code(db, BoOrder, "BO")
    entry_price = _money(asset["price"], places=8)
    won = _deterministic_win(reference_code, user.id, threshold=48)
    if side == BoSide.SELL:
        won = not won
    result_price = _result_price(entry_price, won if side == BoSide.BUY else not won, reference_code)
    payout_ratio = _money(get_settings().bo_payout_ratio)
    payout = (stake * payout_ratio).quantize(Decimal("0.0001"))
    treasury_after_win = _money(treasury.available_balance) + stake - payout
    if won and treasury_after_win < _money(treasury.reserve_floor):
        raise ValueError("treasury_guard")

    _debit_wallet(
        db,
        wallet=wallet,
        amount=stake,
        entry_type=WalletLedgerType.BO_STAKE,
        reference_type="bo_order",
        reference_id=reference_code,
        reason="BO accepted stake",
    )
    _credit_treasury(db, treasury, stake, "bo_stake", "bo_order", reference_code, "BO stake accepted")

    order = BoOrder(
        reference_code=reference_code,
        user_id=user.id,
        session_code=str(clock["session_code"]),
        asset=asset_code,
        side=side,
        stake_amount=stake,
        payout_ratio=payout_ratio,
        entry_price=entry_price,
        result_price=result_price,
        status=GameRequestStatus.WON if won else GameRequestStatus.LOST,
        profit_amount=(payout - stake if won else -stake).quantize(Decimal("0.0001")),
        result_note="sandbox_settlement",
        settled_at=datetime.now(timezone.utc),
    )
    db.add(order)

    if won:
        wallet.total_profit = _money(wallet.total_profit) + (payout - stake)
        _credit_wallet(
            db,
            wallet=wallet,
            amount=payout,
            entry_type=WalletLedgerType.BO_PAYOUT,
            reference_type="bo_order",
            reference_id=reference_code,
            reason="BO sandbox payout",
        )
        _debit_treasury(db, treasury, payout, "bo_payout", "bo_order", reference_code, "BO sandbox payout")
    else:
        wallet.total_loss = _money(wallet.total_loss) + stake

    db.flush()
    _create_activity_commissions(db, user, stake, "bo_order", reference_code)
    if not won:
        maybe_create_loss_deposit_commissions(db, user)
    db.commit()
    db.refresh(order)
    return order


def place_rapid_entry(
    db: Session,
    *,
    user: User,
    play_type: RapidPlayType,
    selection: str,
    stake_amount: Decimal,
) -> RapidEntry:
    _assert_sandbox()
    stake = _positive_amount(stake_amount)
    config = RAPID_PLAY_CONFIGS[play_type]
    normalized_selection = normalize_rapid_selection(play_type, selection)
    wallet = ensure_wallet(db, user)
    treasury = ensure_treasury(db)
    if _money(wallet.available_balance) < stake:
        raise ValueError("insufficient_balance")
    clock = rapid_session_clock()
    if clock["state"] != "open":
        raise ValueError("session_not_open")

    reference_code = _unique_code(db, RapidEntry, "NR")
    hit_count, result_code = _rapid_result(play_type, normalized_selection, reference_code, user.id)
    payout = (stake * config.payout_ratio * Decimal(hit_count)).quantize(Decimal("0.0001"))
    won = hit_count > 0
    treasury_after_win = _money(treasury.available_balance) + stake - payout
    if won and treasury_after_win < _money(treasury.reserve_floor):
        raise ValueError("treasury_guard")

    _debit_wallet(
        db,
        wallet=wallet,
        amount=stake,
        entry_type=WalletLedgerType.RAPID_STAKE,
        reference_type="rapid_entry",
        reference_id=reference_code,
        reason="Rapid accepted stake",
    )
    _credit_treasury(db, treasury, stake, "rapid_stake", "rapid_entry", reference_code, "Rapid stake accepted")

    entry = RapidEntry(
        reference_code=reference_code,
        user_id=user.id,
        session_code=str(clock["session_code"]),
        play_type=play_type,
        selection=normalized_selection,
        stake_amount=stake,
        payout_ratio=config.payout_ratio,
        hit_count=hit_count,
        result_code=result_code,
        status=GameRequestStatus.WON if won else GameRequestStatus.LOST,
        result_amount=payout if won else Decimal("0"),
        settled_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    if won:
        wallet.total_profit = _money(wallet.total_profit) + (payout - stake)
        _credit_wallet(
            db,
            wallet=wallet,
            amount=payout,
            entry_type=WalletLedgerType.RAPID_PAYOUT,
            reference_type="rapid_entry",
            reference_id=reference_code,
            reason="Rapid sandbox payout",
        )
        _debit_treasury(db, treasury, payout, "rapid_payout", "rapid_entry", reference_code, "Rapid sandbox payout")
    else:
        wallet.total_loss = _money(wallet.total_loss) + stake

    db.flush()
    _create_activity_commissions(db, user, stake, "rapid_entry", reference_code)
    if not won:
        maybe_create_loss_deposit_commissions(db, user)
    db.commit()
    db.refresh(entry)
    return entry


def normalize_rapid_selection(play_type: RapidPlayType, selection: str) -> str:
    raw = selection.strip().lower().replace(" ", "")
    config = RAPID_PLAY_CONFIGS[play_type]
    if play_type == RapidPlayType.EVEN_ODD:
        if raw in {"even", "chan", "chẵn", "0"}:
            return "even"
        if raw in {"odd", "le", "lẻ", "1"}:
            return "odd"
        raise ValueError("invalid_selection")
    parts = [part for part in raw.replace("-", ",").replace(";", ",").split(",") if part]
    if config.requires_unique_count:
        if len(parts) != config.requires_unique_count or len(set(parts)) != len(parts):
            raise ValueError("invalid_selection")
    elif len(parts) != 1:
        raise ValueError("invalid_selection")
    for part in parts:
        if not part.isdigit() or (config.exact_digits and len(part) != config.exact_digits):
            raise ValueError("invalid_selection")
    return ",".join(parts)


def maybe_create_loss_deposit_commissions(db: Session, source_user: User) -> list[ReferralCommission]:
    wallet = ensure_wallet(db, source_user)
    total_deposit = _money(wallet.total_deposit)
    total_loss = _money(wallet.total_loss)
    if total_deposit <= 0 or total_loss < total_deposit:
        return []
    already_commissioned = (
        db.query(func.coalesce(func.sum(ReferralCommission.base_amount), 0))
        .filter(
            ReferralCommission.source_user_id == source_user.id,
            ReferralCommission.commission_type == ReferralCommissionType.LOSS_DEPOSIT,
            ReferralCommission.reference_type == "wallet_loss_depleted",
        )
        .scalar()
    )
    delta = (total_deposit - _money(already_commissioned)).quantize(Decimal("0.0001"))
    if delta <= 0:
        return []
    reference_id = f"user:{source_user.id}:deposit:{total_deposit}".replace(".", "_")[:64]
    return create_referral_commissions(
        db,
        source_user=source_user,
        commission_type=ReferralCommissionType.LOSS_DEPOSIT,
        base_amount=delta,
        currency=_currency(None),
        reference_type="wallet_loss_depleted",
        reference_id=reference_id,
        note="Auto commission only after downline realized loss reaches approved deposits.",
        status=ReferralCommissionStatus.PENDING,
    )


def record_member_loss(
    db: Session,
    *,
    user: User,
    amount: Decimal,
    reference_type: str = "loss_accounting",
    reference_id: str = "",
) -> list[ReferralCommission]:
    loss = _positive_amount(amount)
    wallet = ensure_wallet(db, user)
    wallet.total_loss = _money(wallet.total_loss) + loss
    _debit_wallet(
        db,
        wallet=wallet,
        amount=loss if _money(wallet.available_balance) >= loss else _money(wallet.available_balance),
        entry_type=WalletLedgerType.ADJUSTMENT,
        reference_type=reference_type,
        reference_id=reference_id,
        reason="Recorded realized sandbox loss",
    )
    db.flush()
    created = maybe_create_loss_deposit_commissions(db, user)
    db.commit()
    return created


def _create_activity_commissions(
    db: Session,
    source_user: User,
    base_amount: Decimal,
    reference_type: str,
    reference_id: str,
) -> list[ReferralCommission]:
    return create_referral_commissions(
        db,
        source_user=source_user,
        commission_type=ReferralCommissionType.ACTIVITY,
        base_amount=base_amount,
        currency=_currency(None),
        reference_type=reference_type,
        reference_id=reference_id,
        note="Auto sandbox activity commission from accepted member request.",
        status=ReferralCommissionStatus.PENDING,
    )


def _credit_wallet(
    db: Session,
    *,
    wallet: InternalWallet,
    amount: Decimal,
    entry_type: WalletLedgerType,
    reference_type: str,
    reference_id: str,
    reason: str,
    created_by: User | None = None,
) -> None:
    before = _money(wallet.available_balance)
    after = before + amount
    wallet.available_balance = after
    db.add(
        PointLedgerEntry(
            user_id=wallet.user_id,
            wallet_id=wallet.id,
            entry_type=entry_type,
            amount=amount,
            balance_before=before,
            balance_after=after,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
            created_by_user_id=created_by.id if created_by else None,
        )
    )


def _debit_wallet(
    db: Session,
    *,
    wallet: InternalWallet,
    amount: Decimal,
    entry_type: WalletLedgerType,
    reference_type: str,
    reference_id: str,
    reason: str,
    created_by: User | None = None,
) -> None:
    before = _money(wallet.available_balance)
    if before < amount:
        raise ValueError("insufficient_balance")
    after = before - amount
    wallet.available_balance = after
    db.add(
        PointLedgerEntry(
            user_id=wallet.user_id,
            wallet_id=wallet.id,
            entry_type=entry_type,
            amount=-amount,
            balance_before=before,
            balance_after=after,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
            created_by_user_id=created_by.id if created_by else None,
        )
    )


def _credit_treasury(
    db: Session,
    treasury: PlatformTreasuryAccount,
    amount: Decimal,
    entry_type: str,
    reference_type: str,
    reference_id: str,
    reason: str,
) -> None:
    before = _money(treasury.available_balance)
    after = before + amount
    treasury.available_balance = after
    treasury.total_platform_profit = _money(treasury.total_platform_profit) + amount
    db.add(
        PlatformLedgerEntry(
            treasury_id=treasury.id,
            entry_type=entry_type,
            amount=amount,
            balance_before=before,
            balance_after=after,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
        )
    )


def _debit_treasury(
    db: Session,
    treasury: PlatformTreasuryAccount,
    amount: Decimal,
    entry_type: str,
    reference_type: str,
    reference_id: str,
    reason: str,
) -> None:
    before = _money(treasury.available_balance)
    after = before - amount
    if after < _money(treasury.reserve_floor):
        raise ValueError("treasury_guard")
    treasury.available_balance = after
    treasury.total_platform_loss = _money(treasury.total_platform_loss) + amount
    db.add(
        PlatformLedgerEntry(
            treasury_id=treasury.id,
            entry_type=entry_type,
            amount=-amount,
            balance_before=before,
            balance_after=after,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
        )
    )


def _rapid_result(play_type: RapidPlayType, selection: str, reference_code: str, user_id: int) -> tuple[int, str]:
    seed = int(hashlib.sha256(f"{reference_code}:{user_id}:{selection}".encode("utf-8")).hexdigest(), 16)
    two_digit_positions = [f"{(seed >> shift) % 100:02d}" for shift in (0, 8, 16, 24, 32)]
    three_digit_positions = [f"{(seed >> shift) % 1000:03d}" for shift in (0, 12, 24)]
    tail = two_digit_positions[-1]
    result_code = "-".join(two_digit_positions)
    if play_type == RapidPlayType.BAO_LO_2:
        return two_digit_positions.count(selection), result_code
    if play_type == RapidPlayType.BAO_LO_3:
        return three_digit_positions.count(selection), ",".join(three_digit_positions)
    if play_type in {RapidPlayType.XIEN_2, RapidPlayType.XIEN_3}:
        picks = selection.split(",")
        return (1 if all(pick in two_digit_positions for pick in picks) else 0), result_code
    if play_type == RapidPlayType.HEAD:
        return two_digit_positions[:-1].count(selection), result_code
    if play_type == RapidPlayType.TAIL:
        return (1 if tail == selection else 0), result_code
    if play_type == RapidPlayType.EVEN_ODD:
        final_number = int(tail)
        side = "even" if final_number % 2 == 0 else "odd"
        return (1 if side == selection else 0), result_code
    return 0, result_code


def _result_price(entry_price: Decimal, buy_wins: bool, reference_code: str) -> Decimal:
    seed = int(hashlib.sha256(reference_code.encode("utf-8")).hexdigest(), 16)
    basis_points = Decimal(5 + seed % 24) / Decimal("10000")
    direction = Decimal("1") if buy_wins else Decimal("-1")
    return _money(entry_price * (Decimal("1") + direction * basis_points), places=8)


def _deterministic_win(reference_code: str, user_id: int, threshold: int) -> bool:
    seed = int(hashlib.sha256(f"{reference_code}:{user_id}".encode("utf-8")).hexdigest(), 16)
    return seed % 100 < threshold


def _assert_sandbox() -> None:
    settings = get_settings()
    if settings.app_mode.lower() != "sandbox" or settings.real_money_enabled or settings.live_settlement_enabled:
        raise ValueError("sandbox_only")


def _positive_amount(value: Decimal | str | float | int) -> Decimal:
    try:
        amount = _money(value)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_amount") from exc
    if amount <= 0:
        raise ValueError("invalid_amount")
    return amount


def _money(value, places: int = 4) -> Decimal:
    quant = Decimal("1").scaleb(-places)
    return Decimal(str(value or "0")).quantize(quant, rounding=ROUND_DOWN)


def _currency(value: str | None) -> str:
    return (value or get_settings().slbo_point_currency or CURRENCY).strip().upper()[:16]


def _unique_code(db: Session, model, prefix: str) -> str:
    for _ in range(30):
        code = f"{prefix}{secrets.token_hex(5).upper()}"
        if not db.query(model).filter(model.reference_code == code).first():
            return code
    raise RuntimeError("Could not generate unique reference code")
