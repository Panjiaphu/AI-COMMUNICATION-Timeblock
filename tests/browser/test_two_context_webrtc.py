from __future__ import annotations

from pathlib import Path

import os
import pytest

if os.getenv("BROWSER_QA_ENABLED") != "1":
    pytest.skip("Browser QA is isolated from the default pytest suite.", allow_module_level=True)

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import Page, expect

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


def _wait_for_usable_remote_media(page: Page) -> dict:
    page.wait_for_function(
        """() => {
          const snapshot = window.__guiluaQa.snapshot();
          const liveAudio = snapshot.remote_video_tracks.filter(
            track => track.kind === 'audio' && track.ready_state === 'live'
          );
          const liveVideo = snapshot.remote_video_tracks.filter(
            track => track.kind === 'video' && track.ready_state === 'live'
          );
          return snapshot.active_non_closed_peer_count === 1
            && liveAudio.length === 1
            && liveVideo.length === 1
            && snapshot.remote_video_ready_state >= HTMLMediaElement.HAVE_CURRENT_DATA
            && snapshot.remote_video_width > 0
            && snapshot.remote_video_height > 0
            && snapshot.remote_placeholder_hidden;
        }""",
        timeout=30_000,
    )
    expect(page.locator("#remote-placeholder")).not_to_be_visible()
    snapshot = page.evaluate("window.__guiluaQa.snapshot()")
    assert snapshot["active_non_closed_peer_count"] == 1
    assert sum(
        track["kind"] == "audio" and track["ready_state"] == "live"
        for track in snapshot["remote_video_tracks"]
    ) == 1
    assert sum(
        track["kind"] == "video" and track["ready_state"] == "live"
        for track in snapshot["remote_video_tracks"]
    ) == 1
    assert snapshot["remote_video_ready_state"] >= 2
    assert snapshot["remote_video_width"] > 0
    assert snapshot["remote_video_height"] > 0
    assert snapshot["remote_placeholder_hidden"] is True
    assert snapshot["duplicate_remote_video_track_ids"] is False
    return snapshot


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

        snapshot_a = _wait_for_usable_remote_media(page_a)
        snapshot_b = _wait_for_usable_remote_media(page_b)
        offer = _last_event(snapshot_a, "signaling.offer", "outbound")
        answer = _last_event(snapshot_b, "signaling.answer", "outbound")
        ice_a = _last_event(snapshot_a, "signaling.ice_candidate", "outbound")
        ice_b = _last_event(snapshot_b, "signaling.ice_candidate", "outbound")
        assert offer["target_participant_id"] == "participant-b"
        assert answer["target_participant_id"] == "participant-a"
        assert ice_a["target_participant_id"] == "participant-b"
        assert ice_b["target_participant_id"] == "participant-a"
        assert snapshot_a["peer_count"] == snapshot_b["peer_count"] == 1
        assert snapshot_a["reconnect_token_seen"] is True
        assert snapshot_b["reconnect_token_seen"] is True
        assert snapshot_a["reconnect_token_rotation_count"] == 0
        assert snapshot_b["reconnect_token_rotation_count"] == 0

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
        expect(page_c.locator("#call-error")).to_contain_text("Kết nối đã đóng")
        page_c.wait_for_function(
            """() => {
              const snapshot = window.__guiluaQa.snapshot();
              return snapshot.local_track_states.length === 2
                && snapshot.local_track_states.every(track => track.ready_state === 'ended');
            }""",
            timeout=10_000,
        )
        rejected_snapshot = page_c.evaluate("window.__guiluaQa.snapshot()")
        assert rejected_snapshot["local_video_tracks"] == []
        assert rejected_snapshot["active_non_closed_peer_count"] == 0
        assert rejected_snapshot["active_timeout_count"] == 0
        assert rejected_snapshot["reconnect_timer_active"] is False
        assert all(state in (2, 3) for state in rejected_snapshot["websocket_states"])
        expect(page_c.locator("#start-call")).to_be_enabled()
        expect(page_c.locator("#microphone-toggle")).to_be_disabled()
        expect(page_c.locator("#camera-toggle")).to_be_disabled()
        expect(page_c.locator("#end-call")).to_be_disabled()
        assert _wait_for_usable_remote_media(page_a)["active_non_closed_peer_count"] == 1
        assert _wait_for_usable_remote_media(page_b)["active_non_closed_peer_count"] == 1

        before_reconnect = _last_event(
            page_a.evaluate("window.__guiluaQa.snapshot()"), "session.authorized"
        )["connection_id"]
        page_a.evaluate("window.__guiluaQa.closeLatestSocket()")
        page_a.wait_for_function(
            """() => window.__guiluaQa.snapshot().inbound.some(
              event => event.event_name === 'session.authorized' && event.reconnected === true
            )""",
            timeout=20_000,
        )
        expect(page_a.locator("#connection-pill")).to_have_attribute("data-state", "connected")
        assert page_a.locator("#connection-label").inner_text() in {"Reconnected", "Connected"}
        page_b.wait_for_function(
            "window.__guiluaQa.snapshot().inbound.some(event => event.event_name === 'participant.reconnected')",
            timeout=20_000,
        )
        after_authorization_a = page_a.evaluate("window.__guiluaQa.snapshot()")
        after_authorized = _last_event(after_authorization_a, "session.authorized")
        assert after_authorized["reconnected"] is True
        assert after_authorized["connection_id"] != before_reconnect
        assert after_authorized["participant_count"] == 2
        assert after_authorization_a["reconnect_token_rotation_count"] == 1

        after_snapshot_a = _wait_for_usable_remote_media(page_a)
        after_snapshot_b = _wait_for_usable_remote_media(page_b)
        assert after_snapshot_a["active_non_closed_peer_count"] == 1
        assert after_snapshot_b["active_non_closed_peer_count"] == 1
        assert after_snapshot_a["active_timeout_count"] == 0
        assert after_snapshot_b["active_timeout_count"] == 0
        assert after_snapshot_a["reconnect_timer_active"] is False
        assert after_snapshot_b["reconnect_timer_active"] is False
        assert after_snapshot_a["reconnect_token_rotation_count"] == 1
        assert _last_event(after_snapshot_b, "participant.reconnected")["participant_id"] == "participant-a"
        assert _last_event(after_snapshot_a, "signaling.offer", "outbound")["target_participant_id"] == "participant-b"
        assert _last_event(after_snapshot_b, "signaling.answer", "outbound")["target_participant_id"] == "participant-a"
        assert _last_event(after_snapshot_a, "signaling.ice_candidate", "outbound")["target_participant_id"] == "participant-b"
        assert _last_event(after_snapshot_b, "signaling.ice_candidate", "outbound")["target_participant_id"] == "participant-a"

        write_json(
            artifact_dir / "evidence" / "webrtc-reconnect.json",
            {
                "participant_a": after_snapshot_a,
                "participant_b": after_snapshot_b,
                "physical_device": False,
                "fake_media": True,
            },
        )

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
            assert final_snapshot["active_non_closed_peer_count"] == 0
            assert final_snapshot["active_timeout_count"] == 0
            assert final_snapshot["reconnect_timer_active"] is False
            assert final_snapshot["peer_states"]
            assert all(peer["connection_state"] == "closed" for peer in final_snapshot["peer_states"])
            assert all(state in (2, 3) for state in final_snapshot["websocket_states"])
            write_json(
                artifact_dir / "evidence" / f"webrtc-{participant}.json",
                {"snapshot": final_snapshot, "console": evidence[participant]},
            )
            assert relevant_console_errors(evidence[participant]) == []

        write_json(
            artifact_dir / "evidence" / "webrtc-participant-c.json",
            {"snapshot": rejected_snapshot, "console": evidence["participant-c"]},
        )
        participant_c_errors = relevant_console_errors(evidence["participant-c"])
        assert len(participant_c_errors) == 1
        assert "WebSocket handshake: Unexpected response code: 403" in participant_c_errors[0]["text"]
    finally:
        for context in reversed(contexts):
            context.close()
