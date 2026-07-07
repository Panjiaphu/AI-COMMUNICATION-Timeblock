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
    """Directly transfer SLB_POINT from one member to another.

    The wallet movement is committed before optional email notifications. This
    prevents EmailNotification schema/provider problems from rolling back a
    valid member-to-member transfer and surfacing as a 500 on mobile browsers.
    """

    amount = core._positive_amount(amount)
    recipient = core._find_member_for_transfer(db, recipient_identifier)
    if not recipient or recipient.id == sender.id or recipient.is_admin or not recipient.is_active:
        raise ValueError("invalid_recipient")

    sender_wallet = core.ensure_wallet(db, sender)
    receiver_wallet = core.ensure_wallet(db, recipient, sender_wallet.currency)
    if core._money(sender_wallet.available_balance) < amount:
        raise ValueError("insufficient_balance")

    sender_label = sender.uid or sender.email or str(sender.id)
    recipient_label = recipient.uid or recipient.email or str(recipient.id)
    sender_email = sender.email or ""
    recipient_email = recipient.email or ""
    currency = sender_wallet.currency
    clean_memo = memo.strip()[:500]

    now = datetime.now(timezone.utc)
    reference_code = core._unique_code(db, PointTransfer, "PT")
    transfer = PointTransfer(
        reference_code=reference_code,
        sender_user_id=sender.id,
        receiver_user_id=recipient.id,
        amount=amount,
        currency=currency,
        memo=clean_memo,
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
        reason=f"Direct transfer to {recipient_label}",
    )
    core._credit_wallet(
        db,
        wallet=receiver_wallet,
        amount=amount,
        entry_type=WalletLedgerType.TRANSFER_IN,
        reference_type="point_transfer",
        reference_id=reference_code,
        reason=f"Direct transfer from {sender_label}",
    )

    db.commit()
    db.refresh(transfer)

    try:
        core._queue_wallet_ops_email(
            db,
            user=sender,
            subject=f"Guilua point transfer completed {reference_code}",
            body=(
                f"Sender: {sender_email} ({sender_label})\n"
                f"Receiver: {recipient_email} ({recipient_label})\n"
                f"Amount: {amount} {currency}\n"
                f"Memo: {clean_memo or '-'}\n"
                "Status: completed"
            ),
            event_type="point_transfer_completed",
        )
        core._queue_member_email(
            db,
            user=sender,
            subject=f"Guilua point transfer completed {reference_code}",
            body=f"Your transfer of {amount} {currency} to {recipient_label} was completed.",
            event_type="point_transfer_completed_sender",
        )
        core._queue_member_email(
            db,
            user=recipient,
            subject=f"Guilua point transfer received {reference_code}",
            body=f"You received {amount} {currency} from {sender_label}. Memo: {clean_memo or '-'}",
            event_type="point_transfer_completed_receiver",
        )
        db.commit()
    except Exception:
        db.rollback()

    return transfer
