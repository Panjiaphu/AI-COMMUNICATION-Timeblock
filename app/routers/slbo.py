from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.i18n import resolve_locale
from app.core.security import get_current_user, require_admin, require_user, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import BoOrder, BoSide, InternalWallet, PlatformTreasuryAccount, RapidEntry, RapidPlayType, User
from app.services.slbo import (
    BO_ASSETS,
    RAPID_PLAY_CONFIGS,
    approve_deposit,
    bo_session_clock,
    ensure_treasury,
    ensure_wallet,
    get_bo_market_snapshot,
    place_bo_order,
    place_rapid_entry,
    rapid_session_clock,
    sandbox_flags,
)


router = APIRouter()


@router.get("/bo")
def bo_room(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    wallet = ensure_wallet(db, user) if user else None
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
    entries = (
        db.query(RapidEntry)
        .filter(RapidEntry.user_id == user.id)
        .order_by(RapidEntry.created_at.desc())
        .limit(20)
        .all()
        if user
        else []
    )
    return templates.TemplateResponse(
        request=request,
        name="rapid.html",
        context=context(
            request,
            user=user,
            wallet=wallet,
            entries=entries,
            rapid_configs=RAPID_PLAY_CONFIGS,
            rapid_clock=rapid_session_clock(),
            sandbox=sandbox_flags(),
        ),
    )


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
        return RedirectResponse(f"/admin/slbo?lang={locale}&error={str(exc)}", status_code=303)
    return RedirectResponse(f"/admin/slbo?lang={locale}&updated=1", status_code=303)
