from __future__ import annotations

import os

import pytest

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect

from tests.browser.support import create_context, install_instrumentation, observe_page, relevant_console_errors


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
        for path in ("/", "/ai", "/translate", "/notifications"):
            page.goto(f"{base_url}{path}", wait_until="networkidle")
            expect(page).to_have_title("Timeblock AI Assistant")
            expect(page.locator(".assistant-auth-card")).to_be_visible()
            expect(page.locator("a[href='/api/session/start']").first).to_be_visible()
            assert "session_token" not in page.url
            assert "access_token" not in page.url
            assert "session_token" not in page.content()
        manifest = page.request.get(f"{base_url}/static/manifest.webmanifest")
        assert manifest.ok
        assert manifest.json()["start_url"] == "/?source=pwa"
        worker = page.request.get(f"{base_url}/service-worker.js")
        assert worker.ok
        assert "localStorage" not in worker.text()
        assert "session_token" not in worker.text()
        assert not relevant_console_errors(evidence)
    finally:
        context.close()
