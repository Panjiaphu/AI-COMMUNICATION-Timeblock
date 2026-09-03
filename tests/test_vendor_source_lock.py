from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

from scripts.sync_timeblock_assistant_ui import git_blob


ROOT = Path(__file__).resolve().parents[1]
ASSISTANT_VENDOR = ROOT / "vendor/timeblock-assistant"
LOCK_PATH = ASSISTANT_VENDOR / "SOURCE_LOCK.json"
SOURCE_SHA = "57923c141fc23111c2173bf241c497822f1626de"


def _lock() -> dict[str, Any]:
    return json.loads(LOCK_PATH.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _runtime_path(source_path: str) -> Path | None:
    if source_path.startswith("static/"):
        return ROOT / "app/static" / source_path.removeprefix("static/")
    if source_path.startswith("translations/"):
        return ROOT / "app/translations" / source_path.removeprefix("translations/")
    return None


def _all_runtime_assets(lock: dict[str, Any]) -> set[str]:
    graph = lock["runtime_asset_graph"]
    assets: set[str] = set()
    for key, values in graph.items():
        if key == "assistant_inline_runtime":
            continue
        if key == "lazy":
            for lazy_group in values:
                assets.update(lazy_group["ordered_assets"])
            continue
        assets.update(values)
    pwa = lock["pwa"]
    assets.update(pwa["core_precache_assets"])
    assets.update(pwa["network_first_call_runtime_assets"])
    assets.update(pwa["manifest_icons"])
    return assets


def test_assistant_lock_is_exactly_pinned_to_the_target_timeblock_source():
    lock = _lock()

    assert lock["source_repo"] == "Panjiaphu/fumap-bot-life"
    assert lock["source_sha"] == SOURCE_SHA
    assert lock["source_checkout_head"] == SOURCE_SHA
    assert lock["sync_version"] == 4
    assert lock["generated_from_local_checkout"] is True
    assert lock["source_extraction"] == {
        "mode": "git_object_database",
        "working_tree_filters_applied": False,
    }
    assert lock["runtime_network_source"] is False
    assert len(lock["source_paths"]) == 222
    assert len(set(lock["source_paths"])) == 222
    assert len(lock["source_hashes"]) == 222
    assert len(lock["destination_paths"]) == 222
    assert len(lock["entries"]) == 436
    assert len(lock["adaptation_class"]) == 436


def test_all_436_locked_destinations_are_exact_hash_matches():
    lock = _lock()
    source_paths = set(lock["source_paths"])
    destination_paths: set[str] = set()

    for entry in lock["entries"]:
        source_path = entry["source_path"]
        destination_path = entry["destination_path"]
        destination = ROOT / destination_path

        assert source_path in source_paths
        assert destination_path not in destination_paths
        destination_paths.add(destination_path)
        assert destination_path.startswith(
            ("vendor/timeblock-assistant/", "app/static/", "app/translations/")
        )
        assert destination.resolve().is_relative_to(ROOT.resolve())
        assert entry["adaptation_class"] == "EXACT_VENDOR"
        assert lock["adaptation_class"][destination_path] == "EXACT_VENDOR"
        assert entry["source_sha256"] == lock["source_hashes"][source_path]
        assert entry["destination_sha256"] == entry["source_sha256"]
        assert destination.is_file(), destination_path
        assert _sha256(destination) == entry["source_sha256"], destination_path

    assert len(destination_paths) == 436


def test_every_source_has_an_exact_vendor_mirror_and_required_runtime_copy():
    lock = _lock()

    for source_path in lock["source_paths"]:
        mapped = lock["destination_paths"][source_path]
        destinations = [mapped] if isinstance(mapped, str) else mapped
        vendor_relative = next(
            destination
            for destination in destinations
            if destination.startswith("vendor/timeblock-assistant/")
        )
        vendor_path = ROOT / vendor_relative
        assert vendor_relative == f"vendor/timeblock-assistant/{source_path}"
        assert _sha256(vendor_path) == lock["source_hashes"][source_path]

        runtime_path = _runtime_path(source_path)
        if runtime_path is not None:
            assert runtime_path.relative_to(ROOT).as_posix() in destinations
            assert runtime_path.is_file(), source_path
            assert _sha256(runtime_path) == lock["source_hashes"][source_path]


def test_template_inheritance_and_asset_load_graph_are_locked_and_present():
    lock = _lock()
    assistant_graph = lock["template_graph"]["assistant"]
    settings_graph = lock["template_graph"]["settings"]

    assert assistant_graph["inheritance_leaf_to_base"] == [
        "templates/assistant/index.html",
        "templates/assistant/index_core.html",
        "templates/assistant/index_core_live_translate.html",
        "templates/base.html",
    ]
    assert assistant_graph["base_includes"] == [
        "templates/partials/nav.html",
        "templates/partials/footer.html",
    ]
    assert settings_graph["inheritance_leaf_to_base"] == [
        "templates/assistant/settings.html",
        "templates/base.html",
    ]
    assert "templates/partials/market_assistant.html" in settings_graph["base_includes"]

    source_paths = set(lock["source_paths"])
    runtime_assets = _all_runtime_assets(lock)
    assert {
        "static/css/assistant.css",
        "static/css/assistant_mobile_conversation_v1.css",
        "static/css/timeblock_v2.css",
        "static/css/call_workspace.css",
        "static/css/call_translation_plugin.css",
        "static/css/app_settings.css",
        "static/js/call-v1/bootstrap.js",
        "static/js/assistant_mobile_conversation_v1.js",
        "static/js/incoming_call_ringtone.js",
        "static/js/app_settings.js",
        "static/i18n/messaging_ux_v1.json",
    }.issubset(runtime_assets)
    for source_path in runtime_assets:
        assert source_path in source_paths
        runtime_path = _runtime_path(source_path)
        assert runtime_path is not None and runtime_path.is_file(), source_path


def test_translation_and_pwa_graphs_cover_the_three_canonical_locales():
    lock = _lock()
    i18n = lock["i18n"]
    pwa = lock["pwa"]

    assert set(i18n["locales"]) == {"vi", "en", "zh-TW"}
    assert len(i18n["bundles"]) == 30
    assert i18n["bundle_file_count"] == 90
    assert i18n["total_file_count"] == 93
    assert len([path for path in lock["source_paths"] if path.startswith("translations/")]) == 93
    assert pwa["service_worker_registration_url"] == "/service-worker.js"
    assert pwa["scope"] == "/"
    assert pwa["manifest"] == "static/manifest.webmanifest"
    assert pwa["service_worker_source"] == "static/service-worker.js"


def test_communication_compatibility_template_does_not_load_remote_vendor_code():
    communication = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    assert "github.com" not in communication
    assert "vendor/timeblock-communication" not in communication


def test_sync_reads_committed_blob_bytes_instead_of_filtered_worktree_bytes(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=source, check=True)
    subprocess.run(["git", "config", "user.name", "Source Lock Test"], cwd=source, check=True)
    subprocess.run(
        ["git", "config", "user.email", "source-lock@example.test"],
        cwd=source,
        check=True,
    )
    subprocess.run(["git", "config", "core.autocrlf", "false"], cwd=source, check=True)
    sample = source / "sample.txt"
    sample.write_bytes(b"canonical\n")
    subprocess.run(["git", "add", "sample.txt"], cwd=source, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=source, check=True)
    source_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=source,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    sample.write_bytes(b"filtered-working-tree\r\n")

    assert git_blob(source, source_sha, "sample.txt") == b"canonical\n"


def test_exact_vendor_paths_disable_checkout_line_ending_filters():
    attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    for pattern in (
        "/vendor/timeblock-assistant/** -text",
        "/app/static/css/** -text",
        "/app/static/js/** -text",
        "/app/translations/** -text",
    ):
        assert pattern in attributes
