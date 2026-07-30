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
() => {
  const denyMedia = __DENY_MEDIA__;
  const qa = { websockets: [], socketCloses: [], inbound: [], outbound: [], peers: [], peerHistory: [], remoteTrackIds: [], localTracks: [] };
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
        timestamp: new Date().toISOString(),
      };
      if (message.reconnected !== undefined) summary.reconnected = Boolean(message.reconnected);
      if (message.snapshot?.participants) summary.participant_count = message.snapshot.participants.length;
      if (message.payload?.target_participant_id) summary.target_participant_id = message.payload.target_participant_id;
      if (message.code) summary.result = message.code;
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
        for (const track of tracks) if (!qa.remoteTrackIds.includes(track.id)) qa.remoteTrackIds.push(track.id);
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
  window.__guiluaQa = {
    closeLatestSocket() { const socket = qa.websockets.at(-1); if (socket && socket.readyState === NativeWebSocket.OPEN) socket.close(4000, "qa_disconnect"); },
    setSyntheticCaptions(sourceText, translatedText) {
      document.getElementById("source-caption").textContent = sourceText;
      document.getElementById("translated-caption").textContent = translatedText;
    },
    snapshot() {
      const localVideo = document.getElementById("local-video");
      const remoteVideo = document.getElementById("remote-video");
      return {
        websocket_count: qa.websockets.length,
        websocket_states: qa.websockets.map((socket) => socket.readyState),
        socket_closes: qa.socketCloses,
        inbound: qa.inbound,
        outbound: qa.outbound,
        peer_count: qa.peers.length,
        peer_states: qa.peers.map((peer) => ({ connection_state: peer.connectionState, ice_connection_state: peer.iceConnectionState, signaling_state: peer.signalingState })),
        peer_history: qa.peerHistory,
        remote_track_ids: [...new Set(qa.remoteTrackIds)],
        local_track_states: qa.localTracks.map((track) => ({ kind: track.kind, enabled: track.enabled, ready_state: track.readyState })),
        local_video_tracks: localVideo?.srcObject?.getTracks().map((track) => ({ kind: track.kind, enabled: track.enabled, ready_state: track.readyState })) || [],
        remote_video_tracks: remoteVideo?.srcObject?.getTracks().map((track) => ({ kind: track.kind, enabled: track.enabled, ready_state: track.readyState })) || [],
        active_element: document.activeElement?.id || null,
      };
    },
  };
}
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
