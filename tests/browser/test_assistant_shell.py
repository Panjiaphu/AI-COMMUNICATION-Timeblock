from __future__ import annotations

import os
import re
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


def _without_runtime_scripts(html: str) -> str:
    return re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.IGNORECASE | re.DOTALL)


def _show_enhanced_message_composer(page, *, mobile: bool) -> None:
    page.eval_on_selector(
        "#assistant-panel-messages",
        """(panel, mobile) => {
          panel.hidden = false;
          panel.classList.add("is-active");
          if (mobile) document.body.classList.add("timeblock-mobile-immersive-conversation");
          else panel.dataset.enterpriseLayoutMode = "two";
          panel.querySelector(".assistant-messages-layout")?.classList.add("has-thread");
          const form = panel.querySelector("[data-message-form]");
          form.hidden = false;
          const box = form.querySelector(".assistant-composer-box");
          const originalAttachment = box.querySelector("[data-message-file]")?.closest("label");
          if (originalAttachment) originalAttachment.hidden = true;
          const attachments = document.createElement("div");
          attachments.className = "messaging-composer-v2";
          attachments.innerHTML = '<button class="messaging-composer-v2-add" type="button">+</button>';
          box.prepend(attachments);
          const voice = document.createElement("button");
          voice.className = "assistant-icon-button messaging-enterprise-voice-button";
          voice.type = "button";
          voice.textContent = "MIC";
          attachments.after(voice);
        }""",
        mobile,
    )


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


def test_assistant_navigation_popovers_and_mobile_nav_stay_in_their_layout_bounds(
    chromium_browser,
    base_url: str,
):
    assistant_html = _without_runtime_scripts(
        _authenticated_vendor_html("/assistant?lang=vi&mode=messages")
    )
    settings_html = _without_runtime_scripts(_authenticated_vendor_html("/app-settings?lang=vi"))
    context = chromium_browser.new_context(
        viewport={"width": 1920, "height": 900},
        base_url=base_url,
        java_script_enabled=False,
    )
    page = context.new_page()
    try:
        _set_source_locked_content(page, assistant_html, base_url)
        page.locator(".tbv2-primary-nav details").nth(1).evaluate(
            "element => { element.open = true; }"
        )
        desktop_geometry = page.locator(".tbv2-mega-menu").evaluate(
            """element => {
              const header = document.querySelector('.tbv2-header').getBoundingClientRect();
              const menu = element.getBoundingClientRect();
              const styles = getComputedStyle(element);
              return {
                headerHeight: header.height,
                menuPosition: styles.position,
                menuTop: menu.top,
                menuLeft: menu.left,
                menuRight: menu.right,
                viewport: window.innerWidth,
                documentWidth: document.documentElement.scrollWidth,
              };
            }"""
        )
        assert desktop_geometry["menuPosition"] == "fixed"
        assert desktop_geometry["menuTop"] >= desktop_geometry["headerHeight"]
        assert desktop_geometry["menuLeft"] >= -1
        assert desktop_geometry["menuRight"] <= desktop_geometry["viewport"] + 1
        assert desktop_geometry["documentWidth"] <= desktop_geometry["viewport"] + 1

        page.set_viewport_size({"width": 390, "height": 844})
        _set_source_locked_content(page, settings_html, base_url)
        page.locator(".tbv2-mobile-services").evaluate(
            "element => { element.open = true; }"
        )
        mobile_geometry = page.locator(".tbv2-mobile-sheet").evaluate(
            """element => {
              const sheet = element.getBoundingClientRect();
              const bottomNav = document.querySelector('.tbv2-bottom-nav').getBoundingClientRect();
              const styles = getComputedStyle(element);
              const bottomStyles = getComputedStyle(document.querySelector('.tbv2-bottom-nav'));
              return {
                sheetPosition: styles.position,
                sheetLeft: sheet.left,
                sheetRight: sheet.right,
                bottomNavPosition: bottomStyles.position,
                bottomNavLeft: bottomNav.left,
                bottomNavRight: bottomNav.right,
                viewport: window.innerWidth,
                documentWidth: document.documentElement.scrollWidth,
              };
            }"""
        )
        assert mobile_geometry["sheetPosition"] == "fixed"
        assert mobile_geometry["sheetLeft"] >= -1
        assert mobile_geometry["sheetRight"] <= mobile_geometry["viewport"] + 1
        assert mobile_geometry["bottomNavPosition"] == "fixed"
        assert mobile_geometry["bottomNavLeft"] >= -1
        assert mobile_geometry["bottomNavRight"] <= mobile_geometry["viewport"] + 1
        assert mobile_geometry["documentWidth"] <= mobile_geometry["viewport"] + 1
    finally:
        context.close()


@pytest.mark.parametrize(
    ("viewport", "minimum_input_width"),
    [
        ({"width": 1440, "height": 900}, 420),
        ({"width": 390, "height": 844}, 160),
    ],
)
def test_enhanced_message_composer_keeps_a_writable_flexible_input_column(
    chromium_browser,
    base_url: str,
    artifact_dir,
    viewport: dict[str, int],
    minimum_input_width: int,
):
    assistant_html = _without_runtime_scripts(
        _authenticated_vendor_html("/assistant?lang=vi&mode=messages")
    )
    context = chromium_browser.new_context(viewport=viewport, base_url=base_url)
    page = context.new_page()
    try:
        _set_source_locked_content(page, assistant_html, base_url)
        _show_enhanced_message_composer(page, mobile=viewport["width"] <= 760)

        composer = page.locator("#assistant-message-input")
        composer.fill("Kiểm tra vùng nhập")
        expect(composer).to_have_value("Kiểm tra vùng nhập")

        geometry = composer.evaluate(
            """element => {
              const rect = element.getBoundingClientRect();
              const box = element.closest(".assistant-composer-box");
              const styles = getComputedStyle(box);
              return {
                width: rect.width,
                height: rect.height,
                gridColumns: styles.gridTemplateColumns.split(" ").filter(Boolean).length,
                hitTargetIsInput: document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                ) === element,
              };
            }"""
        )
        assert geometry["gridColumns"] == 4
        assert geometry["width"] >= minimum_input_width
        assert geometry["height"] >= 38
        assert geometry["hitTargetIsInput"] is True
        page.screenshot(
            path=artifact_dir / f"message-composer-{viewport['width']}x{viewport['height']}.png",
            full_page=False,
        )
    finally:
        context.close()
