from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import PointTransfer, User, WalletLedgerType
from app.services import slbo as core


def transfer_points(
    db: Session,
    *,
    sender: User,
    recipient_identifier: str,
    amount: Decimal,
    memo: str = "",
) -> PointTransfer:
    amount = core._positive_amount(amount)
    recipient = core._find_member_for_transfer(db, recipient_identifier)
    if not recipient or recipient.id == sender.id or recipient.is_admin or not recipient.is_active:
        raise ValueError("invalid_recipient")

    sender_wallet = core.ensure_wallet(db, sender)
    receiver_wallet = core.ensure_wallet(db, recipient, sender_wallet.currency)
    if core._money(sender_wallet.available_balance) < amount:
        raise ValueError("insufficient_balance")

    now = datetime.now(timezone.utc)
    reference_code = core._unique_code(db, PointTransfer, "PT")
    transfer = PointTransfer(
        reference_code=reference_code,
        sender_user_id=sender.id,
        receiver_user_id=recipient.id,
        amount=amount,
        currency=sender_wallet.currency,
        memo=memo.strip(),
        status="completed",
        sender_confirmed_at=now,
        receiver_confirmed_at=now,
        completed_at=now,
    )
    db.add(transfer)
    db.flush()

    core._debit_wallet(
        db,
        wallet=sender_wallet,
        amount=amount,
        entry_type=WalletLedgerType.TRANSFER_OUT,
        reference_type="point_transfer",
        reference_id=reference_code,
        reason=f"Direct transfer to {recipient.uid or recipient.email}",
    )
    core._credit_wallet(
        db,
        wallet=receiver_wallet,
        amount=amount,
        entry_type=WalletLedgerType.TRANSFER_IN,
        reference_type="point_transfer",
        reference_id=reference_code,
        reason=f"Direct transfer from {sender.uid or sender.email}",
    )

    core._queue_wallet_ops_email(
        db,
        user=sender,
        subject=f"Guilua point transfer completed {reference_code}",
        body=(
            f"Sender: {sender.email} ({sender.uid or sender.id})\n"
            f"Receiver: {recipient.email} ({recipient.uid or recipient.id})\n"
            f"Amount: {amount} {sender_wallet.currency}\n"
            f"Memo: {memo.strip() or '-'}\n"
            "Status: completed"
        ),
        event_type="point_transfer_completed",
    )
    core._queue_member_email(
        db,
        user=sender,
        subject=f"Guilua point transfer completed {reference_code}",
        body=f"Your transfer of {amount} {sender_wallet.currency} to {recipient.uid or recipient.email} was completed.",
        event_type="point_transfer_completed_sender",
    )
    core._queue_member_email(
        db,
        user=recipient,
        subject=f"Guilua point transfer received {reference_code}",
        body=f"You received {amount} {sender_wallet.currency} from {sender.uid or sender.email}. Memo: {memo.strip() or '-'}",
        event_type="point_transfer_completed_receiver",
    )

    db.commit()
    db.refresh(transfer)
    return transfer
