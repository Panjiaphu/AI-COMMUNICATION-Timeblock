from __future__ import annotations

from app.services import slbo as core
from app.services import slbo_settlement_guard as guard
from app.services.slbo_balance_mode import get_or_create_demo_balanced_bo_result


_ORIGINAL_SESSION_RESULT_GETTER = guard.ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT


def _balanced_session_result(db, session_code=None, asset_code="BTC", market=None):
    return get_or_create_demo_balanced_bo_result(
        db,
        session_code=session_code,
        asset_code=asset_code,
        market=market,
        original_getter=_ORIGINAL_SESSION_RESULT_GETTER,
    )


guard.ORIGINAL_GET_OR_CREATE_BO_SESSION_RESULT = _balanced_session_result
core.get_or_create_bo_session_result = _balanced_session_result
