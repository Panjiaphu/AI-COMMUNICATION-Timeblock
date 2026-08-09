from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor/timeblock-communication"


def test_vendor_lock_is_pinned_to_current_timeblock_main():
    lock = json.loads((VENDOR / "SOURCE_LOCK.json").read_text(encoding="utf-8"))
    assert lock["source_repo"] == "Panjiaphu/fumap-bot-life"
    assert lock["source_sha"] == "1ca83486c8985f2c28d60a767be9b30a68701dae"
    assert lock["sync_version"] == 1
    assert len(lock["source_paths"]) == 15


def test_vendor_hashes_match_the_checked_in_destination_bytes():
    lock = json.loads((VENDOR / "SOURCE_LOCK.json").read_text(encoding="utf-8"))
    for source_path, destination_path in lock["destination_paths"].items():
        digest = hashlib.sha256((VENDOR / destination_path).read_bytes()).hexdigest()
        assert digest == lock["source_hashes"][source_path]


def test_vendor_js_is_not_loaded_from_a_remote_url():
    communication = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    assert "github.com" not in communication
    assert "vendor/timeblock-communication" not in communication
