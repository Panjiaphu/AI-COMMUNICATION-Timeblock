from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.security import require_admin, verify_csrf
from app.db.session import get_db
from app.models import User
from app.services.email_verification import queue_member_verification_email


router = APIRouter(prefix="/admin")


@router.post("/members/{member_id}/send-verification")
def send_member_verification(
    member_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    member = db.get(User, member_id)
    if not member or member.is_admin:
        return RedirectResponse("/admin/members?verification_error=invalid_member", status_code=303)
    if member.is_email_verified:
        return RedirectResponse("/admin/members?verification_status=already_verified", status_code=303)
    try:
        queue_member_verification_email(db, request, member, flush=True)
    except Exception as exc:  # noqa: BLE001 - keep admin dashboard alive if SMTP fails
        db.rollback()
        return RedirectResponse(f"/admin/members?verification_error=email_send_failed", status_code=303)
    return RedirectResponse("/admin/members?verification_status=sent", status_code=303)
