from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib

from sqlalchemy.orm import Session

from app.models import BoOrder, GameRequestStatus, RapidEntry, RapidPlayType, WalletLedgerType
from app.services import slbo as core
from app.services import slbo_settlement_guard as guard
from app.services.slbo_member_outcome_settings import effective_policy


def _target_success(ref: str, user_id: int, rate: Decimal) -> bool:
    threshold = int((max(Decimal('0'), min(Decimal('100'), Decimal(str(rate)))) * Decimal('100')).to_integral_value())
    seed = int(hashlib.sha256(f'member-policy:{ref}:{user_id}'.encode('utf-8')).hexdigest(), 16)
    return seed % 10000 < threshold


def _bo_result_price(entry_price: Decimal, side, succeeds: bool, ref: str) -> Decimal:
    buy_succeeds = succeeds if side.value == 'buy' else not succeeds
    return core._result_price(entry_price, buy_succeeds, ref)


def _rapid_success_result(entry: RapidEntry, board: dict) -> tuple[int, str]:
    result_code = str(board.get('special') or '')
    if entry.play_type in {RapidPlayType.BAO_LO_2, RapidPlayType.BAO_LO_3, RapidPlayType.XIEN_2, RapidPlayType.XIEN_3, RapidPlayType.HEAD, RapidPlayType.TAIL, RapidPlayType.EVEN_ODD}:
        return 1, result_code
    return 0, result_code


def settle_bo_order(db: Session, order: BoOrder, market: dict | None = None) -> None:
    if order.status != GameRequestStatus.ACCEPTED or order.settled_at is not None:
        return
    treasury = core.ensure_treasury(db)
    wallet = core.ensure_wallet(db, order.user)
    result = guard.ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT(db, order.session_code, order.asset, market)
    policy = effective_policy(db, user=order.user, wallet=wallet)
    succeeds = _target_success(order.reference_code, order.user_id, policy['member_target_success_rate'])
    payout = (core._money(order.stake_amount) * core._money(order.payout_ratio)).quantize(Decimal('0.0001'))
    entry_price = core._money(order.entry_price or result['entry_price'], places=8)
    order.entry_price = entry_price
    order.result_price = _bo_result_price(entry_price, order.side, succeeds, order.reference_code)
    order.settled_at = datetime.now(timezone.utc)
    order.result_note = f"member_policy:{policy['base_member_target_success_rate']};guard:{policy['guard_active']};profit:{policy['current_profit_percent']}"
    if succeeds:
        try:
            core._debit_treasury(db, treasury, payout, 'bo_payout', 'bo_order', order.reference_code, 'BO sandbox payout')
        except ValueError:
            order.status = GameRequestStatus.REFUNDED
            order.profit_amount = Decimal('0')
            core._debit_treasury(db, treasury, core._money(order.stake_amount), 'bo_refund', 'bo_order', order.reference_code, 'BO stake refund')
            core._credit_wallet(db, wallet=wallet, amount=core._money(order.stake_amount), entry_type=WalletLedgerType.BO_PAYOUT, reference_type='bo_order', reference_id=order.reference_code, reason='BO stake refunded by session condition')
            return
        order.status = GameRequestStatus.WON
        order.profit_amount = (payout - core._money(order.stake_amount)).quantize(Decimal('0.0001'))
        wallet.total_profit = core._money(wallet.total_profit) + order.profit_amount
        core._credit_wallet(db, wallet=wallet, amount=payout, entry_type=WalletLedgerType.BO_PAYOUT, reference_type='bo_order', reference_id=order.reference_code, reason='BO sandbox payout')
    else:
        order.status = GameRequestStatus.LOST
        order.profit_amount = -core._money(order.stake_amount)
        wallet.total_loss = core._money(wallet.total_loss) + core._money(order.stake_amount)
        core.maybe_create_loss_deposit_commissions(db, order.user)


def settle_rapid_entry(db: Session, entry: RapidEntry) -> None:
    if entry.status != GameRequestStatus.ACCEPTED or entry.settled_at is not None:
        return
    treasury = core.ensure_treasury(db)
    wallet = core.ensure_wallet(db, entry.user)
    board = guard.ORIGINAL_GET_OR_CREATE_RAPID_RESULT_BOARD(db, entry.session_code)
    policy = effective_policy(db, user=entry.user, wallet=wallet)
    succeeds = _target_success(entry.reference_code, entry.user_id, policy['member_target_success_rate'])
    actual_hit_count, result_code = guard._rapid_result(entry.play_type, entry.selection, board)
    hit_count = actual_hit_count
    if succeeds and hit_count <= 0:
        hit_count, result_code = _rapid_success_result(entry, board)
    if not succeeds:
        hit_count = 0
    payout = (core._money(entry.stake_amount) * core._money(entry.payout_ratio) * Decimal(hit_count)).quantize(Decimal('0.0001'))
    entry.hit_count = hit_count
    entry.result_code = result_code
    entry.settled_at = datetime.now(timezone.utc)
    if hit_count > 0:
        try:
            core._debit_treasury(db, treasury, payout, 'rapid_payout', 'rapid_entry', entry.reference_code, 'Rapid sandbox payout')
        except ValueError:
            entry.status = GameRequestStatus.REFUNDED
            entry.result_amount = Decimal('0')
            core._debit_treasury(db, treasury, core._money(entry.stake_amount), 'rapid_refund', 'rapid_entry', entry.reference_code, 'Rapid stake refund')
            core._credit_wallet(db, wallet=wallet, amount=core._money(entry.stake_amount), entry_type=WalletLedgerType.RAPID_PAYOUT, reference_type='rapid_entry', reference_id=entry.reference_code, reason='Rapid stake refunded by session condition')
            return
        entry.status = GameRequestStatus.WON
        entry.result_amount = payout
        wallet.total_profit = core._money(wallet.total_profit) + (payout - core._money(entry.stake_amount))
        core._credit_wallet(db, wallet=wallet, amount=payout, entry_type=WalletLedgerType.RAPID_PAYOUT, reference_type='rapid_entry', reference_id=entry.reference_code, reason='Rapid sandbox payout')
    else:
        entry.status = GameRequestStatus.LOST
        entry.result_amount = Decimal('0')
        wallet.total_loss = core._money(wallet.total_loss) + core._money(entry.stake_amount)
        core.maybe_create_loss_deposit_commissions(db, entry.user)


guard._settle_bo_order = settle_bo_order
guard._settle_rapid_entry = settle_rapid_entry
