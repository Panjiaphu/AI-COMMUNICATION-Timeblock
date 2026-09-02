from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
PARENT_ORIGIN = "http://127.0.0.1:5055"
TARGET_ORIGIN = "http://127.0.0.1:5056"
HANDOFF_CODE = "h" * 64


def test_root_receiver_redeems_generic_handoff_and_enters_group_route():
    receiver = (ROOT / "app/static/js/group_handoff_root_receiver.js").read_text(
        encoding="utf-8"
    )
    parent_html = f"""<!doctype html>
<html><body>
  <button id="launch" type="button">launch</button>
  <script>
    let popup;
    window.addEventListener("message", (event) => {{
      if (event.source !== popup || event.origin !== "{TARGET_ORIGIN}") return;
      if (event.data?.type !== "timeblock.group.handoff.v3.ready") return;
      popup.postMessage({{
        type: "timeblock.group.handoff.v3",
        contract_version: "3",
        transport: "postmessage-memory",
        handoff_code: "{HANDOFF_CODE}",
        expires_at: new Date(Date.now() + 60000).toISOString()
      }}, event.origin);
    }});
    document.querySelector("#launch").addEventListener("click", () => {{
      popup = window.open("{TARGET_ORIGIN}/", "_blank");
    }});
  </script>
</body></html>"""
    target_config = json.dumps(
        {
            "group_handoff_event": "timeblock.group.handoff.v3",
            "group_handoff_contract_version": "3",
            "allowed_handoff_origins": [PARENT_ORIGIN],
        }
    )
    target_html = f"""<!doctype html>
<html><head>
  <script id="guilua-group-handoff-root-config" type="application/json">{target_config}</script>
  <script src="/static/js/group_handoff_root_receiver.js" defer></script>
</head><body>root receiver</body></html>"""
    received_request: dict[str, object] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(service_workers="block")

        def fulfill(route):
            request = route.request
            if request.url == f"{PARENT_ORIGIN}/":
                route.fulfill(status=200, content_type="text/html", body=parent_html)
            elif request.url == f"{TARGET_ORIGIN}/":
                route.fulfill(status=200, content_type="text/html", body=target_html)
            elif request.url == f"{TARGET_ORIGIN}/static/js/group_handoff_root_receiver.js":
                route.fulfill(status=200, content_type="application/javascript", body=receiver)
            elif request.url == f"{TARGET_ORIGIN}/api/group-handoff/v3/consume":
                received_request.update(request.post_data_json or {})
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "contract_version": "3",
                        "authority": "ai-communication",
                    }),
                )
            elif request.url == f"{TARGET_ORIGIN}/group":
                route.fulfill(status=200, content_type="text/html", body="<body data-group-entered=true></body>")
            else:
                route.continue_()

        context.route("**/*", fulfill)
        try:
            page = context.new_page()
            page.goto(f"{PARENT_ORIGIN}/")
            with page.expect_popup() as popup_info:
                page.locator("#launch").click()
            popup = popup_info.value
            popup.wait_for_url(f"{TARGET_ORIGIN}/group")
            assert popup.locator("body").get_attribute("data-group-entered") == "true"
            assert received_request == {
                "handoff_code": HANDOFF_CODE,
                "source_origin": PARENT_ORIGIN,
            }
            assert HANDOFF_CODE not in popup.url
        finally:
            context.close()
            browser.close()
