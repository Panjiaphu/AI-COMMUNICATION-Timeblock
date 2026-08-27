from __future__ import annotations

from pathlib import Path
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.integrations.timeblock.client import TimeblockIntegrationError
from app.main import create_app
from scripts.check_env import main as check_env
from scripts.verify_assistant_source_lock import main as verify_source_lock


RENDER_BLUEPRINT = Path(__file__).resolve().parents[1] / "render.yaml"
BROWSER_WORKFLOW = (
    Path(__file__).resolve().parents[1]
    / ".github"
    / "workflows"
    / "communication-browser-qa.yml"
)


def _production_env(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "production-secret-key-with-at-least-32-bytes")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://guilua.onrender.com")
    monkeypatch.setenv("TIMEBLOCK_APP_URL", "https://timeblock.example")
    monkeypatch.setenv("ALLOW_DEVELOPMENT_SESSION_FALLBACK", "false")
    monkeypatch.setenv("RENDER_GIT_COMMIT", "a" * 40)


def test_production_environment_fails_closed_without_timeblock_contract_credentials(
    monkeypatch, capsys
):
    _production_env(monkeypatch)
    monkeypatch.delenv("TIMEBLOCK_API_URL", raising=False)
    monkeypatch.delenv("TIMEBLOCK_API_KEY", raising=False)

    assert check_env(["--phase", "runtime"]) == 1
    errors = capsys.readouterr().err
    assert "TIMEBLOCK_API_URL is required" in errors
    assert "TIMEBLOCK_API_KEY must contain at least 32 bytes" in errors


def test_production_environment_accepts_complete_contract_configuration(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.setenv("TIMEBLOCK_API_URL", "https://timeblock.example")
    monkeypatch.setenv("TIMEBLOCK_API_KEY", "server-contract-key-with-at-least-32-bytes")

    assert check_env(["--phase", "build"]) == 0


def test_production_environment_requires_exact_deploy_identity(monkeypatch, capsys):
    _production_env(monkeypatch)
    monkeypatch.setenv("TIMEBLOCK_API_URL", "https://timeblock.example")
    monkeypatch.setenv("TIMEBLOCK_API_KEY", "server-contract-key-with-at-least-32-bytes")
    monkeypatch.delenv("DEPLOYMENT_VERSION", raising=False)
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)

    assert check_env(["--phase", "build"]) == 1
    assert "exact 40-64 character hexadecimal deploy SHA" in capsys.readouterr().err


def test_settings_use_render_git_commit_as_deployment_version(monkeypatch):
    render_sha = "b" * 40
    monkeypatch.delenv("DEPLOYMENT_VERSION", raising=False)
    monkeypatch.setenv("RENDER_GIT_COMMIT", render_sha)

    settings = Settings(_env_file=None)

    assert settings.deployment_version == render_sha


def test_build_gate_verifies_every_source_locked_destination():
    assert verify_source_lock() == 0


def test_render_blueprint_targets_existing_fail_closed_service():
    blueprint = RENDER_BLUEPRINT.read_text(encoding="utf-8")

    assert "name: AI-COMMUNICATION-Timeblock" in blueprint
    assert "branch: main" in blueprint
    assert "autoDeployTrigger: off" in blueprint
    assert "plan: starter" in blueprint
    assert "healthCheckPath: /readyz/" in blueprint
    assert not re.search(r"^\s+value:\s+(?:true|false)\s*$", blueprint, re.MULTILINE)
    assert re.search(r"key: SECRET_KEY\s+sync: false", blueprint)
    assert re.search(r"key: TIMEBLOCK_API_KEY\s+sync: false", blueprint)


def test_browser_workflow_does_not_leak_development_fallback_into_production_tests():
    workflow = BROWSER_WORKFLOW.read_text(encoding="utf-8")

    assert re.search(
        r'name: Run default test suite\s+env:\s+BROWSER_QA_ENABLED: "0"\s+'
        r'ALLOW_DEVELOPMENT_SESSION_FALLBACK: "false"',
        workflow,
    )


def _readiness_settings() -> Settings:
    return Settings(
        app_env="test",
        debug=True,
        secret_key="readiness-test-key",
        public_base_url="http://testserver",
        timeblock_app_url="https://timeblock.example",
        timeblock_api_url="https://timeblock.example",
        timeblock_api_key="server-contract-key-with-at-least-32-bytes",
        allowed_websocket_origins="http://testserver",
        allowed_timeblock_handoff_origins="https://timeblock.example",
        deployment_version="c" * 40,
    )


def test_readiness_requires_timeblock_client_contract_v2():
    app = create_app(_readiness_settings())
    app.state.timeblock_client = SimpleNamespace(
        contract_capabilities=AsyncMock(
            return_value={
                "contract_version": "2",
                "authority": "timeblock",
                "capabilities": ["identity.read"],
            }
        )
    )
    with TestClient(app) as client:
        ready = client.get("/readyz/")

    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["contract_version"] == "2"
    assert ready.json()["deployment_version"] == "c" * 40


def test_readiness_is_503_when_timeblock_contract_is_unavailable():
    app = create_app(_readiness_settings())
    app.state.timeblock_client = SimpleNamespace(
        contract_capabilities=AsyncMock(
            side_effect=TimeblockIntegrationError("timeblock_contract_unavailable")
        )
    )
    with TestClient(app) as client:
        unavailable = client.get("/readyz/")

    assert unavailable.status_code == 503
    assert unavailable.json()["dependency"] == "timeblock_client_contract_v2"
