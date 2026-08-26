(() => {
  "use strict";

  const root = globalThis;
  const app = document.getElementById("assistant-app");
  const namespace = root.TimeblockCallV1 || {};
  if (!app || typeof namespace.CallV1Runtime !== "function") return;
  if (root.__TIMEBLOCK_CALL_V1_BOOTSTRAP__) return;
  const bootstrapOwner = { version: "call-v1-ring-owner-20260822", runtime: null };
  root.__TIMEBLOCK_CALL_V1_BOOTSTRAP__ = bootstrapOwner;

  const terminalStatuses = new Set(["ENDED", "TERMINATING"]);
  const $ = (selector) => app.querySelector(selector);
  const $$ = (selector) => Array.from(app.querySelectorAll(selector));
  const statusOf = (call) => String(call?.status || "").trim().toLowerCase();
  const fetcher = root.fetch?.bind(root);
  let previousFocus = null;
  let wasActive = false;
  let pollInFlight = false;
  let pollController = null;
  let pollTimer = null;
  let refreshTimer = null;
  let lastHeartbeatAt = 0;
  let lastHeartbeatCallId = "";
  let pendingAutoAnswer = false;
  const telemetrySentAt = new Map();
  const telemetryEvents = new Set([
    "peer_state",
    "remote_track",
    "ring_state",
    "local_cleanup_completed",
    "terminal_action_sent",
    "terminal_action_failed",
  ]);

  function ensureAsset(kind, value, marker) {
    if (document.querySelector(`[data-${marker}]`)) return;
    const element = document.createElement(kind);
    if (kind === "link") {
      element.rel = "stylesheet";
      element.href = value;
    } else {
      element.src = value;
      element.defer = true;
    }
    element.setAttribute(`data-${marker}`, "1");
    document.head.appendChild(element);
  }

  ensureAsset("link", "/static/css/call_workspace.css?v=call-v1-ring-owner-20260822", "timeblock-call-workspace");
  ensureAsset("link", "/static/css/call_translation_plugin.css?v=call-v1-translation-plugin-20260824-desktop-tablet", "timeblock-translation-plugin");

  function syncCallGeneration(callId = "") {
    const normalized = String(callId || "");
    if (normalized === lastHeartbeatCallId) return;
    lastHeartbeatCallId = normalized;
    lastHeartbeatAt = 0;
  }

  function closeCallNotification(callId = "") {
    const normalized = String(callId || "");
    if (!normalized || !root.navigator?.serviceWorker) return;
    const message = { type: "call-terminal", callId: normalized };
    try { root.navigator.serviceWorker.controller?.postMessage?.(message); } catch (_error) { /* best effort */ }
    root.navigator.serviceWorker.ready.then((registration) => {
      if (registration.active !== root.navigator.serviceWorker.controller) registration.active?.postMessage?.(message);
    }).catch(() => undefined);
  }

  function sendTelemetry(event = {}) {
    const callId = String(event.call_id || "");
    const eventName = String(event.event || "");
    if (!callId || !telemetryEvents.has(eventName) || typeof fetcher !== "function") return;
    const state = String(event.state || event.status || "").slice(0, 32);
    const reason = String(event.reason || "").slice(0, 64);
    const action = String(event.action || "").slice(0, 16);
    const key = `${callId}:${eventName}:${state}:${reason}:${action}`;
    const now = Date.now();
    if (now - Number(telemetrySentAt.get(key) || 0) < 2000) return;
    telemetrySentAt.set(key, now);
    const payload = {
      event: eventName,
      state,
      reason,
      action,
      role: String(event.role || "").slice(0, 16),
      track_kind: String(event.track_kind || "").slice(0, 16),
      http_status: Math.max(0, Math.min(599, Number(event.http_status) || 0)),
    };
    fetcher(`/api/messaging/calls/${encodeURIComponent(callId)}/telemetry`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  function syncViewport() {
    const height = Math.max(
      320,
      Math.round(root.visualViewport?.height || root.innerHeight || document.documentElement.clientHeight),
    );
    document.documentElement.style.setProperty("--timeblock-call-viewport-height", `${height}px`);
  }

  function syncStageAccessibility() {
    const stage = $("[data-call-stage]");
    if (!stage) return;
    const active = !stage.hidden;
    const minimized = active && stage.classList.contains("is-minimized");
    const video = active && !stage.classList.contains("is-audio");
    document.body.classList.toggle("timeblock-call-active", active);
    document.body.classList.toggle("timeblock-video-call-active", video);
    document.body.classList.toggle("timeblock-call-minimized", minimized);
    if (active && !wasActive) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      root.requestAnimationFrame?.(() => $("[data-call-hangup]")?.focus?.({ preventScroll: true }));
    } else if (!active && wasActive) {
      previousFocus?.focus?.({ preventScroll: true });
      previousFocus = null;
    }
    wasActive = active;
  }

  function setStatus(message, isError = false) {
    const status = $("[data-call-status]");
    if (!status) return;
    status.textContent = message || "";
    status.toggleAttribute("role", Boolean(isError));
  }

  function playRemoteMedia() {
    const media = $("[data-remote-media]");
    const playback = media?.play?.();
    if (!playback || typeof playback.catch !== "function") return;
    playback.catch((error) => {
      if (error?.name === "AbortError") return;
      const message = app.dataset.copyCallMediaPlayback || "";
      if (message) setStatus(message, true);
    });
  }

  function render(event = {}) {
    const state = String(event.status || "").toUpperCase();
    if (terminalStatuses.has(state)) {
      abortPolling();
      if (refreshTimer) root.clearTimeout(refreshTimer);
      refreshTimer = null;
      closeCallNotification(event.callId);
      syncCallGeneration("");
    } else if (event.callId) {
      syncCallGeneration(event.callId);
    }
    if (state === "CONNECTED") {
      runtime.silenceRing("ui-connected");
      closeCallNotification(event.callId || runtime.session?.callId);
    }
    const active = Boolean(state) && !terminalStatuses.has(state) && state !== "IDLE" && state !== "INCOMING_RINGING";
    const incoming = state === "INCOMING_RINGING";
    const stage = $("[data-call-stage]");
    const incomingPanel = $("[data-incoming-call]");
    const callActions = $("[data-call-actions]");
    if (stage) {
      stage.hidden = !active;
      stage.classList.toggle("is-audio", event.media !== "video");
      stage.classList.toggle("has-remote", Boolean(runtime.session?.remoteStream));
    }
    if (incomingPanel) incomingPanel.hidden = !incoming;
    if (callActions && active) callActions.hidden = false;
    $$('[data-call-start]').forEach((button) => { button.hidden = active || incoming; });
    $$('[data-call-end], [data-call-hangup]').forEach((button) => { button.hidden = !active; });
    const camera = $("[data-call-toggle-camera]");
    if (camera) camera.hidden = !active || event.media !== "video";
    const mic = $("[data-call-toggle-mic]");
    if (mic) mic.hidden = !active;
    if (incoming) {
      const label = $("[data-incoming-label]");
      if (label) label.textContent = event.media === "video" ? "Incoming video call" : "Incoming audio call";
    }
    if (state === "CONNECTED") setStatus("");
    syncStageAccessibility();
  }

  function updateTrackControls() {
    const stream = runtime.session?.localStream;
    const audio = stream?.getAudioTracks?.()[0];
    const video = stream?.getVideoTracks?.()[0];
    const mic = $("[data-call-toggle-mic]");
    const camera = $("[data-call-toggle-camera]");
    if (mic) mic.setAttribute("aria-pressed", String(audio?.enabled === false));
    if (camera) camera.setAttribute("aria-pressed", String(video?.enabled === false));
    $("[data-local-media-wrap]")?.classList.toggle("is-camera-off", video?.enabled === false);
    translationPlugin?.syncMuteState?.();
  }

  async function readJson(path, options = {}) {
    if (typeof fetcher !== "function") throw new Error("call-v1.fetch-unavailable");
    const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
    pollController = controller;
    let timedOut = false;
    const timer = controller ? root.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10000) : null;
    try {
      const response = await fetcher(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        signal: controller?.signal || options.signal,
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...(options.headers || {}) },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error("call-v1.poll-timeout");
        timeoutError.status = 408;
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer) root.clearTimeout(timer);
      if (pollController === controller) pollController = null;
    }
  }

  function abortPolling() {
    try { pollController?.abort?.(); } catch (_error) { /* best effort */ }
    pollController = null;
  }

  function scheduleCanonicalRefresh() {
    if (refreshTimer) return;
    refreshTimer = root.setTimeout(() => {
      refreshTimer = null;
      pollCalls();
    }, 180);
  }

  function pendingCall() {
    const url = new URL(root.location.href);
    let callId = url.searchParams.get("call_id") || "";
    let requested = url.searchParams.get("answer") === "1";
    try {
      const stored = JSON.parse(root.sessionStorage?.getItem("timeblock.pending-call-answer") || "null");
      if (stored && Date.now() - Number(stored.created_at || 0) < 120000) {
        callId = callId || String(stored.call_id || "");
        requested = true;
      }
    } catch (_error) {
      // Storage is optional.
    }
    return { callId, requested, url };
  }

  function clearPending({ url } = pendingCall()) {
    try { root.sessionStorage?.removeItem("timeblock.pending-call-answer"); } catch (_error) { /* optional */ }
    if (!url.searchParams.has("answer") && !url.searchParams.has("call_id")) return;
    url.searchParams.delete("answer");
    url.searchParams.delete("call_id");
    root.history?.replaceState?.({}, "", url);
  }

  async function startOutgoing(media) {
    const conversationId = runtime.selectedConversationId || app.dataset.activeMessagingConversationId || "";
    if (!conversationId || runtime.session) return;
    setStatus("Connecting…");
    try {
      if (media === "video") await runtime.startVideoCall({ conversationId });
      else await runtime.startAudioCall({ conversationId });
      updateTrackControls();
    } catch (error) {
      setStatus(error?.name === "NotAllowedError" ? "Microphone or camera permission denied" : (error?.message || "Call could not be started"), true);
      render({ status: "ENDED", media });
    }
  }

  async function answerIncoming() {
    if (!runtime.session || runtime.session.status !== namespace.STATES.INCOMING_RINGING) return;
    closeCallNotification(runtime.session.callId);
    setStatus("Connecting…");
    try {
      await runtime.answer();
      updateTrackControls();
      clearPending();
    } catch (error) {
      setStatus(error?.name === "NotAllowedError" ? "Microphone or camera permission denied" : (error?.message || "Call could not be answered"), true);
    }
  }

  async function rejectIncoming() {
    if (!runtime.session) return;
    closeCallNotification(runtime.session.callId);
    abortPolling();
    try {
      await runtime.reject();
    } finally {
      clearPending();
    }
  }

  async function enableCallNotifications() {
    const feedback = $("[data-network-feedback]");
    const armed = await runtime.armRingAudio();
    let permission = "unsupported";
    if ("Notification" in root) {
      try {
        permission = root.Notification.permission === "granted"
          ? "granted"
          : await root.Notification.requestPermission();
      } catch (_error) {
        permission = "denied";
      }
    }
    if (feedback) {
      feedback.textContent = armed && permission === "granted"
        ? (app.dataset.copyCallNotificationsEnabled || "")
        : (app.dataset.copyCallNotificationsDenied || app.dataset.copyRingtoneUnavailable || "");
    }
  }

  async function pollCalls() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      if (runtime.session?.callId) {
        syncCallGeneration(runtime.session.callId);
        const payload = await readJson(`/api/messaging/calls/${encodeURIComponent(runtime.session.callId)}`);
        await runtime.applyCanonicalCall(payload.call);
        if (runtime.session?.callId && Date.now() - lastHeartbeatAt >= 10000) {
          lastHeartbeatAt = Date.now();
          runtime.heartbeat();
        }
        return;
      }
      syncCallGeneration("");
      const pending = pendingCall();
      if (pending.callId) {
        const payload = await readJson(`/api/messaging/calls/${encodeURIComponent(pending.callId)}`);
        if (statusOf(payload.call) === "ringing" && runtime.showIncoming(payload.call)) {
          pendingAutoAnswer = pending.requested;
          clearPending(pending);
          if (pendingAutoAnswer) await answerIncoming();
        }
        return;
      }
      const payload = await readJson("/api/messaging/calls");
      const incoming = (payload.calls || []).find((call) => (
        statusOf(call) === "ringing"
        && call.callee_type === app.dataset.actorType
        && String(call.callee_id) === String(app.dataset.actorId)
      ));
      if (incoming && runtime.showIncoming(incoming)) pendingAutoAnswer = false;
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (Number(error?.status) === 404 && runtime.session) {
        const media = runtime.session.media;
        await runtime.terminate("stale-call");
        clearPending();
        setStatus(app.dataset.copyCallEventEnded || "", true);
        render({ status: "ENDED", media });
      }
      // Polling is best effort; the server remains the canonical call state.
    } finally {
      pollInFlight = false;
    }
  }

  function bind() {
    runtime.attachMediaElements($("[data-local-media]"), $("[data-remote-media]"));
    $$('[data-call-start]').forEach((button) => button.addEventListener("click", () => {
      runtime.armRingAudio();
      startOutgoing(button.dataset.callStart);
    }));
    $("[data-call-answer]")?.addEventListener("click", () => {
      runtime.armRingAudio();
      answerIncoming();
    });
    $("[data-call-reject]")?.addEventListener("click", rejectIncoming);
    $("[data-call-notifications]")?.addEventListener("click", enableCallNotifications);
    $$('[data-call-end], [data-call-hangup]').forEach((button) => button.addEventListener("click", () => runtime.hangup()));
    $("[data-call-toggle-mic]")?.addEventListener("click", () => {
      const track = runtime.session?.localStream?.getAudioTracks?.()[0];
      if (track) { track.enabled = !track.enabled; updateTrackControls(); }
    });
    $("[data-call-toggle-camera]")?.addEventListener("click", () => {
      const track = runtime.session?.localStream?.getVideoTracks?.()[0];
      if (track) { track.enabled = !track.enabled; updateTrackControls(); }
    });
    $("[data-call-minimize]")?.addEventListener("click", () => $("[data-call-stage]")?.classList.toggle("is-minimized"));
    $("[data-call-fullscreen]")?.addEventListener("click", () => {
      const stage = $("[data-call-stage]");
      if (stage?.requestFullscreen) stage.requestFullscreen().catch(() => stage.classList.toggle("is-expanded"));
      else stage?.classList.toggle("is-expanded");
    });
    app.addEventListener("timeblock:assistant:conversation-selected", (event) => {
      runtime.selectedConversationId = String(event.detail?.conversation?.id || "");
    });
    app.addEventListener("timeblock:messaging:conversation", (event) => {
      runtime.selectedConversationId = String(event.detail?.conversation?.id || runtime.selectedConversationId || "");
    });
    app.addEventListener("timeblock:messaging:call-state", scheduleCanonicalRefresh);
    root.addEventListener("resize", syncViewport, { passive: true });
    root.addEventListener("orientationchange", syncViewport, { passive: true });
    root.visualViewport?.addEventListener("resize", syncViewport, { passive: true });
    root.addEventListener("pointerdown", () => { runtime.armRingAudio(); }, { once: true, capture: true, passive: true });
    root.addEventListener("keydown", () => { runtime.armRingAudio(); }, { once: true, capture: true });
    document.addEventListener("fullscreenchange", syncStageAccessibility);
    $(`[data-call-stage]`)?.addEventListener("click", () => {
      if (runtime.session?.remoteStream) playRemoteMedia();
    });
    root.addEventListener("pagehide", () => {
      abortPolling();
      if (pollTimer) root.clearInterval(pollTimer);
      if (refreshTimer) root.clearTimeout(refreshTimer);
      const callId = runtime.session?.callId;
      if (!callId) return;
      closeCallNotification(callId);
      runtime.terminate("pagehide");
      if (root.navigator?.sendBeacon) {
        const body = new root.Blob([JSON.stringify({ action: "end" })], { type: "application/json" });
        root.navigator.sendBeacon(`/api/messaging/calls/${encodeURIComponent(callId)}/action`, body);
      }
    }, { once: true });
    syncViewport();
    syncStageAccessibility();
    pollTimer = root.setInterval(() => pollCalls(), 2000);
    pollCalls();
  }

  let runtime;
  let translationPlugin;
  runtime = new namespace.CallV1Runtime({
    ownerToken: `${app.dataset.actorType || ""}:${app.dataset.actorId || ""}`,
    onStateChange: (event) => {
      render(event);
      updateTrackControls();
    },
    onRemoteStream: () => {
      runtime.silenceRing("remote-stream");
      closeCallNotification(runtime.session?.callId);
      $("[data-call-stage]")?.classList.add("has-remote");
      playRemoteMedia();
    },
    onTelemetry: (event) => {
      root.dispatchEvent?.(new root.CustomEvent("timeblock:call-v1-telemetry", { detail: event }));
      sendTelemetry(event);
    },
    onRingAudioStateChange: (event) => {
      if (event.channel === "ringtone" && !event.playable && runtime.session?.status === namespace.STATES.INCOMING_RINGING) {
        const message = app.dataset.copyRingtoneUnavailable || "";
        if (message) setStatus(message, true);
      }
    },
  });
  if (typeof namespace.CallTranslationPlugin === "function") {
    translationPlugin = new namespace.CallTranslationPlugin({ document, app, fetcher });
    runtime.attachTranslationPlugin(translationPlugin);
  }
  root.TimeblockCallV1Runtime = runtime;
  bootstrapOwner.runtime = runtime;
  bind();
})();
