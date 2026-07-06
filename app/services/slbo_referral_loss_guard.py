from __future__ import annotations

from decimal import Decimal

from app.services import slbo as core
from app.services.referral_policy import get_referral_policy


_ORIGINAL_MAYBE_CREATE_LOSS_DEPOSIT_COMMISSIONS = core.maybe_create_loss_deposit_commissions
DUST_BALANCE_LIMIT = Decimal("1.0000")


def maybe_create_loss_deposit_commissions(db, source_user):
    wallet = core.ensure_wallet(db, source_user)
    available = core._money(wallet.available_balance)
    policy = get_referral_policy(db)
    dust_limit = Decimal(str(policy.get("dust_balance_limit") or DUST_BALANCE_LIMIT)).quantize(Decimal("0.0001"))
    if available > dust_limit:
        return []
    return _ORIGINAL_MAYBE_CREATE_LOSS_DEPOSIT_COMMISSIONS(db, source_user)


core.maybe_create_loss_deposit_commissions = maybe_create_loss_deposit_commissions
