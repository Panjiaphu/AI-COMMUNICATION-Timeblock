from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.security import require_admin, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import (
    AiAgentApiKey,
    AiAgentPostLog,
    ContentPost,
    ContentPostSource,
    ContentPostStatus,
    ContentPostType,
    EmailNotification,
    EmailReply,
    MemberUtilityUsage,
    ReferralCommission,
    ReferralCommissionStatus,
    ReferralCommissionType,
    SecurityEvent,
    SecurityIncident,
    SecurityPlaybook,
    SecurityRule,
    ServiceRequest,
    TransactionRequest,
    TransactionStatus,
    User,
    UtilityItem,
)
from app.services.commercial import (
    create_agent_key,
    create_content_post,
    dump_json_list,
    unique_slug,
    update_post_status_timestamp,
    validate_public_url,
)
from app.services.email import flush_email_queue, mark_reply_processed, queue_email
from app.services.ip_provider import provision_ip_service
from app.services.media import save_uploaded_image
from app.services.rates import latest_rates, update_manual_rate
from app.services.referral_policy import get_referral_policy
from app.services.referrals import admin_referral_summary, create_referral_commissions, referral_level_counts
from app.services.security_firewall import dashboard_summary


router = APIRouter(prefix="/admin")


@router.get("")
def dashboard(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    requests = db.query(TransactionRequest).order_by(TransactionRequest.created_at.desc()).limit(50).all()
    service_requests = db.query(ServiceRequest).order_by(ServiceRequest.created_at.desc()).limit(50).all()
    emails = db.query(EmailNotification).order_by(EmailNotification.created_at.desc()).limit(20).all()
    replies = db.query(EmailReply).order_by(EmailReply.created_at.desc()).limit(20).all()
    member_count = db.query(User).filter(User.is_admin.is_(False)).count()
    referral_summary = admin_referral_summary(db)
    content_counts = {
        "jobs": db.query(ContentPost).filter(ContentPost.post_type == ContentPostType.JOB).count(),
        "shop": db.query(ContentPost).filter(ContentPost.post_type == ContentPostType.SHOP).count(),
        "crypto_analysis": db.query(ContentPost).filter(ContentPost.post_type == ContentPostType.CRYPTO_ANALYSIS).count(),
    }
    return templates.TemplateResponse(
        request=request,
        name="admin/dashboard.html",
        context=context(
            request,
            admin=admin,
            requests=requests,
            service_requests=service_requests,
            rates=latest_rates(db),
            emails=emails,
            replies=replies,
            statuses=list(TransactionStatus),
            member_count=member_count,
            referral_summary=referral_summary,
            content_counts=content_counts,
            security_summary=dashboard_summary(db),
        ),
    )


@router.get("/referrals")
def admin_referrals(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    members = db.query(User).filter(User.is_admin.is_(False)).order_by(User.created_at.desc()).limit(500).all()
    commissions = db.query(ReferralCommission).order_by(ReferralCommission.created_at.desc()).limit(100).all()
    member_referral_counts = {member.id: referral_level_counts(db, member) for member in members}
    return templates.TemplateResponse(
        request=request,
        name="admin/referrals.html",
        context=context(
            request,
            admin=admin,
            members=members,
            commissions=commissions,
            summary=admin_referral_summary(db),
            commission_types=list(ReferralCommissionType),
            commission_statuses=list(ReferralCommissionStatus),
            member_referral_counts=member_referral_counts,
            referral_policy=get_referral_policy(db),
        ),
    )


@router.post("/referrals/commissions")
def create_admin_referral_commission(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    source_user_id: int = Form(...),
    commission_type: str = Form(...),
    base_amount: str = Form(...),
    currency: str = Form("POINT"),
    reference_type: str = Form("manual"),
    reference_id: str = Form(""),
    note: str = Form(""),
    status: str = Form("pending"),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    source_user = db.get(User, source_user_id)
    if not source_user or source_user.is_admin:
        return RedirectResponse("/admin/referrals?error=invalid_source", status_code=303)
    try:
        parsed_type = ReferralCommissionType(commission_type)
        parsed_status = ReferralCommissionStatus(status)
        parsed_base = Decimal(base_amount)
    except (ValueError, InvalidOperation):
        return RedirectResponse("/admin/referrals?error=invalid_input", status_code=303)
    if parsed_base <= 0:
        return RedirectResponse("/admin/referrals?error=invalid_amount", status_code=303)
    try:
        created = create_referral_commissions(
            db,
            source_user=source_user,
            commission_type=parsed_type,
            base_amount=parsed_base,
            currency=currency,
            reference_type=reference_type,
            reference_id=reference_id,
            note=note,
            created_by=admin,
            status=parsed_status,
        )
    except ValueError:
        return RedirectResponse("/admin/referrals?error=invalid_amount", status_code=303)
    if not created:
        return RedirectResponse("/admin/referrals?error=no_upline", status_code=303)
    return RedirectResponse(f"/admin/referrals?created={len(created)}", status_code=303)


@router.post("/referrals/commissions/{commission_id}/status")
def update_referral_commission_status(
    commission_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    status: str = Form(...),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(ReferralCommission, commission_id)
    if not item:
        return RedirectResponse("/admin/referrals?error=not_found", status_code=303)
    try:
        item.status = ReferralCommissionStatus(status)
    except ValueError:
        return RedirectResponse("/admin/referrals?error=invalid_status", status_code=303)
    db.commit()
    return RedirectResponse("/admin/referrals?updated=1", status_code=303)


@router.post("/requests/{request_id}")
def update_request(
    request: Request,
    request_id: int,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    status: str = Form(...),
    admin_note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(TransactionRequest, request_id)
    if not item:
        return RedirectResponse("/admin?error=not_found", status_code=303)
    item.status = TransactionStatus(status)
    item.admin_note = admin_note.strip()
    db.commit()
    db.refresh(item)
    queue_email(
        db,
        item.user.email,
        f"Guilua - cập nhật yêu cầu {item.reference_code}",
        f"Trạng thái yêu cầu hiện tại: {item.status.value}. Ghi chú quản trị: {item.admin_note or '-'}",
        "member_transaction_status",
        user=item.user,
        transaction=item,
    )
    return RedirectResponse("/admin?updated=1", status_code=303)


@router.post("/rates")
def update_rate(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    pair: str = Form(...),
    buy_rate: str = Form(...),
    sell_rate: str = Form(...),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    try:
        parsed_buy = Decimal(buy_rate)
        parsed_sell = Decimal(sell_rate)
    except InvalidOperation:
        return RedirectResponse("/admin?error=invalid_rate", status_code=303)
    if parsed_buy <= 0 or parsed_sell <= 0:
        return RedirectResponse("/admin?error=invalid_rate", status_code=303)
    update_manual_rate(db, pair=pair, buy_rate=parsed_buy, sell_rate=parsed_sell, note=note.strip())
    return RedirectResponse("/admin?rate_updated=1", status_code=303)


@router.post("/services/{service_id}")
def update_service_request(
    request: Request,
    service_id: int,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    status: str = Form(...),
    assigned_endpoint: str = Form(""),
    admin_note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(ServiceRequest, service_id)
    if not item:
        return RedirectResponse("/admin?error=service_not_found", status_code=303)
    if status not in {state.value for state in TransactionStatus}:
        return RedirectResponse("/admin?error=invalid_service_status", status_code=303)
    item.status = status
    item.assigned_endpoint = assigned_endpoint.strip()
    item.admin_note = admin_note.strip()
    if item.status in {TransactionStatus.APPROVED.value, TransactionStatus.COMPLETED.value} and not item.assigned_endpoint:
        provision = provision_ip_service(item)
        if provision.success:
            item.assigned_endpoint = provision.endpoint
        elif provision.configured:
            provider_note = "Không thể cấp endpoint tự động, vui lòng kiểm tra provider và cấp thủ công."
            item.admin_note = f"{item.admin_note}\n{provider_note}".strip()
    db.commit()
    db.refresh(item)
    queue_email(
        db,
        item.user.email,
        f"Guilua - cập nhật dịch vụ {item.reference_code}",
        (
            f"Trạng thái dịch vụ chuyển IP hiện tại: {item.status}. "
            f"Endpoint: {item.assigned_endpoint or '-'}. "
            f"Ghi chú quản trị: {item.admin_note or '-'}"
        ),
        "member_service_status",
        user=item.user,
    )
    return RedirectResponse("/admin?service_updated=1", status_code=303)


@router.post("/email/flush")
def flush_emails(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    sent = flush_email_queue(db)
    return RedirectResponse(f"/admin?email_flush={len(sent)}", status_code=303)


@router.post("/email-replies/{reply_id}/processed")
def process_email_reply(
    request: Request,
    reply_id: int,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
):
    verify_csrf(request, csrf_token)
    mark_reply_processed(db, reply_id)
    return RedirectResponse("/admin?reply_processed=1", status_code=303)


@router.get("/ai-agents")
def ai_agents(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    keys = db.query(AiAgentApiKey).order_by(AiAgentApiKey.created_at.desc()).all()
    logs = db.query(AiAgentPostLog).order_by(AiAgentPostLog.created_at.desc()).limit(80).all()
    raw_key = request.query_params.get("raw_key", "")
    return templates.TemplateResponse(
        request=request,
        name="admin/ai_agents.html",
        context=context(request, admin=admin, keys=keys, logs=logs, raw_key=raw_key),
    )


@router.post("/ai-agents")
def create_ai_agent_key(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    name: str = Form(...),
    allowed_post_types: str = Form("job,shop,crypto_analysis"),
    can_auto_publish: bool = Form(False),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    _, raw_key = create_agent_key(
        db,
        name=name,
        allowed_post_types=[item.strip() for item in allowed_post_types.split(",") if item.strip()],
        can_auto_publish=can_auto_publish,
    )
    return RedirectResponse(f"/admin/ai-agents?raw_key={raw_key}", status_code=303)


@router.post("/ai-agents/{key_id}/toggle")
def toggle_ai_agent_key(
    request: Request,
    key_id: int,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
):
    verify_csrf(request, csrf_token)
    item = db.get(AiAgentApiKey, key_id)
    if not item:
        return RedirectResponse("/admin/ai-agents?error=not_found", status_code=303)
    item.is_active = not item.is_active
    db.commit()
    return RedirectResponse("/admin/ai-agents?updated=1", status_code=303)


def _post_type_from_section(section: str) -> ContentPostType:
    if section == "jobs":
        return ContentPostType.JOB
    if section == "shop":
        return ContentPostType.SHOP
    if section == "crypto-analysis":
        return ContentPostType.CRYPTO_ANALYSIS
    raise HTTPException(status_code=404)
