from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Request

from app.core.config import BASE_DIR


DEFAULT_FALLBACK_LOCALE = "zh-TW"
AVAILABLE_LOCALES = ("zh-TW", "vi", "en")
LOCALE_LABELS = {
    "zh-TW": "繁體中文",
    "vi": "Tiếng Việt",
    "en": "English",
}
LOCALE_COOKIE_NAME = "locale"
TRANSLATION_ROOT = BASE_DIR / "app" / "translations"

# Keep the source precedence. Missing bundles are harmless, while a synchronized
# source bundle can be added without changing the runtime adapter.
TRANSLATION_BUNDLES = (
    "ui",
    "home",
    "checkout",
    "member",
    "points",
    "fgo",
    "business",
    "tbqr",
    "chat",
    "messaging",
    "messaging_core_v2",
    "messaging_contact_v1",
    "assistant",
    "translator",
    "admin",
    "admin_forms",
    "activity",
    "utilities",
    "equities_workspace",
    "market_enterprise",
    "market",
    "equities",
    "market_intel",
    "rates",
    "flights",
    "ops",
    "blocks",
    "phase9",
    "opportunities",
    "timeblock_agent",
)


def _supported_locale(value: Any) -> str | None:
    raw = str(value or "").strip().replace("_", "-")
    aliases = {
        "zh": "zh-TW",
        "zh-tw": "zh-TW",
        "vi": "vi",
        "en": "en",
    }
    return aliases.get(raw.lower())


def normalize_locale(locale: Any, default: str = "vi") -> str:
    return _supported_locale(locale) or _supported_locale(default) or "vi"


def get_locale_label(locale: Any) -> str:
    return LOCALE_LABELS[normalize_locale(locale)]


def get_supported_locales() -> list[dict[str, str]]:
    return [{"code": locale, "label": LOCALE_LABELS[locale]} for locale in AVAILABLE_LOCALES]


def resolve_timeblock_locale(request: Request, default: str = "vi") -> str:
    for candidate in (
        request.query_params.get("lang"),
        request.cookies.get(LOCALE_COOKIE_NAME),
        request.cookies.get("lang"),
    ):
        supported = _supported_locale(candidate)
        if supported:
            return supported
    return normalize_locale(default)


def _read_translation_file(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as translation_file:
            translations = json.load(translation_file)
    except (OSError, json.JSONDecodeError):
        return {}
    return translations if isinstance(translations, dict) else {}


@lru_cache(maxsize=len(AVAILABLE_LOCALES))
def _load_translations(locale: str) -> dict[str, Any]:
    return _read_translation_file(TRANSLATION_ROOT / f"{locale}.json")


@lru_cache(maxsize=len(AVAILABLE_LOCALES) * len(TRANSLATION_BUNDLES))
def _load_bundle_translations(locale: str, bundle: str) -> dict[str, Any]:
    return _read_translation_file(TRANSLATION_ROOT / f"{bundle}-{locale}.json")


def _translation_dictionaries(locale: str) -> list[dict[str, Any]]:
    bundles = [_load_bundle_translations(locale, bundle) for bundle in TRANSLATION_BUNDLES]
    return [*bundles, _load_translations(locale)]


def translate(key: str, locale: Any = None, default: str | None = None) -> str:
    current_locale = normalize_locale(locale)
    for dictionary in _translation_dictionaries(current_locale):
        value = dictionary.get(key)
        if isinstance(value, str):
            return value
    for dictionary in _translation_dictionaries(DEFAULT_FALLBACK_LOCALE):
        value = dictionary.get(key)
        if isinstance(value, str):
            return value
    return default or key
