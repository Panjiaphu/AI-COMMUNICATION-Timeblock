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


@router.post("/member/wallet/transfers")
def create_direct_member_point_transfer(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    recipient_identifier: str = Form(...),
    amount: str = Form(...),
    memo: str = Form(""),
):
    verify_csrf(request, csrf_token)
    user = require_user(request, db)
    locale = resolve_locale(request)
    try:
        transfer = transfer_points(
            db,
            sender=user,
            recipient_identifier=recipient_identifier,
            amount=Decimal(amount),
            memo=memo,
        )
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/member/wallet?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/member/wallet?lang={locale}&transfer_completed={transfer.reference_code}", status_code=303)
