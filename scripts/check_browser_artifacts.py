from __future__ import annotations

import re
import sys
from pathlib import Path

TEXT_SUFFIXES = {".json", ".log", ".txt", ".xml"}
FORBIDDEN_PATTERNS = {
    "reconnect token field": re.compile(r'"reconnect_token"\s*:', re.IGNORECASE),
    "SDP field": re.compile(r'"sdp"\s*:', re.IGNORECASE),
    "ICE candidate field": re.compile(r'"candidate"\s*:', re.IGNORECASE),
    "authorization bearer": re.compile(r"authorization\s*[:=]\s*bearer\s+(?!\[REDACTED\])[^\s]+", re.IGNORECASE),
    "API key": re.compile(r"api[_-]?key\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+", re.IGNORECASE),
    "password": re.compile(r"password\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+", re.IGNORECASE),
    "raw query token": re.compile(
        r"(?:^|[?&])(?:reconnect_)?token=(?!development-session(?:[&\s\"']|$)|\[REDACTED\](?:[&\s\"']|$))[^&\s\"']+",
        re.IGNORECASE,
    ),
}


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/browser")
    if not root.exists():
        print(f"Browser artifact directory is missing: {root}")
        return 1

    required_groups = {
        "browser versions": list(root.glob("browser-versions.json")),
        "screenshots": list((root / "screenshots").glob("*.png")),
        "evidence": list((root / "evidence").glob("*.json")),
        "JUnit": list(root.glob("junit.xml")),
    }
    errors = [f"missing required browser artifact group: {name}" for name, files in required_groups.items() if not files]

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"forbidden {label} in {path}")

    if errors:
        print("\n".join(errors))
        return 1
    print("Browser artifact privacy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
