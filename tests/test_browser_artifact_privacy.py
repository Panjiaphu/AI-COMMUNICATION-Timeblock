from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from scripts.check_browser_artifacts import (
    FORBIDDEN_PATTERNS,
    REQUIRED_EVIDENCE_FILES,
    REQUIRED_SCREENSHOT_FILES,
    REQUIRED_TRACE_FILES,
    main,
)


def _matches(text: str) -> set[str]:
    return {name for name, pattern in FORBIDDEN_PATTERNS.items() if pattern.search(text)}


def _json_line(**extra) -> str:
    return json.dumps(
        {
            "timestamp": "2026-07-31T00:00:00+00:00",
            "level": "INFO",
            "logger": "gunicorn.error",
            "message": "synthetic",
            **extra,
        }
    )


def _seed(
    root: Path,
    server_line: str,
    *,
    expected: str = "a" * 40,
    checked_out: str | None = None,
    deployed: str | None = None,
) -> None:
    checked_out = checked_out or expected
    deployed = deployed or expected
    (root / "screenshots").mkdir(parents=True)
    (root / "traces").mkdir()
    (root / "evidence").mkdir()
    (root / "build-identity.json").write_text(
        json.dumps(
            {
                "expected_pr_head": expected,
                "checked_out_sha": checked_out,
                "deployment_version": deployed,
                "github_event_name": "pull_request",
                "workflow_run_id": "123",
            }
        ),
        encoding="utf-8",
    )
    (root / "browser-versions.json").write_text("{}", encoding="utf-8")
    for relative_path in REQUIRED_SCREENSHOT_FILES:
        (root / relative_path).write_bytes(b"synthetic")
    for relative_path in REQUIRED_TRACE_FILES:
        (root / relative_path).write_bytes(b"synthetic")
    for relative_path in REQUIRED_EVIDENCE_FILES:
        (root / relative_path).write_text("{}", encoding="utf-8")
    (root / "junit.xml").write_text("<testsuite/>", encoding="utf-8")
    (root / "server.log").write_text(server_line + "\n", encoding="utf-8")


def _run(root: Path, monkeypatch: pytest.MonkeyPatch, deployment: str | None = None) -> int:
    monkeypatch.setattr(sys, "argv", ["check_browser_artifacts.py", str(root)])
    if deployment:
        monkeypatch.setenv("DEPLOYMENT_VERSION", deployment)
    return main()


def test_token_patterns_allow_only_development_or_redacted_values():
    for safe in (
        "?token=development-session",
        "?token=[REDACTED]",
        "?reconnect_token=[REDACTED]&token=development-session",
        "session_token=[REDACTED] reconnect_token=[REDACTED]",
    ):
        assert _matches(safe) == set()

    sample = "sample-unsafe-value"
    assert "raw session query token" in _matches(f"?token={sample}")
    assert "raw reconnect query token" in _matches(f"?reconnect_token={sample}")
    assert "raw session token assignment" in _matches(f"session_token={sample}")
    assert "raw reconnect token assignment" in _matches(f"reconnect_token={sample}")


def test_gate_accepts_exact_identity_and_json_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "browser"
    root.mkdir()
    _seed(root, _json_line())
    assert _run(root, monkeypatch, "a" * 40) == 0


@pytest.mark.parametrize(
    ("server_line", "checked_out", "deployed", "expected_error"),
    [
        ("[INFO] Starting gunicorn", None, None, "non-JSON server log line 1"),
        (_json_line(unexpected="value"), None, None, "non-allowlisted fields"),
        (_json_line(), "b" * 40, None, "checked-out SHA does not match expected head"),
        (_json_line(), None, "c" * 40, "deployment version does not match expected head"),
    ],
)
def test_gate_rejects_invalid_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    server_line: str,
    checked_out: str | None,
    deployed: str | None,
    expected_error: str,
):
    root = tmp_path / "browser"
    root.mkdir()
    _seed(root, server_line, checked_out=checked_out, deployed=deployed)
    assert _run(root, monkeypatch) == 1
    assert expected_error in capsys.readouterr().out


def test_gate_rejects_missing_required_trace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    root = tmp_path / "browser"
    root.mkdir()
    _seed(root, _json_line())
    missing = REQUIRED_TRACE_FILES[0]
    (root / missing).unlink()
    assert _run(root, monkeypatch) == 1
    assert f"missing required browser artifact: {missing}" in capsys.readouterr().out
