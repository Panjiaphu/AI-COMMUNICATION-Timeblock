"""Synchronize the source-locked Timeblock Assistant presentation runtime.

The synchronizer is deliberately local-only. It verifies the exact Git HEAD of
the supplied Timeblock checkout, reads canonical bytes from that commit's Git
object database (never from a line-ending-filtered working tree), mirrors every
source file under the vendor directory, and copies browser/runtime files
byte-for-byte into the standalone application's local roots.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


SOURCE_REPO = "Panjiaphu/fumap-bot-life"
SYNC_VERSION = 3
LOCALES = ("vi", "en", "zh-TW")
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

TEMPLATE_FILES = (
    "templates/base.html",
    "templates/partials/nav.html",
    "templates/partials/footer.html",
    "templates/partials/market_assistant.html",
    "templates/assistant/index_core_live_translate.html",
    "templates/assistant/index_core.html",
    "templates/assistant/index.html",
    "templates/assistant/settings.html",
)

ASSISTANT_INITIAL_CSS = (
    "static/css/main.css",
    "static/css/responsive.css",
    "static/css/timeblock_v2.css",
    "static/css/security.css",
    "static/css/i18n_shared_shell.css",
    "static/css/assistant.css",
    "static/css/assistant_image_generation.css",
    "static/css/live_translate.css",
    "static/css/live_translate_history.css",
    "static/css/messaging_core_v2.css",
    "static/css/messaging_mobile_immersive.css",
    "static/css/messaging_enterprise_workspace.css",
    "static/css/messaging_network_identity_restore.css",
    "static/css/messaging_contact_v1.css",
    "static/css/group_launcher_v3.css",
)

CALL_BOOTSTRAP_CSS = (
    "static/css/call_workspace.css",
    "static/css/call_translation_plugin.css",
)

STARTUP_LAZY_CSS = (
    "static/css/messaging_ux_v1.css",
    "static/css/messaging_multi_image_canonical_hotfix.css",
)

ATTACHMENT_LAZY_CSS = ("static/css/messaging_composer_attachments_v2.css",)

SETTINGS_NON_ASSISTANT_CSS = (
    "static/css/auth.css",
    "static/css/member.css",
    "static/css/business.css",
    "static/css/checkout.css",
    "static/css/missions.css",
    "static/css/chat.css",
    "static/css/events.css",
    "static/css/shop.css",
    "static/css/utilities.css",
    "static/css/market.css",
    "static/css/market_equities.css",
    "static/css/equities.css",
    "static/css/market_futures_risk.css",
    "static/css/market_wyckoff.css",
    "static/css/market_rule_quality.css",
    "static/css/market_enterprise.css",
    "static/css/market_enterprise_hot.css",
    "static/css/market_enterprise_flow.css",
    "static/css/market_enterprise_tokenomics.css",
    "static/css/market_enterprise_opportunity.css",
    "static/css/market_enterprise_sentiment.css",
    "static/css/exchange_rates.css",
    "static/css/admin.css",
    "static/css/admin_i18n_fix.css",
    "static/css/admin_phase16.css",
    "static/css/phase18_media.css",
    "static/css/market_assistant.css",
    "static/css/app_settings_responsive_fix.css",
)

SETTINGS_CSS = ("static/css/app_settings.css",)
PWA_RUNTIME_ONLY_CSS = ("static/css/call_v3.css",)

ASSISTANT_INITIAL_JS = (
    "static/js/main.js",
    "static/js/security.js",
    "static/js/pwa-install.js",
    "static/js/assistant_startup_hotfix.js",
    "static/js/call_audio_ownership.js",
    "static/js/call-v1/session.js",
    "static/js/call-v1/media.js",
    "static/js/call-v1/peer.js",
    "static/js/call-v1/signaling.js",
    "static/js/call-v1/ring-audio.js",
    "static/js/call-v1/runtime.js",
    "static/js/call-v1/translation_plugin.js",
    "static/js/call_audio_ownership_install.js",
    "static/js/call-v1/bootstrap.js",
    "static/js/live_translate.js",
    "static/js/live_translate_hotfix_core.js",
    "static/js/live_translate_hotfix_media.js",
    "static/js/live_translate_hotfix_bootstrap.js",
    "static/js/live_translate_history.js",
    "static/js/assistant.js",
    "static/js/group_launcher_v3.js",
    "static/js/assistant_image_generation.js",
    "static/js/messaging_core_v2.js",
    "static/js/messaging_mobile_immersive.js",
    "static/js/messaging_enterprise_workspace.js",
    "static/js/messaging_image_download_platform.js",
    "static/js/messaging_image_viewer_scroll_guard.js",
    "static/js/messaging_contact_v1.js",
    "static/js/messaging_contact_avatar_bridge.js",
)

STARTUP_LAZY_JS = (
    "static/js/messaging_multi_image_canonical_hotfix.js",
    "static/js/messaging_ux_v1.js",
)

ATTACHMENT_LAZY_JS = ("static/js/messaging_composer_attachments_v2.js",)
CAPABILITY_LAZY_JS = ("static/js/messaging_capability_surfaces_v2.js",)
QR_LAZY_JS = (
    "static/vendor/jsqr/1.4.0/jsQR.min.js",
    "static/js/qr_friend_scanner.js",
)

SETTINGS_NON_ASSISTANT_JS = (
    "static/js/missions.js",
    "static/js/chat.js",
    "static/js/events.js",
    "static/js/shop.js",
    "static/js/admin.js",
    "static/js/app_settings_layout.js",
    "static/js/market_enterprise_dashboard.js",
    "static/js/market_futures_risk.js",
    "static/js/market_backend_payload.js",
    "static/js/market_enterprise_phase1.js",
    "static/js/market_enterprise_phase2.js",
    "static/js/market_enterprise_flow.js",
    "static/js/market_enterprise_tokenomics.js",
    "static/js/market_enterprise_opportunity.js",
    "static/js/market_enterprise_sentiment.js",
    "static/js/market_equities.js",
    "static/js/equities.js",
    "static/js/market_assistant.js",
)

SETTINGS_JS = ("static/js/app_settings.js",)
SETTINGS_LAZY_JS = ("static/js/incoming_call_ringtone.js",)
PWA_RUNTIME_ONLY_JS = (
    "static/js/messaging.js",
    "static/js/timeblock_call_runtime.js",
)

PRESERVED_LEGACY_UNMANAGED = (
    "static/css/call_interpreter_panel.css",
    "static/css/messaging.css",
    "static/css/translator.css",
    "static/js/translator.js",
)

STATIC_SUPPORT_FILES = (
    "static/manifest.webmanifest",
    "static/service-worker.js",
    "static/vendor/jsqr/1.4.0/LICENSE",
    "static/i18n/messaging_ux_v1.json",
    "static/img/timeblock-icon.svg",
    "static/img/timeblock-icon-192.png",
    "static/img/timeblock-icon-512.png",
    "static/img/timeblock-maskable-512.png",
    "static/img/timeblock-badge-96.png",
)

PWA_CORE_ASSETS = (
    "static/css/main.css",
    "static/css/responsive.css",
    "static/js/pwa-install.js",
    "static/img/timeblock-icon-192.png",
    "static/img/timeblock-icon-512.png",
    "static/img/timeblock-badge-96.png",
    "static/manifest.webmanifest",
)

PWA_CALL_RUNTIME_ASSETS = (
    "static/css/call_workspace.css",
    "static/js/assistant.js",
    "static/js/messaging.js",
    "static/js/messaging_core_v2.js",
    "static/js/incoming_call_ringtone.js",
    "static/js/timeblock_call_runtime.js",
    "static/js/call_audio_ownership.js",
    "static/js/call_audio_ownership_install.js",
    "static/css/call_v3.css",
    "static/js/call-v1/session.js",
    "static/js/call-v1/media.js",
    "static/js/call-v1/peer.js",
    "static/js/call-v1/signaling.js",
    "static/js/call-v1/ring-audio.js",
    "static/js/call-v1/runtime.js",
    "static/js/call-v1/translation_plugin.js",
    "static/js/call-v1/bootstrap.js",
    "static/css/call_translation_plugin.css",
    "static/css/group_launcher_v3.css",
    "static/js/group_launcher_v3.js",
)


def unique_paths(*groups: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(path for group in groups for path in group))


TRANSLATION_FILES = tuple(
    [f"translations/{locale}.json" for locale in LOCALES]
    + [
        f"translations/{bundle}-{locale}.json"
        for locale in LOCALES
        for bundle in TRANSLATION_BUNDLES
    ]
)

SOURCE_FILES = unique_paths(
    TEMPLATE_FILES,
    ASSISTANT_INITIAL_CSS,
    CALL_BOOTSTRAP_CSS,
    STARTUP_LAZY_CSS,
    ATTACHMENT_LAZY_CSS,
    SETTINGS_NON_ASSISTANT_CSS,
    SETTINGS_CSS,
    PWA_RUNTIME_ONLY_CSS,
    ASSISTANT_INITIAL_JS,
    STARTUP_LAZY_JS,
    ATTACHMENT_LAZY_JS,
    CAPABILITY_LAZY_JS,
    QR_LAZY_JS,
    SETTINGS_NON_ASSISTANT_JS,
    SETTINGS_JS,
    SETTINGS_LAZY_JS,
    PWA_RUNTIME_ONLY_JS,
    STATIC_SUPPORT_FILES,
    TRANSLATION_FILES,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git_value(source_root: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(source_root), *arguments],
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def git_blob(source_root: Path, source_sha: str, source_path: str) -> bytes:
    try:
        completed = subprocess.run(
            ["git", "-C", str(source_root), "show", f"{source_sha}:{source_path}"],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        raise FileNotFoundError(
            f"Missing Timeblock Git object path {source_sha}:{source_path}"
        ) from exc
    return completed.stdout


def verify_source_checkout(source_root: Path, expected_sha: str) -> str:
    requested_sha = expected_sha.strip().lower()
    if len(requested_sha) != 40 or any(character not in "0123456789abcdef" for character in requested_sha):
        raise ValueError("--source-sha must be a full 40-character hexadecimal Git SHA")
    checkout_root = Path(git_value(source_root, "rev-parse", "--show-toplevel")).resolve()
    if checkout_root != source_root:
        raise RuntimeError(f"--source must be the checkout root: expected {checkout_root}, received {source_root}")
    actual_sha = git_value(source_root, "rev-parse", "HEAD").lower()
    if actual_sha != requested_sha:
        raise RuntimeError(
            f"Timeblock source HEAD mismatch: expected {requested_sha}, actual {actual_sha}"
        )
    return actual_sha


def relative_to_repo(path: Path, repository_root: Path) -> str:
    return path.resolve().relative_to(repository_root.resolve()).as_posix()


def destination_files(
    source_path: str,
    vendor_root: Path,
    app_root: Path,
) -> tuple[Path, ...]:
    destinations = [vendor_root / source_path]
    if source_path.startswith("static/") or source_path.startswith("translations/"):
        destinations.append(app_root / source_path)
    return tuple(destinations)


def settings_css_graph() -> tuple[str, ...]:
    return unique_paths(
        ("static/css/main.css", "static/css/responsive.css"),
        SETTINGS_NON_ASSISTANT_CSS,
        ("static/css/security.css", "static/css/i18n_shared_shell.css"),
        SETTINGS_CSS,
    )


def settings_js_graph() -> tuple[str, ...]:
    return unique_paths(
        ("static/js/main.js",),
        SETTINGS_NON_ASSISTANT_JS[:5],
        ("static/js/security.js", "static/js/pwa-install.js"),
        SETTINGS_NON_ASSISTANT_JS[5:],
        SETTINGS_JS,
        ("static/js/call_audio_ownership.js", "static/js/timeblock_call_runtime.js"),
    )


def build_lock(
    source_sha: str,
    source_hashes: dict[str, str],
    entries: list[dict[str, str]],
) -> dict:
    destinations: dict[str, list[str]] = {}
    adaptation_classes: dict[str, str] = {}
    for entry in entries:
        destinations.setdefault(entry["source_path"], []).append(entry["destination_path"])
        adaptation_classes[entry["destination_path"]] = entry["adaptation_class"]
    return {
        "source_repo": SOURCE_REPO,
        "source_sha": source_sha,
        "source_checkout_head": source_sha,
        "source_paths": list(SOURCE_FILES),
        "source_hashes": source_hashes,
        "destination_paths": destinations,
        "adaptation_class": adaptation_classes,
        "entries": entries,
        "sync_version": SYNC_VERSION,
        "generated_from_local_checkout": True,
        "source_extraction": {
            "mode": "git_object_database",
            "working_tree_filters_applied": False,
        },
        "runtime_network_source": False,
        "preserved_legacy_unmanaged": list(PRESERVED_LEGACY_UNMANAGED),
        "template_graph": {
            "assistant": {
                "route": "/assistant",
                "leaf_template": "templates/assistant/index.html",
                "inheritance_leaf_to_base": [
                    "templates/assistant/index.html",
                    "templates/assistant/index_core.html",
                    "templates/assistant/index_core_live_translate.html",
                    "templates/base.html",
                ],
                "base_includes": [
                    "templates/partials/nav.html",
                    "templates/partials/footer.html",
                ],
                "block_semantics": "leaf head/scripts override intermediate blocks without super()",
            },
            "settings": {
                "route": "/app-settings",
                "leaf_template": "templates/assistant/settings.html",
                "inheritance_leaf_to_base": [
                    "templates/assistant/settings.html",
                    "templates/base.html",
                ],
                "base_includes": [
                    "templates/partials/nav.html",
                    "templates/partials/footer.html",
                    "templates/partials/market_assistant.html",
                ],
                "source_route_classification": "non_assistant",
            },
        },
        "runtime_asset_graph": {
            "assistant_initial_css": list(ASSISTANT_INITIAL_CSS),
            "assistant_initial_js": list(ASSISTANT_INITIAL_JS),
            "assistant_inline_runtime": [
                "window.__TIMEBLOCK_CALL_V1_ENABLED__ = true",
                "assistant-image-generation-copy application/json",
            ],
            "call_bootstrap_css": list(CALL_BOOTSTRAP_CSS),
            "lazy": [
                {
                    "trigger": "DOMContentLoaded",
                    "ordered_assets": list(STARTUP_LAZY_CSS + STARTUP_LAZY_JS),
                },
                {
                    "trigger": "advanced attachments enabled and messaging/attachment surface",
                    "ordered_assets": list(ATTACHMENT_LAZY_CSS + ATTACHMENT_LAZY_JS),
                },
                {
                    "trigger": "QR scanner interaction",
                    "ordered_assets": list(QR_LAZY_JS),
                },
                {
                    "trigger": "timeblock:messaging:conversation",
                    "ordered_assets": list(CAPABILITY_LAZY_JS),
                },
                {
                    "trigger": "messaging UX copy fetch",
                    "ordered_assets": ["static/i18n/messaging_ux_v1.json"],
                },
                {
                    "trigger": "settings ringtone preview",
                    "ordered_assets": list(SETTINGS_LAZY_JS),
                },
            ],
            "settings_initial_css": list(settings_css_graph()),
            "settings_initial_js": list(settings_js_graph()),
            "settings_member_business_conditional_js": [
                "static/js/call_audio_ownership.js",
                "static/js/timeblock_call_runtime.js",
            ],
        },
        "pwa": {
            "manifest": "static/manifest.webmanifest",
            "service_worker_source": "static/service-worker.js",
            "service_worker_registration_url": "/service-worker.js",
            "scope": "/",
            "core_precache_assets": list(PWA_CORE_ASSETS),
            "network_first_call_runtime_assets": list(PWA_CALL_RUNTIME_ASSETS),
            "manifest_icons": [
                "static/img/timeblock-icon-192.png",
                "static/img/timeblock-icon-512.png",
                "static/img/timeblock-maskable-512.png",
            ],
        },
        "i18n": {
            "locales": list(LOCALES),
            "default_locale": "zh-TW",
            "bundles": list(TRANSLATION_BUNDLES),
            "base_files": [f"translations/{locale}.json" for locale in LOCALES],
            "bundle_file_count": len(TRANSLATION_BUNDLES) * len(LOCALES),
            "total_file_count": len(TRANSLATION_FILES),
            "browser_loaded_static_copy": "static/i18n/messaging_ux_v1.json",
        },
    }


def sync(
    source_root: Path,
    vendor_root: Path,
    app_root: Path,
    source_sha: str,
) -> dict:
    source_root = source_root.resolve()
    vendor_root = vendor_root.resolve()
    app_root = app_root.resolve()
    repository_root = app_root.parent
    actual_sha = verify_source_checkout(source_root, source_sha)

    source_hashes: dict[str, str] = {}
    entries: list[dict[str, str]] = []
    for source_path in SOURCE_FILES:
        source_bytes = git_blob(source_root, actual_sha, source_path)
        source_digest = sha256_bytes(source_bytes)
        source_hashes[source_path] = source_digest
        for destination in destination_files(source_path, vendor_root, app_root):
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(source_bytes)
            destination_digest = sha256(destination)
            if destination_digest != source_digest:
                raise RuntimeError(f"Byte-for-byte verification failed for {destination}")
            entries.append(
                {
                    "source_path": source_path,
                    "source_sha256": source_digest,
                    "destination_path": relative_to_repo(destination, repository_root),
                    "destination_sha256": destination_digest,
                    "adaptation_class": "EXACT_VENDOR",
                }
            )

    lock = build_lock(actual_sha, source_hashes, entries)
    vendor_root.mkdir(parents=True, exist_ok=True)
    (vendor_root / "SOURCE_LOCK.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return lock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--app-root", type=Path)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    vendor_root = args.destination.resolve()
    app_root = args.app_root.resolve() if args.app_root else vendor_root.parents[1] / "app"
    lock = sync(args.source, vendor_root, app_root, args.source_sha)
    print(
        "Synchronized "
        f"{len(lock['source_paths'])} source files into {len(lock['entries'])} exact destinations "
        f"from {lock['source_repo']}@{lock['source_sha']}"
    )


if __name__ == "__main__":
    main()
