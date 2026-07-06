from __future__ import annotations

from decimal import Decimal

from app.services import slbo as core


_ORIGINAL_MAYBE_CREATE_LOSS_DEPOSIT_COMMISSIONS = core.maybe_create_loss_deposit_commissions
DUST_BALANCE_LIMIT = Decimal("1.0000")


def maybe_create_loss_deposit_commissions(db, source_user):
    wallet = core.ensure_wallet(db, source_user)
    available = core._money(wallet.available_balance)
    if available > DUST_BALANCE_LIMIT:
        return []
    return _ORIGINAL_MAYBE_CREATE_LOSS_DEPOSIT_COMMISSIONS(db, source_user)


core.maybe_create_loss_deposit_commissions = maybe_create_loss_deposit_commissions
