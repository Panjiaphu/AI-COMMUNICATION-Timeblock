"""Synchronize the pinned Timeblock Communication presentation layer.

The script is intentionally local-only: it never downloads source files at
runtime and never talks to GitHub.  The source checkout and source SHA are
explicit inputs so a review can reproduce the vendor lock.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


FILES = {
    "templates/assistant/index_core.html": (
        "templates/assistant_index_core.html",
        "EXACT_VENDOR",
    ),
    "static/css/assistant.css": ("css/assistant.css", "EXACT_VENDOR"),
    "static/css/messaging_core_v2.css": ("css/messaging_core_v2.css", "EXACT_VENDOR"),
    "static/css/messaging_mobile_immersive.css": (
        "css/messaging_mobile_immersive.css",
        "EXACT_VENDOR",
    ),
    "static/css/messaging_enterprise_workspace.css": (
        "css/messaging_enterprise_workspace.css",
        "EXACT_VENDOR",
    ),
    "static/css/messaging_network_identity_restore.css": (
        "css/messaging_network_identity_restore.css",
        "EXACT_VENDOR",
    ),
    "static/css/messaging_composer_attachments_v2.css": (
        "css/messaging_composer_attachments_v2.css",
        "EXACT_VENDOR",
    ),
    "static/js/assistant.js": ("js/assistant.js", "ADAPTED_VENDOR"),
    "static/js/messaging.js": ("js/messaging.js", "ADAPTED_VENDOR"),
    "static/js/messaging_core_v2.js": ("js/messaging_core_v2.js", "ADAPTED_VENDOR"),
    "static/js/messaging_enterprise_workspace.js": (
        "js/messaging_enterprise_workspace.js",
        "ADAPTED_VENDOR",
    ),
    "static/js/messaging_mobile_immersive.js": (
        "js/messaging_mobile_immersive.js",
        "ADAPTED_VENDOR",
    ),
    "static/js/messaging_composer_attachments_v2.js": (
        "js/messaging_composer_attachments_v2.js",
        "ADAPTED_VENDOR",
    ),
    "static/manifest.webmanifest": (
        "assets/timeblock-manifest.webmanifest",
        "EXACT_VENDOR",
    ),
    "static/service-worker.js": (
        "assets/timeblock-service-worker.js",
        "EXACT_VENDOR",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sync(source_root: Path, destination_root: Path, source_sha: str) -> dict:
    destination_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for source_path, (destination_path, adaptation_class) in FILES.items():
        source = source_root / source_path
        destination = destination_root / destination_path
        if not source.is_file():
            raise FileNotFoundError(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        entries.append(
            {
                "source_path": source_path,
                "source_sha256": sha256(source),
                "destination_path": destination_path,
                "adaptation_class": adaptation_class,
            }
        )
    lock = {
        "source_repo": "Panjiaphu/fumap-bot-life",
        "source_sha": source_sha,
        "source_paths": [entry["source_path"] for entry in entries],
        "source_hashes": {
            entry["source_path"]: entry["source_sha256"] for entry in entries
        },
        "destination_paths": {
            entry["source_path"]: entry["destination_path"] for entry in entries
        },
        "adaptation_class": {
            entry["source_path"]: entry["adaptation_class"] for entry in entries
        },
        "sync_version": 1,
        "generated_from_local_checkout": True,
    }
    (destination_root / "SOURCE_LOCK.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return lock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    lock = sync(args.source.resolve(), args.destination.resolve(), args.source_sha)
    print(f"Synchronized {len(lock['source_paths'])} files from {lock['source_repo']}@{args.source_sha}")


if __name__ == "__main__":
    main()
