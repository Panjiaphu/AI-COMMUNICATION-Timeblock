from __future__ import annotations

from html import escape

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.security import require_admin, verify_csrf
from app.db.session import get_db
from app.models import User
from app.services.email_verification import queue_member_verification_email


router = APIRouter(prefix="/admin")


def _row(member: User, csrf_token: str) -> str:
    status = "Yes" if member.is_email_verified else "No"
    status_class = "ok" if member.is_email_verified else "warn"
    referrer = escape(member.sponsor.email) if member.sponsor else escape(str(member.referred_by_user_id or "-"))
    action = "Verified"
    if not member.is_email_verified:
        action = (
            f'<form method="post" action="/admin/members/{member.id}/send-verification">'
            f'<input type="hidden" name="csrf_token" value="{escape(csrf_token)}">'
            '<button class="button small primary" type="submit">Resend verification</button>'
            '</form>'
        )
    return (
        "<tr>"
        f"<td>{escape(member.email)}</td>"
        f"<td><strong>{escape(member.full_name or '-')}</strong><br><small>{escape(member.uid or str(member.id))}</small></td>"
        f"<td>{escape(member.referral_code or '-')}</td>"
        f"<td>{referrer}</td>"
        f"<td><span class='badge {status_class}'>{status}</span></td>"
        f"<td>{escape(str(member.created_at))}</td>"
        f"<td>{action}</td>"
        "</tr>"
    )


@router.get("/member-verification", response_class=HTMLResponse)
def member_verification_page(request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    csrf_token = str(request.state.session.get("csrf_token") or "")
    members = db.query(User).filter(User.is_admin.is_(False)).order_by(User.created_at.desc()).limit(500).all()
    rows = "".join(_row(member, csrf_token) for member in members) or "<tr><td colspan='7'>No members.</td></tr>"
    notice = ""
    if request.query_params.get("verification_status") == "sent":
        notice = "<p class='success'>Verification email sent.</p>"
    elif request.query_params.get("verification_status") == "already_verified":
        notice = "<p class='success'>This member is already verified.</p>"
    elif request.query_params.get("verification_error"):
        notice = "<p class='alert'>Verification email could not be sent. Check email settings and logs.</p>"
    return HTMLResponse(
        "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>Member verification</title><link rel='stylesheet' href='/static/app.css?v=20260704-bo-wallet'></head><body>"
        "<main><section class='admin-shell'>"
        "<div class='admin-nav panel'><a href='/admin?lang=vi'>Dashboard</a><a href='/admin/member-verification?lang=vi'>Member verification</a><a href='/admin/members?lang=vi'>Members</a><a href='/admin/slbo?lang=vi'>BO Admin</a></div>"
        "<section class='panel'><div class='section-head'><div><h1>Member verification</h1><span>Review registered members and resend account verification links.</span></div></div>"
        f"{notice}<div class='table-wrap'><table class='coin-table'><thead><tr><th>Email</th><th>Name / UID</th><th>Referral code</th><th>Referrer</th><th>Email verified</th><th>Created</th><th>Action</th></tr></thead><tbody>{rows}</tbody></table></div>"
        "</section></section></main></body></html>"
    )


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
        return RedirectResponse("/admin/member-verification?verification_error=invalid_member", status_code=303)
    if member.is_email_verified:
        return RedirectResponse("/admin/member-verification?verification_status=already_verified", status_code=303)
    try:
        queue_member_verification_email(db, request, member, flush=True)
    except Exception:  # noqa: BLE001 - keep admin page alive if SMTP fails
        db.rollback()
        return RedirectResponse("/admin/member-verification?verification_error=email_send_failed", status_code=303)
    return RedirectResponse("/admin/member-verification?verification_status=sent", status_code=303)
