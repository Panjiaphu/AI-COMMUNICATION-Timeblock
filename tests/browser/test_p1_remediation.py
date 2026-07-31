from __future__ import annotations

import os
from pathlib import Path

import pytest

if os.getenv('BROWSER_QA_ENABLED') != '1':
    pytest.skip('Browser QA is isolated from the default pytest suite.', allow_module_level=True)

pytest.importorskip('playwright.sync_api')
from playwright.sync_api import Page, expect

from tests.browser.support import create_context, install_instrumentation, observe_page, relevant_console_errors, write_json


def _url(base_url: str, session: str, participant: str) -> str:
    return f'{base_url}/communication?session={session}&participant={participant}&token=development-session'


def _wait_remote(page: Page) -> None:
    page.wait_for_function("""() => {
      const s = window.__guiluaQa.snapshot();
      return s.active_non_closed_peer_count === 1
        && s.remote_video_tracks.filter(t => t.kind === 'audio' && t.ready_state === 'live').length === 1
        && s.remote_video_tracks.filter(t => t.kind === 'video' && t.ready_state === 'live').length === 1;
    }""", timeout=30000)


def test_reconnect_exhaustion_terminal_cleanup_and_restart(chromium_browser, base_url: str, artifact_dir: Path):
    context = create_context(chromium_browser, base_url=base_url, viewport={'width': 430, 'height': 932}, grant_media=True)
    page = context.new_page(); install_instrumentation(page); evidence = observe_page(page)
    try:
        page.goto(_url(base_url, 'reconnect-exhaustion', 'participant-a'), wait_until='networkidle')
        page.locator('#start-call').click()
        expect(page.locator('#connection-label')).to_have_text('Connected')
        page.wait_for_function("window.__guiluaQa.snapshot().local_video_tracks.length === 2")
        page.evaluate('window.__guiluaQa.enableReconnectExhaustion()')
        page.evaluate('window.__guiluaQa.closeLatestSocket()')
        expect(page.locator('#connection-label')).to_have_text('Reconnect failed', timeout=20000)
        page.wait_for_function("""() => {
          const s = window.__guiluaQa.snapshot();
          return s.local_track_states.length >= 2
            && s.local_track_states.every(t => t.ready_state === 'ended')
            && s.active_non_closed_peer_count === 0
            && s.active_timeout_count === 0
            && s.websocket_states.every(state => state === 2 || state === 3);
        }""", timeout=10000)
        snapshot = page.evaluate('window.__guiluaQa.snapshot()')
        socket_count = snapshot['websocket_count']
        assert snapshot['local_video_tracks'] == []
        assert snapshot['remote_video_tracks'] == []
        assert snapshot['active_non_closed_peer_count'] == 0
        assert snapshot['active_timeout_count'] == 0
        expect(page.locator('#start-call')).to_be_enabled()
        expect(page.locator('#microphone-toggle')).to_be_disabled()
        expect(page.locator('#camera-toggle')).to_be_disabled()
        expect(page.locator('#end-call')).to_be_disabled()
        page.wait_for_timeout(250)
        assert page.evaluate('window.__guiluaQa.snapshot().websocket_count') == socket_count

        page.evaluate('window.__guiluaQa.disableReconnectExhaustion()')
        page.locator('#start-call').click()
        expect(page.locator('#connection-label')).to_have_text('Connected', timeout=15000)
        restarted = page.evaluate('window.__guiluaQa.snapshot()')
        assert 'reconnect_token=' not in restarted['websocket_urls'][-1]
        page.locator('#end-call').click()
        write_json(artifact_dir / 'evidence' / 'reconnect-exhaustion.json', {'terminal': snapshot, 'restart': restarted, 'console': evidence, 'physical_device': False, 'fake_media': True})
        assert relevant_console_errors(evidence) == []
    finally:
        context.close()


def test_one_sided_hangup_cleans_remote_without_echo(chromium_browser, base_url: str, artifact_dir: Path):
    contexts = []; pages = {}; evidence = {}
    try:
        for participant in ('participant-a', 'participant-b'):
            context = create_context(chromium_browser, base_url=base_url, viewport={'width': 1024, 'height': 768}, grant_media=True)
            contexts.append(context); page = context.new_page(); install_instrumentation(page)
            pages[participant] = page; evidence[participant] = observe_page(page)
            page.goto(_url(base_url, 'one-sided-hangup', participant), wait_until='networkidle')
        page_a, page_b = pages['participant-a'], pages['participant-b']
        page_a.locator('#start-call').click(); expect(page_a.locator('#connection-label')).to_have_text('Connected')
        page_b.locator('#start-call').click(); expect(page_b.locator('#connection-label')).to_have_text('Connected')
        _wait_remote(page_a); _wait_remote(page_b)

        page_a.locator('#end-call').click()
        expect(page_a.locator('#connection-label')).to_have_text('Ended')
        expect(page_b.locator('#connection-label')).to_have_text('Ended', timeout=15000)
        page_b.wait_for_function("""() => {
          const s = window.__guiluaQa.snapshot();
          return s.inbound.some(e => e.event_name === 'session.ended')
            && s.local_track_states.length >= 2
            && s.local_track_states.every(t => t.ready_state === 'ended')
            && s.remote_video_tracks.length === 0
            && s.active_non_closed_peer_count === 0
            && s.active_timeout_count === 0
            && s.websocket_states.every(state => state === 2 || state === 3);
        }""", timeout=10000)
        remote = page_b.evaluate('window.__guiluaQa.snapshot()')
        assert remote['local_video_tracks'] == []
        assert remote['remote_video_tracks'] == []
        assert remote['active_non_closed_peer_count'] == 0
        assert remote['active_timeout_count'] == 0
        assert not any(event['event_name'] == 'session.ended' for event in remote['outbound'])
        write_json(artifact_dir / 'evidence' / 'one-sided-hangup.json', {'remote': remote, 'console': evidence['participant-b'], 'physical_device': False, 'fake_media': True})
        assert relevant_console_errors(evidence['participant-a']) == []
        assert relevant_console_errors(evidence['participant-b']) == []
    finally:
        for context in reversed(contexts):
            context.close()
