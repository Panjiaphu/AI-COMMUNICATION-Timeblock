from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.security import require_admin, verify_csrf
from app.core.templates import context, templates
from app.db.session import get_db
from app.models import (
    ContentPost,
    ContentPostSource,
    ContentPostStatus,
    ContentPostType,
    MemberUtilityUsage,
    SecurityEvent,
    SecurityIncident,
    SecurityPlaybook,
    SecurityRule,
    User,
    UtilityItem,
)
from app.services.commercial import (
    create_content_post,
    dump_json_list,
    unique_slug,
    update_post_status_timestamp,
    validate_public_url,
)
from app.services.media import save_uploaded_image
from app.services.security_firewall import dashboard_summary


router = APIRouter(prefix="/admin")


def _post_type_from_section(section: str) -> ContentPostType:
    if section == "jobs":
        return ContentPostType.JOB
    if section == "shop":
        return ContentPostType.SHOP
    if section == "crypto-analysis":
        return ContentPostType.CRYPTO_ANALYSIS
    raise HTTPException(status_code=404, detail="Unknown post section")


def _post_image_url_from_form(
    *,
    image_url: str,
    image_file: UploadFile | None,
    title: str,
    section: str,
) -> str:
    if not image_file or not image_file.filename:
        return image_url.strip()
    image_file.file.seek(0)
    saved = save_uploaded_image(
        content=image_file.file.read(),
        original_filename=image_file.filename,
        folder=f"posts/{section}",
        name_hint=title,
    )
    return saved.url


@router.get("/posts/{section}")
def admin_posts(section: str, request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    post_type = _post_type_from_section(section)
    posts = db.query(ContentPost).filter(ContentPost.post_type == post_type).order_by(ContentPost.created_at.desc()).all()
    return templates.TemplateResponse(
        request=request,
        name="admin/posts.html",
        context=context(request, admin=admin, section=section, post_type=post_type.value, posts=posts, statuses=list(ContentPostStatus)),
    )


@router.get("/posts/{section}/new")
def new_admin_post(section: str, request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    post_type = _post_type_from_section(section)
    return templates.TemplateResponse(
        request=request,
        name="admin/post_form.html",
        context=context(request, admin=admin, section=section, post_type=post_type.value, post=None),
    )


@router.get("/posts/{section}/{post_id}/edit")
def edit_admin_post(section: str, post_id: int, request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    post_type = _post_type_from_section(section)
    post = db.get(ContentPost, post_id)
    if not post or post.post_type != post_type:
        raise HTTPException(status_code=404, detail="Post not found")
    return templates.TemplateResponse(
        request=request,
        name="admin/post_form.html",
        context=context(request, admin=admin, section=section, post_type=post_type.value, post=post),
    )


@router.post("/posts/{section}")
def create_admin_post(
    section: str,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    title: str = Form(...),
    summary: str = Form(""),
    content: str = Form(""),
    image_url: str = Form(""),
    image_file: UploadFile | None = File(None),
    target_url: str = Form(""),
    platform: str = Form("other"),
    locale: str = Form("vi"),
    status: str = Form("draft"),
    tags: str = Form(""),
    sort_order: int = Form(0),
    market_session: str = Form(""),
    market_bias: str = Form(""),
    risk_level: str = Form(""),
    tradingview_symbol: str = Form(""),
    tradingview_url: str = Form(""),
    analysis_category: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    post_type = _post_type_from_section(section)
    try:
        final_image_url = _post_image_url_from_form(image_url=image_url, image_file=image_file, title=title, section=section)
        create_content_post(
            db,
            post_type=post_type.value,
            title=title,
            summary=summary,
            content=content,
            image_url=final_image_url,
            target_url=target_url,
            platform=platform,
            locale=locale,
            status=status,
            source=ContentPostSource.ADMIN.value,
            created_by=admin,
            tags=tags,
            sort_order=sort_order,
            market_session=market_session,
            market_bias=market_bias,
            risk_level=risk_level,
            tradingview_symbol=tradingview_symbol,
            tradingview_url=tradingview_url,
            analysis_category=analysis_category,
        )
    except ValueError:
        return RedirectResponse(f"/admin/posts/{section}/new?error=invalid_input", status_code=303)
    return RedirectResponse(f"/admin/posts/{section}?created=1", status_code=303)


@router.post("/posts/{section}/{post_id}")
def update_admin_post(
    section: str,
    post_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    title: str = Form(...),
    summary: str = Form(""),
    content: str = Form(""),
    image_url: str = Form(""),
    image_file: UploadFile | None = File(None),
    target_url: str = Form(""),
    platform: str = Form("other"),
    locale: str = Form("vi"),
    status: str = Form("draft"),
    tags: str = Form(""),
    sort_order: int = Form(0),
    market_session: str = Form(""),
    market_bias: str = Form(""),
    risk_level: str = Form(""),
    tradingview_symbol: str = Form(""),
    tradingview_url: str = Form(""),
    analysis_category: str = Form(""),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    post_type = _post_type_from_section(section)
    post = db.get(ContentPost, post_id)
    if not post or post.post_type != post_type:
        return RedirectResponse(f"/admin/posts/{section}?error=not_found", status_code=303)
    try:
        final_image_url = _post_image_url_from_form(image_url=image_url, image_file=image_file, title=title, section=section)
        if final_image_url:
            validate_public_url(final_image_url)
        if target_url:
            validate_public_url(target_url)
        if tradingview_url:
            validate_public_url(tradingview_url)
    except ValueError:
        return RedirectResponse(f"/admin/posts/{section}/{post_id}/edit?error=invalid_input", status_code=303)
    old_status = post.status.value
    post.title = title.strip()
    post.slug = unique_slug(db, title, existing_id=post.id)
    post.summary = summary.strip()
    post.content = content.strip()
    post.image_url = final_image_url
    post.target_url = target_url.strip()
    post.platform = platform.strip() or "other"
    post.market_session = market_session.strip()
    post.market_bias = market_bias.strip()
    post.risk_level = risk_level.strip()
    post.tradingview_symbol = tradingview_symbol.strip().upper()
    post.tradingview_url = tradingview_url.strip()
    post.analysis_category = analysis_category.strip()
    post.locale = locale if locale in {"vi", "zh-TW"} else "vi"
    post.status = ContentPostStatus(status)
    post.tags = dump_json_list(tags)
    post.sort_order = sort_order
    update_post_status_timestamp(post, old_status)
    db.commit()
    return RedirectResponse(f"/admin/posts/{section}?updated=1", status_code=303)


@router.post("/posts/{section}/{post_id}/archive")
def archive_admin_post(section: str, post_id: int, request: Request, db: Session = Depends(get_db), csrf_token: str = Form(...)):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    post = db.get(ContentPost, post_id)
    if post:
        post.status = ContentPostStatus.ARCHIVED
        update_post_status_timestamp(post, ContentPostStatus.PUBLISHED.value)
        db.commit()
    return RedirectResponse(f"/admin/posts/{section}?archived=1", status_code=303)


@router.get("/utilities")
def admin_utilities(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    items = db.query(UtilityItem).order_by(UtilityItem.sort_order.asc()).all()
    return templates.TemplateResponse(request=request, name="admin/utilities.html", context=context(request, admin=admin, utilities=items))


@router.post("/utilities/{utility_id}")
def update_admin_utility(
    utility_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    route_path: str = Form(""),
    is_active: bool = Form(False),
    is_member_only: bool = Form(False),
    is_free: bool = Form(False),
    sort_order: int = Form(0),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(UtilityItem, utility_id)
    if not item:
        return RedirectResponse("/admin/utilities?error=not_found", status_code=303)
    item.title = title.strip()
    item.description = description.strip()
    item.route_path = route_path.strip()
    item.is_active = is_active
    item.is_member_only = is_member_only
    item.is_free = is_free
    item.sort_order = sort_order
    db.commit()
    return RedirectResponse("/admin/utilities?updated=1", status_code=303)


@router.get("/firewall")
def admin_firewall(request: Request, db: Session = Depends(get_db)):
    admin = require_admin(request, db)
    events = db.query(SecurityEvent).order_by(SecurityEvent.created_at.desc()).limit(120).all()
    rules = db.query(SecurityRule).order_by(SecurityRule.created_at.desc()).limit(80).all()
    incidents = db.query(SecurityIncident).order_by(SecurityIncident.updated_at.desc()).limit(80).all()
    playbooks = db.query(SecurityPlaybook).filter(SecurityPlaybook.is_active.is_(True)).order_by(SecurityPlaybook.title.asc()).all()
    return templates.TemplateResponse(
        request=request,
        name="admin/firewall.html",
        context=context(request, admin=admin, events=events, rules=rules, incidents=incidents, playbooks=playbooks, security_summary=dashboard_summary(db)),
    )


@router.post("/firewall/rules")
def create_firewall_rule(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    name: str = Form(...),
    rule_type: str = Form(...),
    value: str = Form(...),
    action: str = Form("block"),
    severity: str = Form("medium"),
    note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    admin = require_admin(request, db)
    if rule_type not in {"ip_allow", "ip_block", "cidr_allow", "cidr_block", "country_allow", "country_block", "user_agent_block", "path_protect", "route_rate_limit"}:
        return RedirectResponse("/admin/firewall?error=invalid_rule_type", status_code=303)
    if action not in {"allow", "block", "challenge", "log"}:
        return RedirectResponse("/admin/firewall?error=invalid_action", status_code=303)
    item = SecurityRule(
        name=name.strip()[:160],
        rule_type=rule_type,
        value=value.strip()[:255],
        action=action,
        severity=severity if severity in {"info", "low", "medium", "high", "critical"} else "medium",
        note=note.strip(),
        created_by_user_id=admin.id,
        is_active=True,
    )
    db.add(item)
    db.commit()
    return RedirectResponse("/admin/firewall?rule_created=1", status_code=303)


@router.post("/firewall/rules/{rule_id}/toggle")
def toggle_firewall_rule(rule_id: int, request: Request, db: Session = Depends(get_db), csrf_token: str = Form(...)):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(SecurityRule, rule_id)
    if not item:
        return RedirectResponse("/admin/firewall?error=rule_not_found", status_code=303)
    item.is_active = not item.is_active
    db.commit()
    return RedirectResponse("/admin/firewall?rule_updated=1", status_code=303)


@router.post("/firewall/incidents/{incident_id}")
def update_firewall_incident(
    incident_id: int,
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(...),
    status: str = Form(...),
    resolution_note: str = Form(""),
):
    verify_csrf(request, csrf_token)
    require_admin(request, db)
    item = db.get(SecurityIncident, incident_id)
    if not item:
        return RedirectResponse("/admin/firewall?error=incident_not_found", status_code=303)
    if status not in {"open", "investigating", "contained", "resolved", "false_positive"}:
        return RedirectResponse("/admin/firewall?error=invalid_status", status_code=303)
    item.status = status
    item.resolution_note = resolution_note.strip()
    db.commit()
    return RedirectResponse("/admin/firewall?incident_updated=1", status_code=303)
