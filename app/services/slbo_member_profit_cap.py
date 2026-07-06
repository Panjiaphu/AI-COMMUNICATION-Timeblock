from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import User
from app.services import slbo as core
from app.services import slbo_chart_sync  # noqa: F401
from app.services.slbo_demo_controls import check_order_controls
from app.services.slbo_member_outcome_settings import effective_policy


_ORIGINAL_PLACE_BO_ORDER = core.place_bo_order
_ORIGINAL_PLACE_RAPID_ENTRY = core.place_rapid_entry


def _ensure_order_allowed(db: Session, user: User, stake_amount) -> None:
    wallet = core.ensure_wallet(db, user)
    check_order_controls(db, user=user, wallet=wallet, stake_amount=stake_amount)
    policy = effective_policy(db, user=user, wallet=wallet)
    if policy["guard_active"]:
        raise ValueError("member_profit_cap_reached")


def place_bo_order(db: Session, *, user: User, asset_code: str, side, stake_amount):
    core._assert_sandbox()
    _ensure_order_allowed(db, user, stake_amount)
    return _ORIGINAL_PLACE_BO_ORDER(
        db,
        user=user,
        asset_code=asset_code,
        side=side,
        stake_amount=stake_amount,
    )


def place_rapid_entry(db: Session, *, user: User, play_type, selection: str, stake_amount):
    core._assert_sandbox()
    _ensure_order_allowed(db, user, stake_amount)
    return _ORIGINAL_PLACE_RAPID_ENTRY(
        db,
        user=user,
        play_type=play_type,
        selection=selection,
        stake_amount=stake_amount,
    )


core.place_bo_order = place_bo_order
core.place_rapid_entry = place_rapid_entry
