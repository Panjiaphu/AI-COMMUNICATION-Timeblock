from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_manifest_has_unique_timeblock_ai_identity_and_safe_entrypoint():
    manifest = json.loads((ROOT / "app/static/manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["id"] == "/"
    assert manifest["start_url"] == "/?source=pwa"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"
    assert {"192x192", "512x512"}.issubset({icon["sizes"] for icon in manifest["icons"]})


def test_service_worker_caches_only_static_shell_assets():
    worker = (ROOT / "app/static/service-worker.js").read_text(encoding="utf-8")
    assert "caches.addAll(STATIC_ASSETS)" not in worker
    assert "STATIC_ASSETS" in worker
    assert 'url.pathname.startsWith("/static/")' in worker
    assert "/api/" not in worker
    assert "session_token" not in worker
    assert "localStorage" not in worker
    assert "sessionStorage" not in worker


def test_root_service_worker_entrypoint_is_available():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get('/service-worker.js')
    assert response.status_code == 200
    assert response.headers['Service-Worker-Allowed'] == '/'
    assert 'session_token' not in response.text


def test_communication_template_exposes_pwa_reentry_and_no_chat_mock():
    template = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    assert 'rel="manifest"' in template
    assert 'id="pwa-session-card"' in template
    assert 'id="open-timeblock"' in template
    assert "chat-contract-card" in template
    assert "data-conversation" not in template
