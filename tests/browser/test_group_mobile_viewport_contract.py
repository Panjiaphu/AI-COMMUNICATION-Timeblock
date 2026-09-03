from __future__ import annotations

import os
from pathlib import Path

import pytest


if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")


ROOT = Path(__file__).resolve().parents[2]
GROUP_CSS = (ROOT / "app/static/group-v3/group_v3.css").read_text(encoding="utf-8")
KEYBOARD_CSS = (
    ROOT / "app/static/group-v3/group_text_entry_keyboard_contract_v1.css"
).read_text(encoding="utf-8")
NAV_CSS = (
    ROOT / "app/static/group-v3/group_mobile_nav_pwa_contract_v1.css"
).read_text(encoding="utf-8")
VIEWPORT_JS = (
    ROOT / "app/static/group-v3/group_mobile_viewport_contract_v1.js"
).read_text(encoding="utf-8")


def _viewport_init_script() -> str:
    return r"""
      (() => {
        const listeners = {};
        const viewport = {
          height: 844,
          offsetTop: 0,
          pageTop: 0,
          addEventListener(name, callback) {
            (listeners[name] ||= new Set()).add(callback);
          },
          removeEventListener(name, callback) {
            listeners[name]?.delete(callback);
          },
          emit(name) {
            for (const callback of listeners[name] || []) callback();
          },
        };
        const nativeMatchMedia = window.matchMedia.bind(window);
        window.__groupViewportQa = {
          standalone: false,
          setViewport(patch) {
            Object.assign(viewport, patch);
            viewport.emit("resize");
          },
          setStandalone(value) {
            this.standalone = Boolean(value);
          },
        };
        Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
        window.matchMedia = (query) => {
          if (query === "(display-mode: standalone)") {
            const result = {
              media: query,
              addEventListener() {},
              removeEventListener() {},
            };
            Object.defineProperty(result, "matches", {
              get: () => window.__groupViewportQa.standalone,
            });
            return result;
          }
          return nativeMatchMedia(query);
        };
      })();
    """


def _fixture_html() -> str:
    return f"""
      <!doctype html>
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>{GROUP_CSS}</style><style>{KEYBOARD_CSS}</style><style>{NAV_CSS}</style></head>
      <body class="group-v3-body">
        <main id="group-native-app" class="group-native-app">
          <div class="native-app native-mobile">
            <header class="mobile-app-header"><strong>AI-COMMUNICATION</strong></header>
            <section class="native-main">
              <div class="session-strip"><span>ACTIVE</span></div>
              <header class="group-header"><strong>Group</strong></header>
              <div class="chat-content surface-content">
                <section class="thread-column">
                  <div class="thread-scroll"><p>Message</p></div>
                  <form class="composer"><span></span><div><textarea data-group-text-entry rows="1"></textarea></div><button type="button">Send</button></form>
                </section>
              </div>
            </section>
            <div class="mobile-language-bar"><button type="button">VI</button></div>
            <nav class="mobile-bottom-nav"><a href="#">Chat</a><button type="button">Call</button><button type="button">Video</button><button type="button">Radio</button></nav>
          </div>
        </main>
        <script>{_viewport_init_script()}</script>
        <script>{VIEWPORT_JS}</script>
      </body></html>
    """


@pytest.mark.parametrize("browser_fixture", ["chromium_browser", "webkit_browser"])
def test_group_mobile_nav_and_standalone_keyboard_geometry(browser_fixture, request):
    browser = request.getfixturevalue(browser_fixture)
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page = context.new_page()
    try:
        page.set_content(_fixture_html(), wait_until="load")
        page.wait_for_timeout(80)

        closed = page.locator("#group-native-app").evaluate(
            """root => {
              const nav = root.querySelector('.mobile-bottom-nav');
              const rect = nav.getBoundingClientRect();
              return {
                rootHeight: root.getBoundingClientRect().height,
                navPosition: getComputedStyle(nav).position,
                navBottom: rect.bottom,
                viewport: window.innerHeight,
                horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
              };
            }"""
        )
        assert closed["rootHeight"] == pytest.approx(844, abs=1)
        assert closed["navPosition"] == "fixed"
        assert closed["navBottom"] == pytest.approx(844, abs=1)
        assert closed["horizontalOverflow"] <= 1

        page.evaluate("window.__groupViewportQa.setStandalone(true); window.GroupMobileViewportContractV1.sync()")
        page.locator("textarea[data-group-text-entry]").focus()
        page.evaluate("window.__groupViewportQa.setViewport({height: 500})")
        page.wait_for_timeout(80)
        opened = page.evaluate(
            """() => ({
              keyboard: document.body.classList.contains('group-keyboard-open'),
              navDisplay: getComputedStyle(document.querySelector('.mobile-bottom-nav')).display,
              rootHeight: document.querySelector('#group-native-app').getBoundingClientRect().height,
              keyboardHeight: getComputedStyle(document.body).getPropertyValue('--group-keyboard-height').trim(),
            })"""
        )
        assert opened["keyboard"] is True
        assert opened["navDisplay"] == "none"
        assert opened["rootHeight"] == pytest.approx(500, abs=1)
        assert opened["keyboardHeight"] == "344px"

        page.locator("textarea[data-group-text-entry]").blur()
        page.wait_for_timeout(100)
        restored = page.evaluate(
            """() => ({
              keyboard: document.body.classList.contains('group-keyboard-open'),
              rootHeight: document.querySelector('#group-native-app').getBoundingClientRect().height,
              navDisplay: getComputedStyle(document.querySelector('.mobile-bottom-nav')).display,
              navBottom: document.querySelector('.mobile-bottom-nav').getBoundingClientRect().bottom,
            })"""
        )
        assert restored["keyboard"] is False
        assert restored["rootHeight"] == pytest.approx(844, abs=1)
        assert restored["navDisplay"] == "grid"
        assert restored["navBottom"] == pytest.approx(844, abs=1)
    finally:
        context.close()
