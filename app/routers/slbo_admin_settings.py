from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.i18n import resolve_locale
from app.core.security import require_admin, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import (
    BoOrder,
    InternalWallet,
    PlatformTreasuryAccount,
    PointTransfer,
    RapidEntry,
    SandboxRequestStatus,
    SandboxTransaction,
    User,
)
from app.services.slbo import bo_session_clock, ensure_treasury, rapid_session_clock, sandbox_flags
from app.services.slbo_demo_controls import get_controls, positive_member_count, update_controls
from app.services.slbo_member_outcome_settings import profit_percent, settings_map, update_setting
from app.services.slbo_outcome_settings import get_slbo_outcome_settings, update_member_target_success_rate


router = APIRouter()


def _platform_risk_summary(orders: list[BoOrder], entries: list[RapidEntry], treasury: PlatformTreasuryAccount) -> dict:
    total_requests = len(orders) + len(entries)
    platform_wins = 0
    member_wins = 0
    net_points = Decimal("0")
    for order in orders:
        if order.status.value == "lost":
            platform_wins += 1
        elif order.status.value == "won":
            member_wins += 1
        net_points += -Decimal(str(order.profit_amount or 0))
    for entry in entries:
        if entry.status.value == "lost":
            platform_wins += 1
        elif entry.status.value == "won":
            member_wins += 1
        net_points += Decimal(str(entry.stake_amount or 0)) - Decimal(str(entry.result_amount or 0))
    platform_win_rate = (platform_wins / total_requests * 100) if total_requests else 0
    member_win_rate = (member_wins / total_requests * 100) if total_requests else 0
    reserve_floor = Decimal(str(treasury.reserve_floor or 0))
    available = Decimal(str(treasury.available_balance or 0))
    reserve_coverage = 100 if reserve_floor <= 0 else min(float(available / reserve_floor * 100), 999)
    return {
        "total_requests": total_requests,
        "platform_win_rate": platform_win_rate,
        "member_win_rate": member_win_rate,
        "net_points": net_points,
        "reserve_coverage": reserve_coverage,
        "guard_active": available >= reserve_floor,
    }


@router.get("/admin/slbo")
def admin_slbo_with_outcome_settings(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    members = db.query(User).filter(User.is_admin.is_(False)).order_by(User.created_at.desc()).limit(300).all()
    wallets = db.query(InternalWallet).order_by(InternalWallet.updated_at.desc()).limit(300).all()
    wallet_by_user = {wallet.user_id: wallet for wallet in wallets}
    member_profit_percent = {member.id: profit_percent(wallet_by_user.get(member.id)) for member in members}
    member_policy_settings = settings_map(db, members)
    demo_order_controls = get_controls(db)
    treasury = ensure_treasury(db)
    orders = db.query(BoOrder).order_by(BoOrder.created_at.desc()).limit(40).all()
    entries = db.query(RapidEntry).order_by(RapidEntry.created_at.desc()).limit(40).all()
    pending_requests = (
        db.query(SandboxTransaction)
        .filter(SandboxTransaction.status == SandboxRequestStatus.PENDING)
        .order_by(SandboxTransaction.created_at.asc())
        .limit(50)
        .all()
    )
    wallet_requests = db.query(SandboxTransaction).order_by(SandboxTransaction.created_at.desc()).limit(50).all()
    transfers = db.query(PointTransfer).order_by(PointTransfer.created_at.desc()).limit(40).all()
    outcome_settings = get_slbo_outcome_settings(db)
    return templates.TemplateResponse(
        request=request,
        name="admin/slbo.html",
        context=context(
            request,
            admin=admin,
            members=members,
            wallet_by_user=wallet_by_user,
            member_profit_percent=member_profit_percent,
            member_policy_settings=member_policy_settings,
            positive_member_count=positive_member_count(db, wallets),
            demo_order_controls=demo_order_controls,
            treasury=treasury,
            orders=orders,
            entries=entries,
            pending_requests=pending_requests,
            wallet_requests=wallet_requests,
            transfers=transfers,
            risk_summary=_platform_risk_summary(orders, entries, treasury),
            outcome_settings=outcome_settings,
            bo_clock=bo_session_clock(),
            rapid_clock=rapid_session_clock(),
            sandbox=sandbox_flags(),
        ),
    )


@router.post("/admin/slbo/outcome-settings")
def update_slbo_outcome_settings(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    member_target_success_rate: str = Form(...),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    try:
        update_member_target_success_rate(
            db,
            rate=Decimal(member_target_success_rate),
            note=note,
            admin_user_id=admin.id,
        )
    except (ValueError, InvalidOperation):
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=invalid_success_rate", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&outcome_updated=1", status_code=303)


@router.post("/admin/slbo/demo-order-controls")
def update_demo_order_controls(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    enabled: str | None = Form(None),
    positive_member_lock_enabled: str | None = Form(None),
    large_order_threshold: str = Form("0"),
    large_order_mode: str = Form("session_condition_unavailable"),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    try:
        update_controls(
            db,
            enabled=enabled == "1",
            positive_member_lock_enabled=positive_member_lock_enabled == "1",
            large_order_threshold=Decimal(large_order_threshold),
            large_order_mode=large_order_mode,
            note=note,
            admin_user_id=admin.id,
        )
    except (ValueError, InvalidOperation):
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=invalid_demo_controls", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&demo_controls_updated=1", status_code=303)


@router.post("/admin/slbo/member-profit-cap")
def update_member_profit_cap(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    user_id: int = Form(...),
    profit_cap_percent: str = Form("0"),
    enabled: str | None = Form(None),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    member = db.get(User, user_id)
    if not member or member.is_admin:
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=invalid_member", status_code=303)
    try:
        outcome_settings = get_slbo_outcome_settings(db)
        update_setting(
            db,
            user_id=user_id,
            target_rate=Decimal(str(outcome_settings["member_target_success_rate"])),
            guard_percent=Decimal(profit_cap_percent),
            guard_enabled=enabled == "1",
            note=note,
            admin_user_id=admin.id,
        )
    except (ValueError, InvalidOperation):
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=invalid_profit_cap", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&member_profit_cap_updated=1", status_code=303)
