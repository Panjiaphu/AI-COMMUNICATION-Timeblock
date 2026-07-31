from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page

FAKE_MEDIA_ARGS = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
]

QA_INSTRUMENTATION = r"""
(() => {
  const denyMedia = __DENY_MEDIA__;
  const qa = {
    websockets: [], socketCloses: [], inbound: [], outbound: [], peers: [], peerHistory: [],
    remoteTrackEvents: [], localTracks: [], activeTimeouts: new Set(), lastReconnectToken: null,
    reconnectTokenSeen: false, reconnectTokenRotationCount: 0,
    fastTimers: false, failFutureSockets: false,
  };
  const NativeSetTimeout = window.setTimeout.bind(window);
  const NativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (callback, delay = 0, ...args) => {
    let timerId;
    const wrapped = (...callbackArgs) => {
      qa.activeTimeouts.delete(timerId);
      if (typeof callback === "function") return callback(...callbackArgs);
      return undefined;
    };
    timerId = NativeSetTimeout(wrapped, qa.fastTimers ? 0 : delay, ...args);
    qa.activeTimeouts.add(timerId);
    return timerId;
  };
  window.clearTimeout = (timerId) => {
    qa.activeTimeouts.delete(timerId);
    return NativeClearTimeout(timerId);
  };
  const summarize = (raw, direction) => {
    try {
      const message = JSON.parse(raw);
      const summary = {
        direction,
        event_name: message.event_name || "unknown",
        event_version: message.event_version ?? null,
        session_id: message.session_id || null,
        participant_id: message.participant_id || null,
        sequence_number: message.sequence_number ?? null,
        connection_id: message.connection_id || null,
        timestamp: new Date().toISOString(),
      };
      if (message.reconnected !== undefined) summary.reconnected = Boolean(message.reconnected);
      if (message.snapshot?.participants) summary.participant_count = message.snapshot.participants.length;
      if (message.payload?.target_participant_id) summary.target_participant_id = message.payload.target_participant_id;
      if (message.code) summary.result = message.code;
      if (message.event_name === "session.authorized" && typeof message.reconnect_token === "string") {
        summary.reconnect_token_present = message.reconnect_token.length > 0;
        if (message.reconnect_token.length > 0) {
          qa.reconnectTokenSeen = true;
          if (qa.lastReconnectToken !== null && qa.lastReconnectToken !== message.reconnect_token) {
            qa.reconnectTokenRotationCount += 1;
          }
          qa.lastReconnectToken = message.reconnect_token;
        }
      }
      return summary;
    } catch {
      return { direction, event_name: "non_json", timestamp: new Date().toISOString() };
    }
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = new Target(...args);
      qa.websockets.push(socket);
      const nativeSend = socket.send.bind(socket);
      socket.send = (data) => { qa.outbound.push(summarize(data, "outbound")); return nativeSend(data); };
      socket.addEventListener("message", (event) => qa.inbound.push(summarize(event.data, "inbound")));
      socket.addEventListener("close", (event) => qa.socketCloses.push({ code: event.code, reason: event.reason, clean: event.wasClean }));
      socket.addEventListener("open", () => {
        if (qa.failFutureSockets) socket.close(4000, "qa_forced_reconnect_failure");
      });
      return socket;
    },
  });
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(NativePeerConnection, {
    construct(Target, args) {
      const peer = new Target(...args);
      qa.peers.push(peer);
      const record = () => qa.peerHistory.push({ connection_state: peer.connectionState, ice_connection_state: peer.iceConnectionState, signaling_state: peer.signalingState });
      ["connectionstatechange", "iceconnectionstatechange", "signalingstatechange"].forEach((name) => peer.addEventListener(name, record));
      peer.addEventListener("track", (event) => {
        const tracks = event.streams[0]?.getTracks() || [event.track];
        for (const track of tracks) qa.remoteTrackEvents.push(track.id);
      });
      record();
      return peer;
    },
  });
  if (navigator.mediaDevices?.getUserMedia) {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (denyMedia) throw new DOMException("Synthetic permission denial", "NotAllowedError");
      const stream = await nativeGetUserMedia(...args);
      qa.localTracks.push(...stream.getTracks());
      return stream;
    };
  }
  const summarizeTrack = (track) => ({ id: track.id, kind: track.kind, enabled: track.enabled, ready_state: track.readyState });
  window.__guiluaQa = {
    closeLatestSocket() { const socket = qa.websockets.at(-1); if (socket && socket.readyState === NativeWebSocket.OPEN) socket.close(4000, "qa_disconnect"); },
    latestSocketUrl() { return qa.websockets.at(-1)?.url || ""; },
    enableReconnectExhaustion() { qa.fastTimers = true; qa.failFutureSockets = true; },
    disableReconnectExhaustion() { qa.fastTimers = false; qa.failFutureSockets = false; },
    setSyntheticCaptions(sourceText, translatedText) {
      document.getElementById("source-caption").textContent = sourceText;
      document.getElementById("translated-caption").textContent = translatedText;
    },
    snapshot() {
      const localVideo = document.getElementById("local-video");
      const remoteVideo = document.getElementById("remote-video");
      const remotePlaceholder = document.getElementById("remote-placeholder");
      const peerStates = qa.peers.map((peer) => ({ connection_state: peer.connectionState, ice_connection_state: peer.iceConnectionState, signaling_state: peer.signalingState }));
      const localVideoTracks = localVideo?.srcObject?.getTracks() || [];
      const remoteVideoTracks = remoteVideo?.srcObject?.getTracks() || [];
      const remoteVideoTrackIds = remoteVideoTracks.map((track) => track.id);
      return {
        websocket_count: qa.websockets.length,
        websocket_states: qa.websockets.map((socket) => socket.readyState),
        socket_closes: qa.socketCloses,
        inbound: qa.inbound,
        outbound: qa.outbound,
        peer_count: qa.peers.length,
        peer_states: peerStates,
        active_non_closed_peer_count: peerStates.filter((peer) => peer.connection_state !== "closed").length,
        peer_history: qa.peerHistory,
        remote_track_ids: [...new Set(qa.remoteTrackEvents)],
        remote_track_event_count: qa.remoteTrackEvents.length,
        local_track_states: qa.localTracks.map(summarizeTrack),
        local_video_tracks: localVideoTracks.map(summarizeTrack),
        remote_video_tracks: remoteVideoTracks.map(summarizeTrack),
        duplicate_remote_video_track_ids: new Set(remoteVideoTrackIds).size !== remoteVideoTrackIds.length,
        remote_video_width: remoteVideo?.videoWidth || 0,
        remote_video_height: remoteVideo?.videoHeight || 0,
        remote_video_ready_state: remoteVideo?.readyState ?? 0,
        remote_placeholder_hidden: !remotePlaceholder || remotePlaceholder.hidden || getComputedStyle(remotePlaceholder).display === "none",
        reconnect_token_seen: qa.reconnectTokenSeen,
        reconnect_token_rotation_count: qa.reconnectTokenRotationCount,
        active_timeout_count: qa.activeTimeouts.size,
        reconnect_timer_active: qa.activeTimeouts.size > 0,
        active_element: document.activeElement?.id || null,
      };
    },
  };
})()
"""


def install_instrumentation(page: Page, *, deny_media: bool = False) -> None:
    page.add_init_script(QA_INSTRUMENTATION.replace("__DENY_MEDIA__", "true" if deny_media else "false"))


def create_context(browser: Browser, *, base_url: str, viewport: dict[str, int], grant_media: bool = False) -> BrowserContext:
    context = browser.new_context(viewport=viewport, base_url=base_url)
    if grant_media:
        context.grant_permissions(["camera", "microphone"], origin=base_url)
    return context


def observe_page(page: Page) -> dict[str, list[dict[str, str]]]:
    evidence: dict[str, list[dict[str, str]]] = {"console": [], "page_errors": []}
    page.on("console", lambda message: evidence["console"].append({"type": message.type, "text": message.text[:1000]}))
    page.on("pageerror", lambda error: evidence["page_errors"].append({"type": type(error).__name__, "text": str(error)[:1000]}))
    return evidence


def relevant_console_errors(evidence: dict[str, list[dict[str, str]]]) -> list[dict[str, str]]:
    return [entry for entry in evidence["console"] if entry["type"] == "error"] + evidence["page_errors"]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def boxes_intersect(first: dict[str, float], second: dict[str, float], *, tolerance: float = 1.0) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"] + tolerance
        or second["x"] + second["width"] <= first["x"] + tolerance
        or first["y"] + first["height"] <= second["y"] + tolerance
        or second["y"] + second["height"] <= first["y"] + tolerance
    )
