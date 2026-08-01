from __future__ import annotations

from pathlib import Path

import os
import pytest

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect

from tests.browser.support import (
    boxes_intersect,
    create_context,
    install_instrumentation,
    observe_page,
    relevant_console_errors,
    write_json,
)

VIEWPORTS = [
    ("mobile-390x844", {"width": 390, "height": 844}),
    ("mobile-landscape-844x390", {"width": 844, "height": 390}),
    ("mobile-430x932", {"width": 430, "height": 932}),
    ("mobile-landscape-932x430", {"width": 932, "height": 430}),
    ("tablet-768x1024", {"width": 768, "height": 1024}),
    ("tablet-landscape-1024x768", {"width": 1024, "height": 768}),
    ("desktop-1366x768", {"width": 1366, "height": 768}),
    ("desktop-1440x900", {"width": 1440, "height": 900}),
]


def _inside_viewport(box: dict[str, float], viewport: dict[str, int], tolerance: float = 1.0) -> bool:
    return (
        box["x"] >= -tolerance
        and box["y"] >= -tolerance
        and box["x"] + box["width"] <= viewport["width"] + tolerance
        and box["y"] + box["height"] <= viewport["height"] + tolerance
    )


@pytest.mark.parametrize(("name", "viewport"), VIEWPORTS)
def test_responsive_surface_and_interpreter_states(
    chromium_browser,
    base_url: str,
    artifact_dir: Path,
    name: str,
    viewport: dict[str, int],
):
    context = create_context(chromium_browser, base_url=base_url, viewport=viewport)
    trace_enabled = name in {"mobile-390x844", "desktop-1366x768"}
    if trace_enabled:
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
    page = context.new_page()
    install_instrumentation(page)
    evidence = observe_page(page)
    try:
        page.goto(
            f"{base_url}/communication?session=browser-ui-{name}&participant=ui-{name}&token=development-session",
            wait_until="networkidle",
        )
        expect(page).to_have_title("Timeblock AI Communication")
        for selector in (
            "#connection-pill",
            "#remote-video",
            "#local-video",
            "#translated-caption",
            "#interpreter-panel",
            "#source-language",
            "#target-language",
            "#start-call",
            "#microphone-toggle",
            "#camera-toggle",
            "#end-call",
            "#call-error",
        ):
            expect(page.locator(selector)).to_be_attached()

        page.evaluate(
            "([sourceText, translatedText]) => window.__guiluaQa.setSyntheticCaptions(sourceText, translatedText)",
            [
                "Đây là nội dung nguồn tổng hợp nhiều dòng để kiểm tra khả năng xuống dòng trong bảng phiên dịch.",
                "Đây là bản dịch tổng hợp nhiều dòng để xác minh caption không che bảng phiên dịch hoặc điều khiển cuộc gọi.",
            ],
        )
        expect(page.locator("#translated-caption")).to_be_visible()
        expect(page.locator("#interpreter-panel")).to_be_visible()
        expect(page.locator(".call-controls")).to_be_visible()

        metrics = page.evaluate(
            """() => ({
              width: window.innerWidth,
              height: window.innerHeight,
              scrollWidth: document.documentElement.scrollWidth,
              scrollHeight: document.documentElement.scrollHeight
            })"""
        )
        assert metrics["scrollWidth"] <= metrics["width"] + 1

        caption_box = page.locator("#translated-caption").bounding_box()
        panel_box = page.locator("#interpreter-panel").bounding_box()
        controls_box = page.locator(".call-controls").bounding_box()
        local_box = page.locator(".local-frame").bounding_box()
        remote_box = page.locator(".remote-frame").bounding_box()
        assert caption_box and panel_box and controls_box and local_box and remote_box
        inside_viewport_results = {
            "controls": _inside_viewport(controls_box, viewport),
            "caption": _inside_viewport(caption_box, viewport),
            "panel": _inside_viewport(panel_box, viewport),
            "local_preview": _inside_viewport(local_box, viewport),
            "remote_frame": _inside_viewport(remote_box, viewport),
        }
        intersection_results = {
            "caption_controls": boxes_intersect(caption_box, controls_box),
            "caption_panel": boxes_intersect(caption_box, panel_box),
            "caption_local_preview": boxes_intersect(caption_box, local_box),
            "local_preview_controls": boxes_intersect(local_box, controls_box),
            "panel_controls": boxes_intersect(panel_box, controls_box),
        }
        assert inside_viewport_results["controls"]
        assert inside_viewport_results["caption"]
        assert inside_viewport_results["panel"]
        assert inside_viewport_results["local_preview"]
        assert inside_viewport_results["remote_frame"]
        assert not intersection_results["caption_controls"]
        assert not intersection_results["caption_panel"]
        assert not intersection_results["caption_local_preview"]
        assert not intersection_results["local_preview_controls"]
        assert not intersection_results["panel_controls"]

        collapse = page.locator("#panel-collapse")
        collapse.click()
        expect(collapse).to_have_attribute("aria-expanded", "false")
        expect(page.locator("#interpreter-content")).not_to_be_visible()
        expect(page.locator("#translated-caption")).to_be_visible()
        expect(page.locator(".call-controls")).to_be_visible()

        collapse.click()
        expect(collapse).to_have_attribute("aria-expanded", "true")
        expect(page.locator("#interpreter-content")).to_be_visible()

        page.locator("#panel-hide").click()
        expect(page.locator("#interpreter-panel")).not_to_be_visible()
        expect(page.locator("#panel-restore")).to_be_visible()
        assert page.evaluate("document.activeElement?.id") == "panel-restore"
        expect(page.locator("#translated-caption")).to_be_visible()

        page.locator("#panel-restore").click()
        expect(page.locator("#interpreter-panel")).to_be_visible()
        expect(page.locator("#panel-collapse")).to_be_focused()
        expect(page.locator("#panel-collapse")).to_have_attribute("aria-expanded", "true")

        for _ in range(8):
            page.keyboard.press("Tab")
            if page.evaluate("document.activeElement?.id") == "start-call":
                break
        expect(page.locator("#start-call")).to_be_focused()
        outline = page.locator("#start-call").evaluate(
            "element => ({style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth})"
        )
        assert outline["style"] != "none" and outline["width"] != "0px"

        screenshot = artifact_dir / "screenshots" / f"{name}.png"
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=False)
        write_json(
            artifact_dir / "evidence" / f"{name}.json",
            {
                "viewport": viewport,
                "metrics": metrics,
                "caption_box": caption_box,
                "panel_box": panel_box,
                "controls_box": controls_box,
                "local_box": local_box,
                "remote_box": remote_box,
                "horizontal_overflow": metrics["scrollWidth"] > metrics["width"] + 1,
                "all_inside_viewport_results": inside_viewport_results,
                "all_intersection_results": intersection_results,
                "console": evidence,
                "physical_device": False,
            },
        )
        assert relevant_console_errors(evidence) == []
    finally:
        if trace_enabled:
            trace_path = artifact_dir / "traces" / f"{name}.zip"
            trace_path.parent.mkdir(parents=True, exist_ok=True)
            context.tracing.stop(path=str(trace_path))
        context.close()


def test_webkit_mobile_surface(webkit_browser, base_url: str, artifact_dir: Path):
    viewport = {"width": 390, "height": 844}
    context = create_context(webkit_browser, base_url=base_url, viewport=viewport)
    page = context.new_page()
    evidence = observe_page(page)
    try:
        page.goto(
            f"{base_url}/communication?session=webkit-mobile&participant=webkit-a&token=development-session",
            wait_until="networkidle",
        )
        expect(page.locator("#interpreter-panel")).to_be_visible()
        expect(page.locator(".call-controls")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1") is True
        screenshot = artifact_dir / "screenshots" / "webkit-mobile-390x844.png"
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot))
        assert relevant_console_errors(evidence) == []
    finally:
        context.close()


def test_fake_media_permission_granted_and_cleanup(chromium_browser, base_url: str, artifact_dir: Path):
    context = create_context(
        chromium_browser,
        base_url=base_url,
        viewport={"width": 1366, "height": 768},
        grant_media=True,
    )
    page = context.new_page()
    install_instrumentation(page)
    evidence = observe_page(page)
    try:
        page.goto(
            f"{base_url}/communication?session=media-granted&participant=media-a&token=development-session",
            wait_until="networkidle",
        )
        page.locator("#start-call").click()
        page.wait_for_function("window.__guiluaQa.snapshot().local_video_tracks.length === 2")
        expect(page.locator("#connection-label")).to_have_text("Connected")
        expect(page.locator("#microphone-toggle")).to_be_enabled()
        expect(page.locator("#camera-toggle")).to_be_enabled()
        expect(page.locator("#end-call")).to_be_enabled()

        page.locator("#microphone-toggle").click()
        page.locator("#camera-toggle").click()
        toggled = page.evaluate("window.__guiluaQa.snapshot()")
        assert any(track["kind"] == "audio" and track["enabled"] is False for track in toggled["local_video_tracks"])
        assert any(track["kind"] == "video" and track["enabled"] is False for track in toggled["local_video_tracks"])

        page.locator("#end-call").click()
        expect(page.locator("#connection-label")).to_have_text("Ended")
        page.wait_for_function(
            "window.__guiluaQa.snapshot().local_track_states.length === 2 && window.__guiluaQa.snapshot().local_track_states.every(track => track.ready_state === 'ended')"
        )
        snapshot = page.evaluate("window.__guiluaQa.snapshot()")
        assert snapshot["local_video_tracks"] == []
        assert all(state in (2, 3) for state in snapshot["websocket_states"])
        screenshot = artifact_dir / "screenshots" / "fake-media-cleanup.png"
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot))
        write_json(artifact_dir / "evidence" / "fake-media-granted.json", {"snapshot": snapshot, "console": evidence})
        assert relevant_console_errors(evidence) == []
    finally:
        context.close()


def test_synthetic_permission_denied_is_recoverable(chromium_browser, base_url: str, artifact_dir: Path):
    context = create_context(chromium_browser, base_url=base_url, viewport={"width": 430, "height": 932})
    page = context.new_page()
    install_instrumentation(page, deny_media=True)
    evidence = observe_page(page)
    try:
        page.goto(
            f"{base_url}/communication?session=media-denied&participant=media-denied&token=development-session",
            wait_until="networkidle",
        )
        page.locator("#start-call").click()
        expect(page.locator("#call-error")).to_contain_text("NotAllowedError")
        expect(page.locator("#connection-pill")).to_have_attribute("data-state", "degraded")
        expect(page.locator("#start-call")).to_be_enabled()
        snapshot = page.evaluate("window.__guiluaQa.snapshot()")
        assert snapshot["websocket_count"] == 0
        write_json(artifact_dir / "evidence" / "permission-denied.json", {"snapshot": snapshot, "console": evidence})
        assert relevant_console_errors(evidence) == []
    finally:
        context.close()
