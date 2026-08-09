"""Create a source-locked local copy of the current Timeblock Assistant UI."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


FILES = (
    "templates/assistant/index.html",
    "templates/assistant/index_core.html",
    "static/css/main.css",
    "static/css/responsive.css",
    "static/css/i18n_shared_shell.css",
    "static/css/assistant.css",
    "static/css/messaging.css",
    "static/css/messaging_core_v2.css",
    "static/css/messaging_mobile_immersive.css",
    "static/css/messaging_enterprise_workspace.css",
    "static/css/messaging_network_identity_restore.css",
    "static/css/messaging_composer_attachments_v2.css",
    "static/css/translator.css",
    "static/css/call_workspace.css",
    "static/css/call_interpreter_panel.css",
    "static/js/main.js",
    "static/js/assistant.js",
    "static/js/assistant_startup_hotfix.js",
    "static/js/messaging.js",
    "static/js/messaging_core_v2.js",
    "static/js/messaging_mobile_immersive.js",
    "static/js/messaging_enterprise_workspace.js",
    "static/js/messaging_composer_attachments_v2.js",
    "static/js/messaging_capability_surfaces_v2.js",
    "static/js/messaging_image_download_platform.js",
    "static/js/messaging_image_viewer_scroll_guard.js",
    "static/js/qr_friend_scanner.js",
    "static/js/incoming_call_ringtone.js",
    "static/js/pwa-install.js",
    "static/js/timeblock_call_runtime.js",
    "static/js/translator.js",
    "static/manifest.webmanifest",
    "static/service-worker.js",
    "static/vendor/jsqr/1.4.0/jsQR.min.js",
    "static/vendor/jsqr/1.4.0/LICENSE",
    "static/img/timeblock-icon.svg",
    "static/img/timeblock-icon-192.png",
    "static/img/timeblock-icon-512.png",
    "static/img/timeblock-maskable-512.png",
)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def sync(source_root: Path, destination_root: Path, source_sha: str) -> None:
    destination_root.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for relative in FILES:
        source = source_root / relative
        destination = destination_root / relative
        if not source.is_file():
            raise FileNotFoundError(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        hashes[relative] = digest(source)
    lock = {
        "source_repo": "Panjiaphu/fumap-bot-life",
        "source_sha": source_sha,
        "source_paths": list(FILES),
        "source_hashes": hashes,
        "sync_version": 1,
        "generated_from_local_checkout": True,
        "runtime_network_source": False,
    }
    (destination_root / "SOURCE_LOCK.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    sync(args.source.resolve(), args.destination.resolve(), args.source_sha)
    print(f"Synchronized {len(FILES)} files from Panjiaphu/fumap-bot-life@{args.source_sha}")


if __name__ == "__main__":
    main()
