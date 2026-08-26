from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect

from tests.browser.support import create_context, install_instrumentation, observe_page, relevant_console_errors


def _authenticated_vendor_html(path: str) -> str:
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        app_env="test",
        debug=True,
        secret_key="browser-test-secret",
        public_base_url="http://testserver",
        timeblock_app_url="https://timeblock.example",
        allowed_websocket_origins="http://testserver",
        allowed_timeblock_handoff_origins="https://timeblock.example",
    )
    app = create_app(settings)
    app.state.timeblock_client = SimpleNamespace(
        client_get=AsyncMock(return_value={"usage": {"buckets": {}}}),
        revoke_guilua_session=AsyncMock(return_value={"ok": True}),
    )
    with TestClient(app, base_url="http://testserver") as client:
        session = app.state.bff_session_store.create_session(
            timeblock_token="browser-server-token",
            principal={"id": "browser-member", "type": "member", "role": "member"},
            scope=["assistant.read"],
            expires_at="2099-01-01T00:00:00+00:00",
        )
        client.cookies.set(settings.guilua_session_cookie, session.session_id)
        response = client.get(path)
    assert response.status_code == 200
    assert "browser-server-token" not in response.text
    return response.text


def _set_source_locked_content(page, html: str, base_url: str) -> None:
    document = html.replace("<head>", f'<head><base href="{base_url}/">', 1)
    page.set_content(document, wait_until="networkidle")


def _assert_viewport_containment(page, selector: str) -> None:
    geometry = page.eval_on_selector(
        selector,
        """element => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          };
        }""",
    )
    assert geometry["left"] >= -1
    assert geometry["right"] <= geometry["viewport"] + 1
    assert geometry["documentWidth"] <= geometry["viewport"] + 1


def test_assistant_root_and_deep_links_are_public_safe_entrypoints(chromium_browser, base_url: str):
    context = create_context(
        chromium_browser,
        base_url=base_url,
        viewport={"width": 390, "height": 844},
    )
    page = context.new_page()
    install_instrumentation(page)
    evidence = observe_page(page)
    try:
        for path in ("/", "/assistant", "/ai", "/translate", "/notifications"):
            page.goto(f"{base_url}{path}", wait_until="networkidle")
            expect(page).to_have_title("Timeblock AI Assistant")
            expect(page.locator(".assistant-auth-card")).to_be_visible()
            expect(page.locator("a[href='/api/session/start']").first).to_be_visible()
            assert "session_token" not in page.url
            assert "access_token" not in page.url
            assert "session_token" not in page.content()
        manifest = page.request.get(f"{base_url}/static/manifest.webmanifest")
        assert manifest.ok
        assert manifest.json()["start_url"] == "/assistant?source=pwa"
        worker = page.request.get(f"{base_url}/service-worker.js")
        assert worker.ok
        assert "localStorage" not in worker.text()
        assert "session_token" not in worker.text()
        assert not relevant_console_errors(evidence)
    finally:
        context.close()


def test_canonical_assistant_and_settings_are_contained_on_mobile_and_desktop(
    chromium_browser,
    base_url: str,
    artifact_dir,
):
    assistant_html = _authenticated_vendor_html("/assistant?lang=vi&mode=messages")
    settings_html = _authenticated_vendor_html("/app-settings?lang=vi")
    context = chromium_browser.new_context(
        viewport={"width": 390, "height": 844},
        base_url=base_url,
        java_script_enabled=False,
    )
    page = context.new_page()
    failed_static: list[tuple[int, str]] = []
    page.on(
        "response",
        lambda response: failed_static.append((response.status, response.url))
        if "/static/" in response.url and response.status >= 400
        else None,
    )
    try:
        for viewport in (
            {"width": 1440, "height": 900},
            {"width": 1366, "height": 768},
            {"width": 1024, "height": 1366},
            {"width": 768, "height": 1024},
            {"width": 430, "height": 932},
            {"width": 393, "height": 852},
            {"width": 390, "height": 844},
            {"width": 360, "height": 800},
        ):
            page.set_viewport_size(viewport)
            _set_source_locked_content(page, assistant_html, base_url)
            expect(page.locator("#assistant-app")).to_be_visible()
            expect(page.locator('[data-mode-tab="messages"]')).to_be_visible()
            _assert_viewport_containment(page, "#assistant-app")
            if viewport["width"] in {390, 1440}:
                page.screenshot(
                    path=artifact_dir / f"assistant-{viewport['width']}x{viewport['height']}.png",
                    full_page=True,
                )

            _set_source_locked_content(page, settings_html, base_url)
            expect(page.locator("#app-settings")).to_be_visible()
            expect(page.locator("[data-test-ringtone]")).to_be_visible()
            _assert_viewport_containment(page, "#app-settings")
            if viewport["width"] in {390, 1440}:
                page.screenshot(
                    path=artifact_dir / f"settings-{viewport['width']}x{viewport['height']}.png",
                    full_page=True,
                )

        assert not failed_static
    finally:
        context.close()
