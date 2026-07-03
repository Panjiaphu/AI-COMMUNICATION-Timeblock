from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.i18n import resolve_locale
from app.core.security import get_current_user, require_admin, require_user, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import (
    BoOrder,
    BoSide,
    InternalWallet,
    PlatformTreasuryAccount,
    PointLedgerEntry,
    PointTransfer,
    RapidEntry,
    RapidPlayType,
    SandboxRequestStatus,
    SandboxRequestType,
    SandboxTransaction,
    User,
)
from app.services.slbo import (
    BO_ASSETS,
    RAPID_PLAY_CONFIGS,
    approve_wallet_request,
    approve_deposit,
    bo_session_clock,
    create_wallet_request,
    ensure_treasury,
    ensure_wallet,
    get_bo_market_snapshot,
    get_or_create_rapid_result_board,
    get_recent_rapid_result_boards,
    grant_initial_member_points_if_needed,
    place_bo_order,
    place_rapid_entry,
    rapid_session_clock,
    reject_wallet_request,
    sandbox_flags,
    transfer_points,
)


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


@router.get("/bo")
def bo_room(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    wallet = ensure_wallet(db, user) if user else None
    if user and wallet:
        grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
        db.commit()
    orders = (
        db.query(BoOrder)
        .filter(BoOrder.user_id == user.id)
        .order_by(BoOrder.created_at.desc())
        .limit(20)
        .all()
        if user
        else []
    )
    return templates.TemplateResponse(
        request=request,
        name="bo.html",
        context=context(
            request,
            user=user,
            wallet=wallet,
            orders=orders,
            market=get_bo_market_snapshot(),
            bo_assets=BO_ASSETS,
            bo_clock=bo_session_clock(),
            sandbox=sandbox_flags(),
        ),
    )


@router.post("/bo/orders")
def create_bo_order(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    asset: str = Form(...),
    side: str = Form(...),
    stake_amount: str = Form(...),
):
    verify_csrf(request, csrf_token)
    user = require_user(request, db)
    locale = resolve_locale(request)
    try:
        order = place_bo_order(
            db,
            user=user,
            asset_code=asset,
            side=BoSide(side),
            stake_amount=Decimal(stake_amount),
        )
    except (ValueError, InvalidOperation) as exc:
        return RedirectResponse(f"/bo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/bo?lang={locale}&created={order.reference_code}", status_code=303)


@router.get("/rapid")
def rapid_room(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    wallet = ensure_wallet(db, user) if user else None
    if user and wallet:
        grant_initial_member_points_if_needed(db, wallet=wallet, user=user)
    rapid_clock = rapid_session_clock()
    entries = (
        db.query(RapidEntry)
        .filter(RapidEntry.user_id == user.id)
        .order_by(RapidEntry.created_at.desc())
        .limit(20)
        .all()
        if user
        else []
    )
    rapid_result = get_or_create_rapid_result_board(db, str(rapid_clock["session_code"]))
    rapid_results = get_recent_rapid_result_boards(db, 5)
    db.commit()
    return templates.TemplateResponse(
        request=request,
        name="rapid.html",
        context=context(
            request,
            user=user,
            wallet=wallet,
            entries=entries,
            rapid_configs=RAPID_PLAY_CONFIGS,
            rapid_clock=rapid_clock,
            rapid_result=rapid_result,
            rapid_results=rapid_results,
            sandbox=sandbox_flags(),
        ),
    )


@router.get("/member/wallet")
def member_wallet(request: Request, db: Session = Depends(get_db)):
    if not get_settings().member_portal_enabled:
        return RedirectResponse("/member", status_code=303)
    user = require_user(request, db)
    wallet = ensure_wallet(db, user)
    wallet_requests = (
        db.query(SandboxTransaction)
        .filter(SandboxTransaction.user_id == user.id)
        .order_by(SandboxTransaction.created_at.desc())
        .limit(30)
        .all()
    )
    transfers = (
        db.query(PointTransfer)
        .filter(or_(PointTransfer.sender_user_id == user.id, PointTransfer.receiver_user_id == user.id))
        .order_by(PointTransfer.created_at.desc())
        .limit(30)
        .all()
    )
    ledger_entries = (
        db.query(PointLedgerEntry)
        .filter(PointLedgerEntry.user_id == user.id)
        .order_by(PointLedgerEntry.created_at.desc())
        .limit(40)
        .all()
    )
    return templates.TemplateResponse(
        request=request,
        name="member/wallet.html",
        context=context(
            request,
            user=user,
            wallet=wallet,
            wallet_requests=wallet_requests,
            transfers=transfers,
            ledger_entries=ledger_entries,
            error=request.query_params.get("error", ""),
        ),
    )


@router.post("/member/wallet/requests")
def create_member_wallet_request(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    request_type: str = Form(...),
    amount: str = Form(...),
    transfer_channel: str = Form(""),
    account_name: str = Form(""),
    account_identifier: str = Form(""),
    member_note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    user = require_user(request, db)
    locale = resolve_locale(request)
    try:
        create_wallet_request(
            db,
            user=user,
            request_type=SandboxRequestType(request_type),
            amount=Decimal(amount),
            transfer_channel=transfer_channel,
            account_name=account_name,
            account_identifier=account_identifier,
            member_note=member_note,
        )
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/member/wallet?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/member/wallet?lang={locale}&created=1", status_code=303)


@router.post("/member/wallet/transfers")
def create_member_point_transfer(
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
        transfer_points(
            db,
            sender=user,
            recipient_identifier=recipient_identifier,
            amount=Decimal(amount),
            memo=memo,
        )
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/member/wallet?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/member/wallet?lang={locale}&transferred=1", status_code=303)


@router.post("/rapid/entries")
def create_rapid_entry(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    play_type: str = Form(...),
    selection: str = Form(...),
    stake_amount: str = Form(...),
):
    verify_csrf(request, csrf_token)
    user = require_user(request, db)
    locale = resolve_locale(request)
    try:
        entry = place_rapid_entry(
            db,
            user=user,
            play_type=RapidPlayType(play_type),
            selection=selection,
            stake_amount=Decimal(stake_amount),
        )
    except (ValueError, InvalidOperation) as exc:
        return RedirectResponse(f"/rapid?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/rapid?lang={locale}&created={entry.reference_code}", status_code=303)


@router.get("/api/slbo/market")
def slbo_market_api():
    market = get_bo_market_snapshot()
    return JSONResponse(
        {
            "assets": [
                {
                    "code": item["code"],
                    "label": item["label"],
                    "price": float(item["price"]),
                    "change_24h": float(item["change_24h"]),
                    "tradingview_symbol": item["tradingview_symbol"],
                    "source": item["source"],
                }
                for item in market["assets"]
            ],
            "updated_at": market["updated_at"].isoformat(),
        }
    )


@router.get("/admin/slbo")
def admin_slbo(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    members = db.query(User).filter(User.is_admin.is_(False)).order_by(User.created_at.desc()).limit(300).all()
    wallets = db.query(InternalWallet).order_by(InternalWallet.updated_at.desc()).limit(300).all()
    wallet_by_user = {wallet.user_id: wallet for wallet in wallets}
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
    wallet_requests = (
        db.query(SandboxTransaction).order_by(SandboxTransaction.created_at.desc()).limit(50).all()
    )
    transfers = db.query(PointTransfer).order_by(PointTransfer.created_at.desc()).limit(40).all()
    return templates.TemplateResponse(
        request=request,
        name="admin/slbo.html",
        context=context(
            request,
            admin=admin,
            members=members,
            wallet_by_user=wallet_by_user,
            treasury=treasury,
            orders=orders,
            entries=entries,
            pending_requests=pending_requests,
            wallet_requests=wallet_requests,
            transfers=transfers,
            risk_summary=_platform_risk_summary(orders, entries, treasury),
            bo_clock=bo_session_clock(),
            rapid_clock=rapid_session_clock(),
            sandbox=sandbox_flags(),
        ),
    )


@router.post("/admin/slbo/deposits")
def admin_slbo_deposit(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    user_id: int = Form(...),
    amount: str = Form(...),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    user = db.get(User, user_id)
    if not user or user.is_admin:
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=invalid_member", status_code=303)
    try:
        approve_deposit(db, user=user, amount=Decimal(amount), admin=admin, note=note)
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&updated=1", status_code=303)


@router.post("/admin/slbo/requests/{transaction_id}/approve")
def admin_approve_wallet_request(
    transaction_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    item = db.get(SandboxTransaction, transaction_id)
    if not item:
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=not_found", status_code=303)
    try:
        approve_wallet_request(db, item=item, admin=admin, note=note)
    except (ValueError, InvalidOperation) as exc:
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&reviewed=1", status_code=303)


@router.post("/admin/slbo/requests/{transaction_id}/reject")
def admin_reject_wallet_request(
    transaction_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    locale = resolve_locale(request)
    item = db.get(SandboxTransaction, transaction_id)
    if not item:
        return RedirectResponse(f"/admin/slbo?lang={locale}&error=not_found", status_code=303)
    try:
        reject_wallet_request(db, item=item, admin=admin, note=note)
    except ValueError as exc:
        db.rollback()
        return RedirectResponse(f"/admin/slbo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&reviewed=1", status_code=303)
