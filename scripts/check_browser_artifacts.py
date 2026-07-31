from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

TEXT_SUFFIXES = {".json", ".log", ".txt", ".xml"}

REQUIRED_VIEWPORTS = (
    "mobile-390x844",
    "mobile-landscape-844x390",
    "mobile-430x932",
    "mobile-landscape-932x430",
    "tablet-768x1024",
    "tablet-landscape-1024x768",
    "desktop-1366x768",
    "desktop-1440x900",
)
REQUIRED_EVIDENCE_FILES = (
    *(f"evidence/{name}.json" for name in REQUIRED_VIEWPORTS),
    "evidence/fake-media-granted.json",
    "evidence/permission-denied.json",
    "evidence/webrtc-reconnect.json",
    "evidence/webrtc-participant-a.json",
    "evidence/webrtc-participant-b.json",
    "evidence/webrtc-participant-c.json",
    "evidence/reconnect-exhaustion.json",
    "evidence/one-sided-hangup.json",
)
REQUIRED_SCREENSHOT_FILES = (
    *(f"screenshots/{name}.png" for name in REQUIRED_VIEWPORTS),
    "screenshots/webkit-mobile-390x844.png",
    "screenshots/fake-media-cleanup.png",
    "screenshots/webrtc-participant-a.png",
    "screenshots/webrtc-participant-b.png",
)
REQUIRED_TRACE_FILES = (
    "traces/mobile-390x844.zip",
    "traces/desktop-1366x768.zip",
)
SERVER_LOG_ALLOWED_FIELDS = {
    "timestamp",
    "level",
    "logger",
    "message",
    "result",
    "trace_id",
    "session_id",
    "room_id",
    "workspace_id",
    "participant_id",
    "connection_id",
    "event_name",
    "event_version",
    "error_code",
    "deployment_version",
    "duration_ms",
}
SERVER_LOG_REQUIRED_FIELDS = {"timestamp", "level", "logger", "message"}
FORBIDDEN_PATTERNS = {
    "raw reconnect token JSON field": re.compile(
        r'"reconnect_token"\s*:\s*"(?!\[REDACTED\]"(?:\s*[,}]))[^"\r\n]*"',
        re.IGNORECASE,
    ),
    "raw session token JSON field": re.compile(
        r'"session_token"\s*:\s*"(?!\[REDACTED\]"(?:\s*[,}]))[^"\r\n]*"',
        re.IGNORECASE,
    ),
    "SDP field": re.compile(r'"sdp"\s*:', re.IGNORECASE),
    "ICE candidate field": re.compile(r'"candidate"\s*:', re.IGNORECASE),
    "authorization bearer": re.compile(r"authorization\s*[:=]\s*bearer\s+(?!\[REDACTED\])[^\s]+", re.IGNORECASE),
    "API key": re.compile(r"api[_-]?key\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+", re.IGNORECASE),
    "password": re.compile(r"password\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+", re.IGNORECASE),
    "raw reconnect token assignment": re.compile(
        r"\breconnect[_-]?token\s*[:=]\s*(?!\[REDACTED\](?:[&\s,;\"']|$))[^&\s,;]+",
        re.IGNORECASE,
    ),
    "raw session token assignment": re.compile(
        r"\bsession[_-]?token\s*[:=]\s*(?!development-session(?:[&\s,;\"']|$)|\[REDACTED\](?:[&\s,;\"']|$))[^&\s,;]+",
        re.IGNORECASE,
    ),
    "raw reconnect query token": re.compile(
        r"(?:^|[?&])reconnect_token=(?!\[REDACTED\](?:[&\s\"']|$))[^&\s\"']+",
        re.IGNORECASE,
    ),
    "raw session query token": re.compile(
        r"(?:^|[?&])token=(?!development-session(?:[&\s\"']|$)|\[REDACTED\](?:[&\s\"']|$))[^&\s\"']+",
        re.IGNORECASE,
    ),
}


def _validate_server_log(path: Path, text: str) -> list[str]:
    errors: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            errors.append(f"non-JSON server log line {line_number} in {path}")
            continue
        if not isinstance(payload, dict):
            errors.append(f"server log line {line_number} is not a JSON object in {path}")
            continue
        missing = SERVER_LOG_REQUIRED_FIELDS - payload.keys()
        if missing:
            errors.append(f"server log line {line_number} is missing required fields in {path}")
        unexpected = payload.keys() - SERVER_LOG_ALLOWED_FIELDS
        if unexpected:
            errors.append(f"server log line {line_number} contains non-allowlisted fields in {path}")
    return errors


def _validate_build_identity(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [f"invalid build identity JSON in {path}"]
    if not isinstance(payload, dict):
        return [f"build identity is not a JSON object in {path}"]

    required = {
        "expected_pr_head",
        "checked_out_sha",
        "deployment_version",
        "github_event_name",
        "workflow_run_id",
    }
    errors: list[str] = []
    if required - payload.keys():
        errors.append(f"build identity is missing required fields in {path}")
        return errors

    expected_head = str(payload["expected_pr_head"])
    checked_out_sha = str(payload["checked_out_sha"])
    deployment_version = str(payload["deployment_version"])
    if checked_out_sha != expected_head:
        errors.append(f"checked-out SHA does not match expected head in {path}")
    if deployment_version != expected_head:
        errors.append(f"deployment version does not match expected head in {path}")

    environment_version = os.getenv("DEPLOYMENT_VERSION")
    if environment_version and checked_out_sha != environment_version:
        errors.append(f"checked-out SHA does not match DEPLOYMENT_VERSION in {path}")
    return errors


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/browser")
    if not root.exists():
        print(f"Browser artifact directory is missing: {root}")
        return 1

    required_groups = {
        "build identity": list(root.glob("build-identity.json")),
        "browser versions": list(root.glob("browser-versions.json")),
        "screenshots": list((root / "screenshots").glob("*.png")),
        "traces": list((root / "traces").glob("*.zip")),
        "evidence": list((root / "evidence").glob("*.json")),
        "JUnit": list(root.glob("junit.xml")),
        "server log": list(root.glob("server.log")),
    }
    errors = [f"missing required browser artifact group: {name}" for name, files in required_groups.items() if not files]
    for relative_path in (*REQUIRED_EVIDENCE_FILES, *REQUIRED_SCREENSHOT_FILES, *REQUIRED_TRACE_FILES):
        if not (root / relative_path).is_file():
            errors.append(f"missing required browser artifact: {relative_path}")

    identity_path = root / "build-identity.json"
    if identity_path.exists():
        errors.extend(_validate_build_identity(identity_path))

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if path.name == "server.log":
            errors.extend(_validate_server_log(path, text))
        for label, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"forbidden {label} in {path}")

    if errors:
        print("\n".join(errors))
        return 1
    print("Browser artifact privacy and completeness check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
