from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_manifest_uses_the_canonical_assistant_settings_entrypoints():
    manifest = json.loads((ROOT / "app/static/manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["id"] == "/"
    assert manifest["name"] == "Timeblock"
    assert manifest["start_url"] == "/assistant?mode=ai&entry=overview&source=pwa"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"
    assert {"192x192", "512x512"}.issubset({icon["sizes"] for icon in manifest["icons"]})
    shortcut_urls = {shortcut["url"] for shortcut in manifest["shortcuts"]}
    assert "/assistant?mode=messages&source=pwa" in shortcut_urls
    assert "/assistant?mode=alerts&source=pwa" in shortcut_urls
    assert "/app-settings?source=pwa" in shortcut_urls


def test_service_worker_caches_only_same_origin_static_assets_and_keeps_calls_network_first():
    worker = (ROOT / "app/static/service-worker.js").read_text(encoding="utf-8")
    assert "CORE_ASSETS" in worker
    assert "CALL_RUNTIME_ASSETS" in worker
    assert "cache.addAll(CORE_ASSETS)" in worker
    assert 'if (url.origin !== self.location.origin) return;' in worker
    assert 'url.pathname.startsWith("/static/")' in worker
    assert 'if (!isStaticAsset) return;' in worker
    assert 'CALL_RUNTIME_ASSETS.has(url.pathname)' in worker
    assert "session_token" not in worker
    assert "timeblock_token" not in worker
    assert "access_token" not in worker
    assert "localStorage" not in worker
    assert "sessionStorage" not in worker


def test_root_service_worker_entrypoint_is_available():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get('/service-worker.js')
    assert response.status_code == 200
    assert response.headers['Service-Worker-Allowed'] == '/'
    assert response.headers['Cache-Control'] == 'no-cache, no-store, must-revalidate'
    assert response.content == (ROOT / "app/static/service-worker.js").read_bytes()
    assert 'session_token' not in response.text


def test_static_manifest_entrypoint_serves_the_source_locked_manifest():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.get('/static/manifest.webmanifest')
    assert response.status_code == 200
    assert response.json()["start_url"] == "/assistant?mode=ai&entry=overview&source=pwa"
    assert response.content == (ROOT / "app/static/manifest.webmanifest").read_bytes()


def test_communication_template_exposes_pwa_reentry_and_no_chat_mock():
    template = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    assert 'rel="manifest"' in template
    assert 'id="pwa-session-card"' in template
    assert 'id="open-timeblock"' in template
    assert "chat-contract-card" in template
    assert "data-conversation" not in template
