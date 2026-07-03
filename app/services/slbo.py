from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN
import hashlib
import random
import secrets
import time

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    BoOrder,
    BoSide,
    EmailNotification,
    GameRequestStatus,
    InternalWallet,
    PlatformLedgerEntry,
    PlatformTreasuryAccount,
    PointLedgerEntry,
    PointTransfer,
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
    RapidPlayType.BAO_LO_2: RapidPlayConfig(RapidPlayType.BAO_LO_2, Decimal("27"), 27, exact_digits=2),
    RapidPlayType.BAO_LO_3: RapidPlayConfig(RapidPlayType.BAO_LO_3, Decimal("23"), 23, exact_digits=3),
    RapidPlayType.XIEN_2: RapidPlayConfig(RapidPlayType.XIEN_2, Decimal("15"), 1, requires_unique_count=2, exact_digits=2),
    RapidPlayType.XIEN_3: RapidPlayConfig(RapidPlayType.XIEN_3, Decimal("55"), 1, requires_unique_count=3, exact_digits=2),
    RapidPlayType.HEAD: RapidPlayConfig(RapidPlayType.HEAD, Decimal("4"), 1, exact_digits=1),
    RapidPlayType.TAIL: RapidPlayConfig(RapidPlayType.TAIL, Decimal("1"), 1, exact_digits=1),
    RapidPlayType.EVEN_ODD: RapidPlayConfig(RapidPlayType.EVEN_ODD, Decimal("1"), 1),
}


NORTHERN_RESULT_PRIZES: tuple[tuple[str, int, int], ...] = (
    ("special", 5, 1),
    ("g1", 5, 1),
    ("g2", 5, 2),
    ("g3", 5, 6),
    ("g4", 4, 4),
    ("g5", 4, 6),
    ("g6", 3, 3),
    ("g7", 2, 4),
)


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


def get_rapid_result_board(session_code: str | int | None = None) -> dict:
    code = str(session_code or rapid_session_clock()["session_code"])
    seed = int(hashlib.sha256(f"rapid-result:{code}".encode("utf-8")).hexdigest(), 16)
    rng = random.Random(seed)
    prizes: list[dict] = []
    all_numbers: list[str] = []
    three_digit_positions: list[str] = []
    for key, digits, count in NORTHERN_RESULT_PRIZES:
        numbers = [f"{rng.randrange(10 ** digits):0{digits}d}" for _ in range(count)]
        all_numbers.extend(numbers)
        if digits >= 3:
            three_digit_positions.extend(number[-3:] for number in numbers)
        prizes.append({"key": key, "digits": digits, "numbers": numbers})

    two_digit_positions = [number[-2:] for number in all_numbers]
    heads = {str(index): [] for index in range(10)}
    for value in two_digit_positions:
        heads[value[0]].append(value[1])
    special = prizes[0]["numbers"][0]
    return {
        "session_code": code,
        "special": special,
        "prizes": prizes,
        "two_digit_positions": two_digit_positions,
        "three_digit_positions": three_digit_positions,
        "heads": heads,
        "special_tail": special[-1],
    }


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
    return create_wallet_request(
        db,
        user=user,
        request_type=SandboxRequestType.DEPOSIT,
        amount=amount,
        member_note=note,
    )


def create_wallet_request(
    db: Session,
    *,
    user: User,
    request_type: SandboxRequestType,
    amount: Decimal,
    transfer_channel: str = "",
    account_name: str = "",
    account_identifier: str = "",
    member_note: str = "",
) -> SandboxTransaction:
    amount = _positive_amount(amount)
    if request_type == SandboxRequestType.WITHDRAW:
        wallet = ensure_wallet(db, user)
        if _money(wallet.available_balance) < amount:
            raise ValueError("insufficient_balance")
    prefix = "WD" if request_type == SandboxRequestType.WITHDRAW else "DP"
    item = SandboxTransaction(
        reference_code=_unique_code(db, SandboxTransaction, prefix),
        user_id=user.id,
        request_type=request_type,
        amount=amount,
        currency=_currency(None),
        transfer_channel=transfer_channel.strip()[:80],
        account_name=account_name.strip()[:120],
        account_identifier=account_identifier.strip()[:255],
        member_note=member_note.strip(),
    )
    db.add(item)
    _queue_wallet_ops_email(
        db,
        user=user,
        subject=f"Guilua wallet request {item.reference_code}",
        body=(
            f"Member: {user.email}\n"
            f"UID: {user.uid or user.id}\n"
            f"Type: {request_type.value}\n"
            f"Amount: {amount} {_currency(None)}\n"
            f"Channel: {item.transfer_channel or '-'}\n"
            f"Account: {item.account_name or '-'} / {item.account_identifier or '-'}\n"
            f"Note: {item.member_note or '-'}"
        ),
        event_type="wallet_request_created",
    )
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
        reason=note or "Approved internal point deposit",
        created_by=admin,
    )
    db.commit()
    db.refresh(item)
    return item


def approve_wallet_request(
    db: Session,
    *,
    item: SandboxTransaction,
    admin: User,
    note: str = "",
) -> SandboxTransaction:
    if item.status != SandboxRequestStatus.PENDING:
        raise ValueError("request_not_pending")
    user = item.user
    if not user:
        raise ValueError("invalid_member")
    amount = _positive_amount(item.amount)
    wallet = ensure_wallet(db, user, item.currency)
    item.status = SandboxRequestStatus.APPROVED
    item.admin_note = note.strip()
    item.reviewed_by_user_id = admin.id
    item.reviewed_at = datetime.now(timezone.utc)
    if item.request_type == SandboxRequestType.DEPOSIT:
        wallet.total_deposit = _money(wallet.total_deposit) + amount
        _credit_wallet(
            db,
            wallet=wallet,
            amount=amount,
            entry_type=WalletLedgerType.DEPOSIT_APPROVED,
            reference_type="wallet_request",
            reference_id=item.reference_code,
            reason=note or "Admin approved point deposit request",
            created_by=admin,
        )
    elif item.request_type == SandboxRequestType.WITHDRAW:
        wallet.total_withdraw = _money(wallet.total_withdraw) + amount
        _debit_wallet(
            db,
            wallet=wallet,
            amount=amount,
            entry_type=WalletLedgerType.WITHDRAW_APPROVED,
            reference_type="wallet_request",
            reference_id=item.reference_code,
            reason=note or "Admin approved point withdrawal request",
            created_by=admin,
        )
    else:
        raise ValueError("invalid_request_type")
    _queue_member_email(
        db,
        user=user,
        subject=f"Guilua request {item.reference_code} approved",
        body=f"Your {item.request_type.value} request for {amount} {item.currency} has been approved.",
        event_type="wallet_request_approved",
    )
    db.commit()
    db.refresh(item)
    return item


def reject_wallet_request(
    db: Session,
    *,
    item: SandboxTransaction,
    admin: User,
    note: str = "",
) -> SandboxTransaction:
    if item.status != SandboxRequestStatus.PENDING:
        raise ValueError("request_not_pending")
    item.status = SandboxRequestStatus.REJECTED
    item.admin_note = note.strip()
    item.reviewed_by_user_id = admin.id
    item.reviewed_at = datetime.now(timezone.utc)
    if item.user:
        _queue_member_email(
            db,
            user=item.user,
            subject=f"Guilua request {item.reference_code} updated",
            body=f"Your {item.request_type.value} request for {item.amount} {item.currency} was not approved. Note: {note or '-'}",
            event_type="wallet_request_rejected",
        )
    db.commit()
    db.refresh(item)
    return item


def transfer_points(
    db: Session,
    *,
    sender: User,
    recipient_identifier: str,
    amount: Decimal,
    memo: str = "",
) -> PointTransfer:
    amount = _positive_amount(amount)
    recipient = _find_member_for_transfer(db, recipient_identifier)
    if not recipient or recipient.id == sender.id or recipient.is_admin or not recipient.is_active:
        raise ValueError("invalid_recipient")
    sender_wallet = ensure_wallet(db, sender)
    receiver_wallet = ensure_wallet(db, recipient, sender_wallet.currency)
    reference_code = _unique_code(db, PointTransfer, "PT")
    _debit_wallet(
        db,
        wallet=sender_wallet,
        amount=amount,
        entry_type=WalletLedgerType.TRANSFER_OUT,
        reference_type="point_transfer",
        reference_id=reference_code,
        reason=f"Transfer to {recipient.uid or recipient.email}",
    )
    _credit_wallet(
        db,
        wallet=receiver_wallet,
        amount=amount,
        entry_type=WalletLedgerType.TRANSFER_IN,
        reference_type="point_transfer",
        reference_id=reference_code,
        reason=f"Transfer from {sender.uid or sender.email}",
    )
    transfer = PointTransfer(
        reference_code=reference_code,
        sender_user_id=sender.id,
        receiver_user_id=recipient.id,
        amount=amount,
        currency=sender_wallet.currency,
        memo=memo.strip(),
    )
    db.add(transfer)
    _queue_wallet_ops_email(
        db,
        user=sender,
        subject=f"Guilua point transfer {reference_code}",
        body=(
            f"Sender: {sender.email} ({sender.uid or sender.id})\n"
            f"Receiver: {recipient.email} ({recipient.uid or recipient.id})\n"
            f"Amount: {amount} {sender_wallet.currency}\n"
            f"Memo: {memo.strip() or '-'}"
        ),
        event_type="point_transfer_completed",
    )
    _queue_member_email(
        db,
        user=recipient,
        subject=f"Guilua point transfer received {reference_code}",
        body=f"You received {amount} {sender_wallet.currency} from {sender.uid or sender.email}.",
        event_type="point_transfer_received",
    )
    db.commit()
    db.refresh(transfer)
    return transfer


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
    if stake > Decimal("1000"):
        raise ValueError("stake_above_limit")
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
    board = get_rapid_result_board(str(clock["session_code"]))
    hit_count, result_code = _rapid_result(play_type, normalized_selection, board)
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
        if raw in {"even", "chan", "ch?n", "0"}:
            return "even"
        if raw in {"odd", "le", "l?", "1"}:
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
        note="Auto activity commission from accepted member request.",
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


def _rapid_result(play_type: RapidPlayType, selection: str, board: dict) -> tuple[int, str]:
    two_digit_positions = board["two_digit_positions"]
    three_digit_positions = board["three_digit_positions"]
    special_tail = board["special_tail"]
    result_code = str(board["special"])
    if play_type == RapidPlayType.BAO_LO_2:
        return two_digit_positions.count(selection), result_code
    if play_type == RapidPlayType.BAO_LO_3:
        return three_digit_positions.count(selection), result_code
    if play_type in {RapidPlayType.XIEN_2, RapidPlayType.XIEN_3}:
        picks = selection.split(",")
        return (1 if all(pick in two_digit_positions for pick in picks) else 0), result_code
    if play_type == RapidPlayType.HEAD:
        return (1 if board["heads"].get(selection) else 0), result_code
    if play_type == RapidPlayType.TAIL:
        return (1 if special_tail == selection else 0), result_code
    if play_type == RapidPlayType.EVEN_ODD:
        final_number = int(special_tail)
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


def _find_member_for_transfer(db: Session, raw_identifier: str) -> User | None:
    identifier = raw_identifier.strip()
    if not identifier:
        return None
    normalized_email = identifier.lower()
    return (
        db.query(User)
        .filter(
            (User.uid == identifier)
            | (User.referral_code == identifier)
            | (func.lower(User.email) == normalized_email)
        )
        .first()
    )


def _queue_wallet_ops_email(db: Session, *, user: User, subject: str, body: str, event_type: str) -> None:
    settings = get_settings()
    if not settings.admin_notification_email:
        return
    db.add(
        EmailNotification(
            recipient=settings.admin_notification_email,
            subject=subject,
            body=body,
            event_type=event_type,
            user_id=user.id,
        )
    )


def _queue_member_email(db: Session, *, user: User, subject: str, body: str, event_type: str) -> None:
    if not user.email:
        return
    db.add(
        EmailNotification(
            recipient=user.email,
            subject=subject,
            body=body,
            event_type=event_type,
            user_id=user.id,
        )
    )


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
