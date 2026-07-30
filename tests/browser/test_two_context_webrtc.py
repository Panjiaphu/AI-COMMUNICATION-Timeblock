from __future__ import annotations

from pathlib import Path

import os
import pytest

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import expect

from tests.browser.support import (
    create_context,
    install_instrumentation,
    observe_page,
    relevant_console_errors,
    write_json,
)


def _url(base_url: str, participant: str) -> str:
    return (
        f"{base_url}/communication?session=browser-qa-session"
        f"&participant={participant}&token=development-session"
    )


def _last_event(snapshot: dict, event_name: str, direction: str = "inbound") -> dict:
    events = [event for event in snapshot[direction] if event["event_name"] == event_name]
    assert events, f"Missing {direction} event: {event_name}"
    return events[-1]


def test_two_context_fake_media_signaling_reconnect_and_cleanup(
    chromium_browser,
    base_url: str,
    artifact_dir: Path,
):
    contexts = []
    pages = {}
    evidence = {}
    try:
        for participant in ("participant-a", "participant-b"):
            context = create_context(
                chromium_browser,
                base_url=base_url,
                viewport={"width": 1024, "height": 768},
                grant_media=True,
            )
            contexts.append(context)
            page = context.new_page()
            install_instrumentation(page)
            pages[participant] = page
            evidence[participant] = observe_page(page)
            page.goto(_url(base_url, participant), wait_until="networkidle")

        page_a = pages["participant-a"]
        page_b = pages["participant-b"]
        page_a.locator("#start-call").click()
        expect(page_a.locator("#connection-label")).to_have_text("Connected")
        page_b.locator("#start-call").click()
        expect(page_b.locator("#connection-label")).to_have_text("Connected")

        for page in (page_a, page_b):
            page.wait_for_function(
                "window.__guiluaQa.snapshot().peer_states.some(peer => peer.connection_state === 'connected')",
                timeout=30_000,
            )
            page.wait_for_function(
                "document.getElementById('remote-video').srcObject?.getTracks().length >= 1",
                timeout=30_000,
            )
            expect(page.locator("#remote-placeholder")).not_to_be_visible()

        snapshot_a = page_a.evaluate("window.__guiluaQa.snapshot()")
        snapshot_b = page_b.evaluate("window.__guiluaQa.snapshot()")
        offer = _last_event(snapshot_a, "signaling.offer", "outbound")
        answer = _last_event(snapshot_b, "signaling.answer", "outbound")
        ice_a = _last_event(snapshot_a, "signaling.ice_candidate", "outbound")
        ice_b = _last_event(snapshot_b, "signaling.ice_candidate", "outbound")
        assert offer["target_participant_id"] == "participant-b"
        assert answer["target_participant_id"] == "participant-a"
        assert ice_a["target_participant_id"] == "participant-b"
        assert ice_b["target_participant_id"] == "participant-a"
        assert snapshot_a["peer_count"] == snapshot_b["peer_count"] == 1
        assert len(snapshot_a["remote_track_ids"]) == len(set(snapshot_a["remote_track_ids"]))
        assert len(snapshot_b["remote_track_ids"]) == len(set(snapshot_b["remote_track_ids"]))

        page_a.locator("#microphone-toggle").click()
        page_b.locator("#camera-toggle").click()
        assert any(
            track["kind"] == "audio" and track["enabled"] is False
            for track in page_a.evaluate("window.__guiluaQa.snapshot()")["local_video_tracks"]
        )
        assert any(
            track["kind"] == "video" and track["enabled"] is False
            for track in page_b.evaluate("window.__guiluaQa.snapshot()")["local_video_tracks"]
        )

        third_context = create_context(
            chromium_browser,
            base_url=base_url,
            viewport={"width": 430, "height": 932},
            grant_media=True,
        )
        contexts.append(third_context)
        page_c = third_context.new_page()
        install_instrumentation(page_c)
        evidence["participant-c"] = observe_page(page_c)
        page_c.goto(_url(base_url, "participant-c"), wait_until="networkidle")
        page_c.locator("#start-call").click()
        expect(page_c.locator("#connection-pill")).to_have_attribute("data-state", "failed", timeout=15_000)
        expect(page_c.locator("#call-error")).to_contain_text("room_full")
        assert page_a.evaluate("window.__guiluaQa.snapshot().peer_states[0].connection_state") == "connected"
        assert page_b.evaluate("window.__guiluaQa.snapshot().peer_states[0].connection_state") == "connected"

        before_reconnect = _last_event(
            page_a.evaluate("window.__guiluaQa.snapshot()"), "session.authorized"
        )["connection_id"]
        page_a.evaluate("window.__guiluaQa.closeLatestSocket()")
        expect(page_a.locator("#connection-label")).to_have_text("Reconnected", timeout=20_000)
        page_b.wait_for_function(
            "window.__guiluaQa.snapshot().inbound.some(event => event.event_name === 'participant.reconnected')",
            timeout=20_000,
        )
        after_snapshot_a = page_a.evaluate("window.__guiluaQa.snapshot()")
        after_authorized = _last_event(after_snapshot_a, "session.authorized")
        assert after_authorized["reconnected"] is True
        assert after_authorized["connection_id"] != before_reconnect
        assert after_authorized["participant_count"] == 2
        assert sum(peer["connection_state"] != "closed" for peer in after_snapshot_a["peer_states"]) == 1
        page_a.wait_for_function(
            "window.__guiluaQa.snapshot().peer_states.some(peer => peer.connection_state === 'connected')",
            timeout=30_000,
        )
        page_b.wait_for_function(
            "window.__guiluaQa.snapshot().peer_states.some(peer => peer.connection_state === 'connected')",
            timeout=30_000,
        )
        after_snapshot_b = page_b.evaluate("window.__guiluaQa.snapshot()")
        assert sum(peer["connection_state"] != "closed" for peer in after_snapshot_b["peer_states"]) == 1

        screenshot_dir = artifact_dir / "screenshots"
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        page_a.screenshot(path=str(screenshot_dir / "webrtc-participant-a.png"))
        page_b.screenshot(path=str(screenshot_dir / "webrtc-participant-b.png"))

        page_a.locator("#end-call").click()
        expect(page_a.locator("#connection-label")).to_have_text("Ended")
        page_b.wait_for_function(
            "window.__guiluaQa.snapshot().inbound.some(event => event.event_name === 'participant.left')",
            timeout=15_000,
        )
        page_b.locator("#end-call").click()
        expect(page_b.locator("#connection-label")).to_have_text("Ended")

        for participant, page in (("participant-a", page_a), ("participant-b", page_b)):
            page.wait_for_function(
                "window.__guiluaQa.snapshot().local_track_states.every(track => track.ready_state === 'ended')",
                timeout=10_000,
            )
            final_snapshot = page.evaluate("window.__guiluaQa.snapshot()")
            assert final_snapshot["local_video_tracks"] == []
            assert final_snapshot["remote_video_tracks"] == []
            assert final_snapshot["peer_states"]
            assert all(peer["connection_state"] == "closed" for peer in final_snapshot["peer_states"])
            write_json(
                artifact_dir / "evidence" / f"webrtc-{participant}.json",
                {"snapshot": final_snapshot, "console": evidence[participant]},
            )
            assert relevant_console_errors(evidence[participant]) == []

        write_json(
            artifact_dir / "evidence" / "webrtc-participant-c.json",
            {"snapshot": page_c.evaluate("window.__guiluaQa.snapshot()"), "console": evidence["participant-c"]},
        )
        assert relevant_console_errors(evidence["participant-c"]) == []
    finally:
        for context in reversed(contexts):
            context.close()
