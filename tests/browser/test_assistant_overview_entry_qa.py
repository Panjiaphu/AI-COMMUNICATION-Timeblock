from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect

from tests.browser.test_assistant_shell import _authenticated_vendor_html


def _install_standalone_mode(context) -> None:
    context.add_init_script(
        """
        (() => {
          const nativeMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = query => {
            const media = nativeMatchMedia(query);
            if (query === '(display-mode: standalone)') {
              Object.defineProperty(media, 'matches', {
                configurable: true,
                value: true,
              });
            }
            return media;
          };
          Object.defineProperty(window.navigator, 'standalone', {
            configurable: true,
            get: () => true,
          });
        })();
        """
    )


def _assert_overview(page, *, standalone: bool) -> None:
    state = page.evaluate(
        """
        () => ({
          active: document.body.classList.contains('assistant-ai-conversation-active'),
          pwa: document.body.classList.contains('assistant-pwa-standalone'),
          readOnly: document.querySelector('[data-ai-input]')?.readOnly,
          overflowFree: document.documentElement.scrollWidth <= window.innerWidth,
        })
        """
    )
    query = parse_qs(urlparse(page.url).query)
    assert query["mode"] == ["ai"], page.url
    assert query["entry"] == ["overview"], page.url
    assert state["active"] is False, state
    assert state["pwa"] is standalone, state
    assert state["readOnly"] is (not standalone), state
    assert state["overflowFree"] is True, state


def _open_source_locked_page(page, base_url: str, html: str) -> None:
    page.route(
        "**/assistant?*",
        lambda route: route.fulfill(
            status=200,
            content_type="text/html; charset=utf-8",
            body=html,
        ),
    )
    page.goto(
        f"{base_url}/assistant?lang=en&mode=ai&entry=overview",
        wait_until="networkidle",
    )
    expect(page.locator("#assistant-app")).to_be_visible()
    expect(page.locator("[data-ai-input]")).to_be_visible()


def test_guilua_mirrored_assistant_overview_requires_explicit_mobile_input_click(
    chromium_browser,
    base_url: str,
):
    html = _authenticated_vendor_html("/assistant?lang=en&mode=ai&entry=overview")

    browser_context = chromium_browser.new_context(
        viewport={"width": 390, "height": 844},
        base_url=base_url,
    )
    page = browser_context.new_page()
    try:
        _open_source_locked_page(page, base_url, html)
        _assert_overview(page, standalone=False)
        page.locator("[data-ai-input]").click()
        page.wait_for_function(
            "document.body.classList.contains('assistant-ai-conversation-active')"
        )
        assert page.locator("[data-ai-input]").is_editable()
    finally:
        browser_context.close()


def test_guilua_mirrored_assistant_standalone_overview_requires_explicit_input_click(
    chromium_browser,
    base_url: str,
):
    html = _authenticated_vendor_html("/assistant?lang=en&mode=ai&entry=overview")

    browser_context = chromium_browser.new_context(
        viewport={"width": 390, "height": 844},
        base_url=base_url,
    )
    _install_standalone_mode(browser_context)
    page = browser_context.new_page()
    try:
        _open_source_locked_page(page, base_url, html)
        _assert_overview(page, standalone=True)
        page.locator("[data-ai-input]").click()
        page.wait_for_function(
            "document.body.classList.contains('assistant-ai-conversation-active')"
        )
        assert page.locator("[data-ai-input]").is_editable()
    finally:
        browser_context.close()
