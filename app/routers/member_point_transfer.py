from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.i18n import resolve_locale
from app.core.security import require_user, verify_csrf
from app.db.session import get_db
from app.services.slbo_transfer_direct import transfer_points


router = APIRouter()


TRANSFER_ERROR_CODES = {
    "invalid_recipient",
    "insufficient_balance",
    "invalid_amount",
    "sandbox_only",
}


def _redirect_wallet(locale: str, *, error: str | None = None, transfer_code: str | None = None) -> RedirectResponse:
    if transfer_code:
        return RedirectResponse(f"/member/wallet?lang={locale}&transfer_completed={transfer_code}", status_code=303)
    safe_error = error if error in TRANSFER_ERROR_CODES else "transfer_failed"
    return RedirectResponse(f"/member/wallet?lang={locale}&error={safe_error}", status_code=303)


@router.post("/member/wallet/transfers")
def create_direct_member_point_transfer(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    recipient_identifier: str = Form(...),
    amount: str = Form(...),
    memo: str = Form(""),
):
    locale = resolve_locale(request)
    try:
        verify_csrf(request, csrf_token)
        user = require_user(request, db)
        transfer = transfer_points(
            db,
            sender=user,
            recipient_identifier=recipient_identifier,
            amount=Decimal(amount),
            memo=memo,
        )
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return _redirect_wallet(locale, error=str(exc))
    except Exception:
        db.rollback()
        return _redirect_wallet(locale, error="transfer_failed")
    return _redirect_wallet(locale, transfer_code=transfer.reference_code)
