from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
from types import SimpleNamespace
from typing import Any
from urllib.parse import quote, urlencode, urlparse

from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.datastructures import QueryParams

from app.core.config import BASE_DIR, Settings
from app.core.timeblock_i18n import (
    get_locale_label,
    get_supported_locales,
    normalize_locale,
    translate,
)


VENDOR_TEMPLATE_DIR = BASE_DIR / "vendor" / "timeblock-assistant" / "templates"
timeblock_templates = Jinja2Templates(directory=VENDOR_TEMPLATE_DIR)

_LOCAL_ENDPOINTS = {
    "assistant.workspace": "/assistant",
    "assistant.app_settings": "/app-settings",
    "auth.logout": "/logout",
    "business_auth.logout": "/logout",
    "messaging.directory_me_qr": "/api/messaging/directory/me/qr.png",
}

_TIMEBLOCK_ENDPOINTS = {
    "home": "/",
    "business_auth.login": "/business/login",
    "business_auth.apply": "/business/apply",
    "business_auth.dashboard": "/business/dashboard",
    "utilities.index": "/utilities",
    "opportunities.index": "/opportunities",
    "flights.index": "/flights",
    "market.dashboard": "/market",
    "equities.dashboard": "/equities",
    "missions.list_missions": "/missions",
    "auth.login": "/login",
    "events.list_events": "/events",
    "shop.marketplace": "/shop",
    "shop.affiliate": "/shop/affiliate",
    "delivery.index": "/delivery",
    "redeem_shop.list_products": "/redeem-shop",
    "block_ledger.public_explorer": "/blocks",
    "member.dashboard": "/member/dashboard",
    "admin.dashboard": "/admin/dashboard",
    "checkout.pricing": "/pricing",
}

_ASSISTANT_BUCKETS = ("text", "image", "audio", "video", "speech")
_ASSISTANT_RUNTIME_ADAPTER = (
    '<link rel="stylesheet" '
    'href="/static/css/assistant_runtime_adapter.css?v=20260826-composer-grid-1" '
    'data-guilua-assistant-runtime-adapter>'
)


def _safe_base_url(value: str) -> str:
    base_url = str(value or "").strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("timeblock_app_url must be an absolute HTTP(S) URL")
    return base_url


def _query_string(values: dict[str, Any]) -> str:
    query: list[tuple[str, Any]] = []
    for key, value in values.items():
        if key.startswith("_") or value is None:
            continue
        if isinstance(value, (list, tuple)):
            query.extend((key, item) for item in value)
        else:
            query.append((key, value))
    return urlencode(query, doseq=True)


def _with_query(path: str, values: dict[str, Any]) -> str:
    query = _query_string(values)
    anchor = str(values.get("_anchor") or "").strip()
    result = f"{path}?{query}" if query else path
    return f"{result}#{quote(anchor, safe='')}" if anchor else result


def _safe_static_url(values: dict[str, Any]) -> str:
    params = dict(values)
    raw_filename = str(params.pop("filename", "")).replace("\\", "/")
    filename = PurePosixPath(raw_filename)
    if not raw_filename or filename.is_absolute() or ".." in filename.parts:
        raise ValueError("unsafe static filename")
    return _with_query(f"/static/{quote(filename.as_posix(), safe='/@')}", params)


@dataclass(slots=True)
class RequestFacade:
    """Minimal Flask request surface exposed to source-locked templates."""

    path: str
    endpoint: str
    args: QueryParams
    timeblock_app_url: str

    @property
    def blueprint(self) -> str:
        return self.endpoint.split(".", 1)[0] if "." in self.endpoint else ""

    def url_for(self, endpoint: str, **values: Any) -> str:
        if endpoint == "static":
            return _safe_static_url(values)
        if endpoint in _LOCAL_ENDPOINTS:
            return _with_query(_LOCAL_ENDPOINTS[endpoint], values)
        if endpoint in _TIMEBLOCK_ENDPOINTS:
            base_url = _safe_base_url(self.timeblock_app_url)
            return _with_query(f"{base_url}{_TIMEBLOCK_ENDPOINTS[endpoint]}", values)
        raise ValueError(f"unsupported Timeblock template endpoint: {endpoint}")


def _normalized_query(
    request: Request,
    *,
    initial_mode: str | None = None,
    conversation_id: str = "",
) -> QueryParams:
    values = list(request.query_params.multi_items())
    aliases = {
        "communication": "messages",
        "translation": "translate",
        "notifications": "alerts",
    }
    current = dict(values)
    requested_mode = aliases.get(str(current.get("mode") or ""), str(current.get("mode") or ""))
    mode = initial_mode or requested_mode
    if mode not in {"ai", "messages", "translate", "alerts"}:
        mode = "ai"
    values = [(key, value) for key, value in values if key not in {"mode", "conversation_id"}]
    values.append(("mode", mode))
    selected_conversation = conversation_id or str(current.get("conversation") or current.get("conversation_id") or "")
    if selected_conversation:
        values = [(key, value) for key, value in values if key != "conversation"]
        values.append(("conversation", selected_conversation))
    return QueryParams(values)


def _active_identity(session: Any) -> tuple[dict[str, Any], dict[str, str]]:
    principal = session.principal if isinstance(getattr(session, "principal", None), dict) else {}
    raw_role = str(principal.get("role") or principal.get("type") or principal.get("actor_type") or "member").lower()
    role = raw_role if raw_role in {"member", "business", "admin"} else "member"
    actor_type = str(principal.get("type") or principal.get("actor_type") or role).lower()
    if actor_type not in {"member", "business", "admin"}:
        actor_type = role
    actor_id = str(principal.get("id") or principal.get("public_id") or principal.get("sub") or "")
    email = str(principal.get("email") or "")
    display_name = str(principal.get("display_name") or principal.get("name") or email)
    active_user = {
        "id": actor_id,
        "role": role,
        "email": email,
        "display_name": display_name,
    }
    assistant_actor = {"type": actor_type, "id": actor_id}
    return active_user, assistant_actor


def _count(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return 0


def _assistant_usage(session: Any, supplied_usage: dict[str, Any] | None = None) -> dict[str, Any]:
    principal = session.principal if isinstance(getattr(session, "principal", None), dict) else {}
    supplied = supplied_usage if isinstance(supplied_usage, dict) else principal.get("assistant_usage")
    raw_usage = supplied if isinstance(supplied, dict) else {}
    raw_buckets = raw_usage.get("buckets") if isinstance(raw_usage.get("buckets"), dict) else {}
    buckets: dict[str, dict[str, int]] = {}
    for name in _ASSISTANT_BUCKETS:
        raw_meter = raw_buckets.get(name) if isinstance(raw_buckets.get(name), dict) else {}
        used = _count(raw_meter.get("used"))
        limit = _count(raw_meter.get("limit"))
        remaining = _count(raw_meter.get("remaining")) if "remaining" in raw_meter else max(0, limit - used)
        buckets[name] = {"used": used, "limit": limit, "remaining": remaining}
    text_bucket = buckets["text"]
    return {
        "used": _count(raw_usage.get("used")) if "used" in raw_usage else text_bucket["used"],
        "limit": _count(raw_usage.get("limit")) if "limit" in raw_usage else text_bucket["limit"],
        "remaining": _count(raw_usage.get("remaining")) if "remaining" in raw_usage else text_bucket["remaining"],
        "reset_at": str(raw_usage.get("reset_at") or "—"),
        "buckets": buckets,
    }


def _localized_url(request: Request, locale: str) -> str:
    values = [(key, value) for key, value in request.query_params.multi_items() if key != "lang"]
    values.append(("lang", normalize_locale(locale)))
    return f"{request.url.path}?{urlencode(values, doseq=True)}"


class TemplateConfig(SimpleNamespace):
    """Flask-config-compatible read-only adapter for source-locked templates."""

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)


def _template_config(settings: Settings) -> TemplateConfig:
    public_base_url = str(settings.public_base_url or "").strip().rstrip("/")
    return TemplateConfig(
        ADSENSE_CLIENT="",
        COMMUNICATION_GROUP_UI_URL=f"{public_base_url}/communication",
        MESSAGING_ADVANCED_ATTACHMENTS_ENABLED=settings.messaging_advanced_attachments_enabled,
        MESSAGING_REALTIME_ENABLED=settings.messaging_realtime_enabled,
        MESSAGING_MAILBOX_LOCK_ENABLED=settings.messaging_mailbox_lock_enabled,
        TRANSLATOR_REALTIME_ENABLED=False,
    )


def _canonical_url(settings: Settings, path: str, locale: str) -> str:
    base_url = str(settings.public_base_url or "").strip().rstrip("/")
    return f"{base_url}{path}?{urlencode({'lang': locale})}"


def _inject_assistant_runtime_adapter(html: str) -> str:
    """Append Guilua-only CSS without modifying the exact Timeblock vendor mirror."""

    marker = "</head>"
    if marker not in html:
        raise ValueError("source-locked assistant template is missing </head>")
    return html.replace(marker, f"    {_ASSISTANT_RUNTIME_ADAPTER}\n  {marker}", 1)


def _base_context(
    request: Request,
    session: Any,
    settings: Settings,
    *,
    locale: str,
    facade: RequestFacade,
    assistant_usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    active_user, assistant_actor = _active_identity(session)

    def t(key: str, default: str | None = None) -> str:
        return translate(key, locale, default)

    return {
        "request": facade,
        "current_locale": locale,
        "locale_label": get_locale_label(locale),
        "supported_locales": get_supported_locales(),
        "localized_url": lambda selected: _localized_url(request, selected),
        "t": t,
        "active_user": active_user,
        "assistant_actor": assistant_actor,
        "assistant_usage": _assistant_usage(session, assistant_usage),
        "config": _template_config(settings),
        "canonical_url": _canonical_url(settings, facade.path, locale),
        "adsense_page_eligible": False,
        "ad_free_access": True,
        "page_notice": None,
    }


def render_timeblock_assistant(
    request: Request,
    session: Any,
    *,
    locale: str,
    initial_mode: str | None = None,
    conversation_id: str = "",
    assistant_usage: dict[str, Any] | None = None,
) -> HTMLResponse:
    settings = request.app.state.settings
    # Root and legacy deep links represent the canonical source /assistant view.
    # This preserves the source template's assistant-only asset boundary.
    facade = RequestFacade(
        path="/assistant",
        endpoint="assistant.workspace",
        args=_normalized_query(request, initial_mode=initial_mode, conversation_id=conversation_id),
        timeblock_app_url=settings.timeblock_app_url,
    )
    context = _base_context(
        request,
        session,
        settings,
        locale=locale,
        facade=facade,
        assistant_usage=assistant_usage,
    )
    # The source-locked Flask templates require ``request`` to be the facade
    # above, while Starlette's TemplateResponse reserves that key for its ASGI
    # Request object. Render through the same configured Jinja environment and
    # return HTML directly so neither framework contract is impersonated.
    vendor_html = timeblock_templates.get_template("assistant/index.html").render(context)
    response = HTMLResponse(_inject_assistant_runtime_adapter(vendor_html))
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = (
        "camera=(self), microphone=(self), speaker-selection=(self), geolocation=()"
    )
    return response


def render_timeblock_settings(request: Request, session: Any, *, locale: str) -> HTMLResponse:
    settings = request.app.state.settings
    facade = RequestFacade(
        path="/app-settings",
        endpoint="assistant.app_settings",
        args=QueryParams(request.query_params.multi_items()),
        timeblock_app_url=settings.timeblock_app_url,
    )
    context = _base_context(request, session, settings, locale=locale, facade=facade)
    response = HTMLResponse(
        timeblock_templates.get_template("assistant/settings.html").render(context)
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = (
        "camera=(self), microphone=(self), geolocation=(), browsing-topics=()"
    )
    return response
