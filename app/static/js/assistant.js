(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const VALID_MODES = new Set(["ai", "messages", "translate", "alerts"]);
  const MESSAGING_FALLBACK_POLL_INTERVAL_MS = 15_000;
  // Call V1 owns live media on the assistant workspace. The legacy functions below
  // remain as rollback references but are execution-disabled on this production path.
  const CALL_V1_ASSISTANT_OWNERSHIP = window.__TIMEBLOCK_CALL_V1_ENABLED__ === true;
  const AI_HISTORY_LIMIT = 20;
  const AUDIO_MIME_TYPES = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  const CALL_TERMINAL_STATUSES = new Set(["ended", "rejected", "cancelled", "missed"]);
  const CALL_INTENT_STORAGE_KEY = "timeblock.pending-call-intent";
  const CALL_INTENT_TTL_MS = 60_000;
  const CALL_PHASES = new Set([
    "IDLE",
    "OUTGOING_RINGING",
    "INCOMING_RINGING",
    "ANSWERING",
    "NEGOTIATING",
    "ICE_CONNECTING",
    "ICE_CONNECTED",
    "PEER_CONNECTED",
    "MEDIA_CONNECTED",
    "TERMINATING",
    "ENDED",
    "FAILED",
  ]);

  const state = {
    mode: "ai",
    context: { type: "general", country: "usa", symbol: "" },
    webSearch: false,
    aiAudio: null,
    aiInitialized: false,
    aiHistoryLoaded: false,
    aiHistoryPage: null,
    aiHistoryLoading: false,
    aiHistoryPromise: null,
    recorder: null,
    me: null,
    connections: [],
    conversations: [],
    callHistory: [],
    communicationTab: "conversations",
    online: [],
    conversation: null,
    conversationFilters: { view: "inbox", pinned_only: false, unread_only: false },
    threadMessages: [],
    messagePage: null,
    messageSignature: "",
    pendingMessage: null,
    summary: null,
    activeCall: null,
    incomingCall: null,
    peer: null,
    localStream: null,
    pendingIce: [],
    pendingRemoteIce: new Map(),
    remoteIce: new Set(),
    iceServers: [],
    iceExpiresAt: 0,
    iceRefreshAt: 0,
    iceRefreshTimer: null,
    iceDisconnectedTimer: null,
    iceRecoveryInFlight: false,
    lastIceRecoveryAt: 0,
    remoteOfferSeq: 0,
    remoteAnswerSeq: 0,
    callIdleText: "",
    lastHeartbeat: 0,
    lastNetworkRefresh: 0,
    pollTimer: null,
    ready: false,
    lastEquitySymbol: "",
    initialConnectHandled: false,
    initialConversationHandled: false,
    notifiedCallIds: new Set(),
    ringtone: null,
    qrScanner: null,
    qrProfile: null,
    qrReturnFocus: null,
    assistantSpeech: null,
    assistantSpeechUrl: "",
    alertsInitialized: false,
    referenceRatesLoaded: false,
    callMedia: "audio",
    callAttempt: null,
    callGeneration: 0,
    callCleanupPromise: null,
    callCleanupGeneration: -1,
    callAbortControllers: new Set(),
    callObjectUrls: new Set(),
    terminalCallIds: new Set(),
    callPhase: "IDLE",
    callRefreshes: new Map(),
    callEventIds: new Set(),
    callSetupInFlight: false,
    pendingCallIntent: null,
    pendingCallIntentHandled: false,
    peerGeneration: 0,
    mediaGeneration: 0,
    callTelemetry: [],
    peerListeners: [],
    audioContext: null,
    viewportFrame: null,
    viewportCleanup: null,
    layoutViewportHeight: 0,
    scrollPins: { ai: true, messages: true },
  };

  const $ = (selector, root = app) => root.querySelector(selector);
  const $$ = (selector, root = app) => Array.from(root.querySelectorAll(selector));
  const copy = (name) => {
    const normalized = String(name || "");
    const copyKey = normalized ? `copy${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : "";
    return (copyKey && app.dataset[copyKey]) || app.dataset[normalized] || "";
  };

  function readPendingCallIntent() {
    try {
      const raw = sessionStorage.getItem(CALL_INTENT_STORAGE_KEY);
      sessionStorage.removeItem(CALL_INTENT_STORAGE_KEY);
      const payload = JSON.parse(raw || "null");
      const conversationId = Number(payload?.conversationId || 0);
      const createdAt = Number(payload?.createdAt || 0);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
      if (!createdAt || Date.now() - createdAt > CALL_INTENT_TTL_MS) return null;
      return {
        conversationId,
        media: payload?.media === "video" ? "video" : "audio",
      };
    } catch (_error) {
      return null;
    }
  }

  function emitMessagingEvent(name, detail = {}) {
    app.dispatchEvent(new CustomEvent(`timeblock:messaging:${name}`, { detail }));
  }

  function emitCallEvent(name, call) {
    if (!call?.id) return;
    window.dispatchEvent(new CustomEvent(`timeblock:call-${name}`, {
      detail: { call, callId: call.id },
    }));
  }

  function emitCallList(calls) {
    window.dispatchEvent(new CustomEvent("timeblock:call-list", {
      detail: { calls: Array.isArray(calls) ? calls : [] },
    }));
  }

  function createClientMessageId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  const CALL_TELEMETRY_DETAIL_KEYS = new Set([
    "target",
    "track_kind",
    "error_name",
    "failure_code",
    "candidate_type",
    "phase",
    "connection_state",
    "ice_connection_state",
    "reason",
  ]);

  function beginCallAttempt(role, media, callId = "") {
    state.callGeneration += 1;
    state.callCleanupPromise = null;
    state.callCleanupGeneration = -1;
    const attempt = {
      id: createClientMessageId(),
      role: String(role || "unknown"),
      media: String(media || "audio"),
      callId: String(callId || ""),
      startedAt: performance.now(),
      seen: new Set(),
      lifecycle: "active",
      phase: "IDLE",
      generation: state.callGeneration,
      peerGeneration: state.peerGeneration,
      mediaGeneration: state.mediaGeneration,
      cleanupPromise: null,
    };
    state.callAttempt = attempt;
    return attempt;
  }

  function bindCallAttempt(attempt, call) {
    if (!attempt || !call?.id) return;
    attempt.callId = String(call.id);
  }

  function isCurrentCallAttempt(attempt) {
    return Boolean(attempt && state.callAttempt === attempt);
  }

  function currentCallId() {
    return String(
      state.activeCall?.id
      || state.incomingCall?.id
      || state.callAttempt?.callId
      || "",
    );
  }

  function captureCallContext(attempt = state.callAttempt, callId = "") {
    const liveAttempt = attempt?.lifecycle === "active" ? attempt : null;
    return Object.freeze({
      attempt: liveAttempt,
      generation: state.callGeneration,
      callId: String(callId || currentCallId()),
    });
  }

  function isCurrentCallContext(context) {
    if (!context || context.generation !== state.callGeneration) return false;
    if (context.attempt) {
      if (state.callAttempt !== context.attempt) return false;
      if (context.attempt.lifecycle !== "active") return false;
      if (context.attempt.generation !== context.generation) return false;
    }
    if (context.callId) {
      const liveIds = [
        state.activeCall?.id,
        state.incomingCall?.id,
        state.callAttempt?.callId,
      ].filter(Boolean).map(String);
      if (liveIds.length && !liveIds.includes(context.callId)) return false;
    }
    return true;
  }

  function abortCallError() {
    return new DOMException("Call lifecycle is no longer current", "AbortError");
  }

  function registerCallAbortController(context = captureCallContext()) {
    if (typeof AbortController !== "function") {
      return { controller: { signal: undefined, abort() {} }, context };
    }
    const controller = new AbortController();
    const entry = { controller, context };
    state.callAbortControllers.add(entry);
    if (!isCurrentCallContext(context)) controller.abort();
    return entry;
  }

  function releaseCallAbortController(entry) {
    if (entry) state.callAbortControllers.delete(entry);
  }

  function abortCallRequests() {
    state.callAbortControllers.forEach((entry) => {
      try { entry.controller.abort(); } catch (_error) { /* noop */ }
    });
    state.callAbortControllers.clear();
    state.callRefreshes.forEach((entry) => {
      try { entry.abortEntry?.controller?.abort?.(); } catch (_error) { /* noop */ }
    });
    state.callRefreshes.clear();
  }

  function rememberCallObjectUrl(url) {
    if (url) state.callObjectUrls.add(url);
    return url;
  }

  function revokeCallObjectUrls() {
    state.callObjectUrls.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch (_error) { /* noop */ }
    });
    state.callObjectUrls.clear();
  }

  function rememberTerminalCallId(callId) {
    const id = String(callId || "");
    if (!id) return;
    state.terminalCallIds.add(id);
    if (state.terminalCallIds.size > 200) {
      state.terminalCallIds.delete(state.terminalCallIds.values().next().value);
    }
  }

  function isTerminalCallId(callId) {
    const id = String(callId || "");
    return Boolean(
      id
      && state.terminalCallIds.has(id)
      && String(state.activeCall?.id || "") !== id
      && String(state.incomingCall?.id || "") !== id,
    );
  }

  function setCallStatusForAttempt(attempt, message, isError = false) {
    if (!isCurrentCallAttempt(attempt)) return;
    setCallStatus(message, isError);
  }

  function callTelemetryFor(attempt, eventName, detail = {}, options = {}) {
    const name = String(eventName || "");
    if (!attempt || !name) return;
    const onceKey = String(options.onceKey || "");
    if (onceKey && attempt.seen.has(onceKey)) return;
    if (onceKey) attempt.seen.add(onceKey);
    const safeDetail = {};
    Object.entries(detail || {}).forEach(([key, value]) => {
      if (!CALL_TELEMETRY_DETAIL_KEYS.has(key)) return;
      if (!["string", "number", "boolean"].includes(typeof value)) return;
      safeDetail[key] = value;
    });
    const record = {
      event: name,
      call_attempt_id: attempt.id,
      call_id: attempt.callId || "",
      role: attempt.role,
      media: attempt.media,
      at: Date.now(),
      elapsed_ms: Math.max(0, Math.round(performance.now() - attempt.startedAt)),
      ...safeDetail,
    };
    state.callTelemetry.push(record);
    if (state.callTelemetry.length > 200) state.callTelemetry.splice(0, state.callTelemetry.length - 200);
    try {
      window.dispatchEvent(new CustomEvent("timeblock:call-telemetry", { detail: record }));
    } catch (_error) {
      // Telemetry is observational and must never affect call media.
    }
  }

  function callTelemetry(eventName, detail = {}, options = {}) {
    callTelemetryFor(state.callAttempt, eventName, detail, options);
  }

  function setCallPhase(phase, attempt = state.callAttempt) {
    const next = String(phase || "");
    if (!CALL_PHASES.has(next)) return;
    if (attempt && !isCurrentCallAttempt(attempt)) return;
    state.callPhase = next;
    if (attempt) attempt.phase = next;
    callTelemetryFor(attempt, "call_phase_changed", { phase: next }, { onceKey: `phase:${next}` });
  }

  function classifyCallError(error, fallback = "INTERNAL_STATE_VIOLATION") {
    const name = String(error?.name || "");
    const message = String(error?.message || "").toUpperCase();
    if (name === "NotAllowedError" && message.includes("PLAY")) return "AUTOPLAY_BLOCKED";
    if (name === "NotAllowedError" || name === "SecurityError") return "MEDIA_PERMISSION_DENIED";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "MEDIA_DEVICE_MISSING";
    if (name === "NotReadableError") return "MEDIA_DEVICE_MISSING";
    if (error?.status === 409 || message.includes("STALE") || message.includes("STATE_CONFLICT")) return "SIGNALING_STALE";
    if (message.includes("OFFER")) return "SDP_OFFER_FAILED";
    if (message.includes("ANSWER")) return "SDP_ANSWER_FAILED";
    if (message.includes("ICE") || message.includes("CANDIDATE")) return "ICE_FAILED";
    return fallback;
  }

  function recordCallFailure(attempt, error, fallback = "INTERNAL_STATE_VIOLATION") {
    const failureCode = classifyCallError(error, fallback);
    callTelemetryFor(attempt, "call_failed", {
      failure_code: failureCode,
      error_name: String(error?.name || "Error"),
      reason: failureCode,
    }, { onceKey: `call_failed:${failureCode}` });
    setCallPhase("FAILED", attempt);
    return failureCode;
  }

  function markFirstVideoFrame(element, attempt = state.callAttempt) {
    if (!element || typeof element.requestVideoFrameCallback !== "function") return;
    const frameAttempt = attempt;
    try {
      element.requestVideoFrameCallback(() => {
        callTelemetryFor(frameAttempt, "first_video_frame", { target: "remote" }, { onceKey: "first_video_frame" });
      });
    } catch (_error) {
      // requestVideoFrameCallback is capability-gated and best-effort only.
    }
  }

  function playCallMedia(element, target, trackKind = "", attempt = state.callAttempt) {
    if (!element) return;
    const playbackAttempt = attempt;
    const safeTarget = target === "remote" ? "remote" : "local";
    const safeTrackKind = trackKind === "video" ? "video" : "audio";
    callTelemetryFor(playbackAttempt, "media_play_requested", { target: safeTarget, track_kind: safeTrackKind });
    let playback;
    try {
      playback = element.play();
    } catch (error) {
      callTelemetryFor(playbackAttempt, "media_play_error", {
        target: safeTarget,
        track_kind: safeTrackKind,
        error_name: String(error?.name || "Error"),
      });
      return;
    }
    Promise.resolve(playback).then(() => {
      callTelemetryFor(playbackAttempt, "media_play_success", { target: safeTarget, track_kind: safeTrackKind });
      if (safeTarget === "remote" && safeTrackKind === "video") markFirstVideoFrame(element, playbackAttempt);
    }).catch((error) => {
      callTelemetryFor(playbackAttempt, "media_play_error", {
        target: safeTarget,
        track_kind: safeTrackKind,
        error_name: String(error?.name || "Error"),
      });
    });
  }

  window.TimeblockCallTelemetry = Object.freeze({
    snapshot: () => state.callTelemetry.map((record) => ({ ...record })),
  });

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function iconElement(name) {
    const template = $(`[data-icon-template="${String(name || "")}"]`);
    return template?.content?.firstElementChild?.cloneNode(true) || createElement("span", "assistant-icon-fallback");
  }

  function replaceWithEmpty(container, message) {
    const empty = createElement("div", "assistant-note-card", message || copy("empty"));
    container.replaceChildren(empty);
  }

  function setFeedback(element, message, isError) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
    element.setAttribute("role", isError ? "alert" : "status");
    element.setAttribute("aria-live", isError ? "assertive" : "polite");
  }

  function errorMessage(error) {
    const message = error && error.message ? String(error.message) : "";
    if (!message) return copy("error");
    return message.includes(".") && !message.includes(" ")
      ? copy("error")
      : message;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { "X-Requested-With": "XMLHttpRequest", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function jsonOptions(method, body) {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    };
  }

  function formatDate(value) {
    if (!value) return "";
    const raw = String(value);
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat(app.dataset.locale || undefined, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function initials(entry) {
    const source = String((entry && (entry.display_name || entry.public_id)) || "T").trim();
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "T";
  }

  function setBadge(element, count) {
    if (!element) return;
    const numeric = Math.max(0, Number(count) || 0);
    element.textContent = numeric > 99 ? "99+" : String(numeric);
    element.hidden = numeric < 1;
    element.setAttribute("aria-label", String(numeric));
  }

  function activateMode(requestedMode, updateUrl = true, refresh = true) {
    const mode = VALID_MODES.has(requestedMode) ? requestedMode : "ai";
    state.mode = mode;
    window.TimeblockLiveTranslate?.setActive?.(mode === "translate");
    $$('[data-mode-tab]').forEach((tab) => {
      const active = tab.dataset.modeTab === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('[data-mode-panel]').forEach((panel) => {
      const active = panel.dataset.modePanel === mode;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({ mode }, "", url);
    }
    if (mode === "ai") {
      ensureAiInitialized();
      if (state.ready) ensureAiHistoryLoaded();
    }
    if (mode === "messages" && state.ready && refresh) refreshNetwork(true);
    if (mode === "alerts") {
      ensureAlertsInitialized();
      loadPreferences();
      loadAlerts();
      loadInbox();
      loadReferenceRates();
    }
  }

  function initModes() {
    $$('[data-mode-tab]').forEach((tab) => {
      tab.addEventListener("click", () => activateMode(tab.dataset.modeTab));
      tab.addEventListener("keydown", (event) => {
        if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
        const tabs = $$('[data-mode-tab]');
        const current = tabs.indexOf(tab);
        let next = current;
        if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        event.preventDefault();
        tabs[next].focus();
        activateMode(tabs[next].dataset.modeTab);
      });
    });
    $('[data-open-notifications]')?.addEventListener("click", openNotificationCenter);
    window.addEventListener("popstate", () => {
      const mode = new URL(window.location.href).searchParams.get("mode") || "ai";
      activateMode(mode, false);
    });
    const queryMode = new URL(window.location.href).searchParams.get("mode");
    activateMode(queryMode || app.dataset.initialMode || "ai", false);
  }

  function activateCommunicationTab(requestedTab, updateUrl = true) {
    const validTabs = new Set(["conversations", "groups", "calls"]);
    const tabName = validTabs.has(requestedTab) ? requestedTab : "conversations";
    state.communicationTab = tabName;
    let activeTab = null;
    $$('[data-communication-tab]').forEach((tab) => {
      const active = tab.dataset.communicationTab === tabName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) activeTab = tab;
    });
    if (activeTab && window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => {
        activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
    const messagingLayout = $('[data-messaging-layout]');
    if (messagingLayout) messagingLayout.hidden = tabName !== "conversations";
    $$('[data-communication-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.communicationPanel !== tabName;
    });
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (tabName === "conversations") url.searchParams.delete("communication");
      else url.searchParams.set("communication", tabName);
      window.history.replaceState({ mode: "messages", communication: tabName }, "", url);
    }
    if (state.ready && tabName === "calls") {
      loadCallHistory().catch((error) => setFeedback($('[data-call-history-feedback]'), errorMessage(error), true));
    }
  }

  function initCommunicationTabs() {
    const tabs = $$('[data-communication-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activateCommunicationTab(tab.dataset.communicationTab));
      tab.addEventListener("keydown", (event) => {
        if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
        const current = tabs.indexOf(tab);
        let next = current;
        if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        event.preventDefault();
        tabs[next].focus();
        activateCommunicationTab(tabs[next].dataset.communicationTab);
      });
    });
    $$('[data-communication-back]').forEach((button) => {
      button.addEventListener("click", () => activateCommunicationTab("conversations"));
    });
    const requested = new URL(window.location.href).searchParams.get("communication");
    activateCommunicationTab(requested || "conversations", false);
  }

  function resizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    const computedMaxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : 132;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }

  function safeCitationUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function safePrivateMediaUrl(value, expectedPrefix) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(expectedPrefix)) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function privateImage(attachment, expectedPrefix, className) {
    if (!attachment || typeof attachment !== "object") return null;
    const source = safePrivateMediaUrl(attachment.url, expectedPrefix);
    if (!source || !String(attachment.mime_type || "").startsWith("image/")) return null;
    const figure = createElement("figure", `assistant-private-media ${className || ""}`.trim());
    const image = createElement("img", "");
    image.src = source;
    image.alt = copy("imageAlt") || "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    const attachmentId = String(attachment.attachment_id ?? "").trim();
    const expiresAt = String(attachment.expires_at || "").trim();
    if (attachmentId) {
      figure.dataset.attachmentId = attachmentId;
      image.dataset.attachmentId = attachmentId;
    }
    if (expiresAt) {
      figure.dataset.expiresAt = expiresAt;
      image.dataset.expiresAt = expiresAt;
    }
    const expiry = expiresAt ? formatDate(expiresAt) : "";
    const caption = createElement(
      "figcaption",
      "",
      expiry ? copy("mediaExpires").replace("{date}", expiry) : copy("mediaRetention"),
    );
    image.addEventListener("error", () => {
      figure.classList.add("is-unavailable");
      image.remove();
      caption.textContent = copy("mediaRetention");
    }, { once: true });
    figure.append(image, caption);
    return figure;
  }

  function renderAssistantMessage(message) {
    if (!message || !message.role) return null;
    const role = message.role === "user" ? "user" : "assistant";
    const article = createElement("article", `assistant-message ${role === "user" ? "is-user" : "is-assistant"}`);
    if (message.id) article.dataset.aiMessageId = String(message.id);
    const avatar = createElement("span", "assistant-list-avatar", role === "user" ? initials({ display_name: copy("you") }) : "AI");
    avatar.setAttribute("aria-hidden", "true");
    const content = createElement("div", "assistant-message-content");
    content.appendChild(createElement("strong", "", role === "user" ? copy("you") : copy("assistant")));
    const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
    const attachment = privateImage(metadata.attachment, "/api/assistant/media/", "assistant-message-image");
    if (attachment) content.appendChild(attachment);
    else if (metadata.attachment_expired) content.appendChild(createElement("div", "assistant-media-expired", copy("mediaExpired")));
    const messageText = String(message.content || "");
    content.appendChild(createElement("div", "assistant-message-bubble", messageText));

    if (role === "assistant" && messageText.trim()) {
      const speak = createElement("button", "assistant-speech-button", copy("speechRead"));
      speak.type = "button";
      speak.dataset.aiSpeak = "true";
      speak.dataset.aiSpeakText = messageText;
      speak.setAttribute("aria-label", copy("speechRead"));
      content.appendChild(speak);
    }

    const citations = Array.isArray(message.citations) ? message.citations : metadata.citations;
    if (role === "assistant" && Array.isArray(citations) && citations.length) {
      const wrap = createElement("div", "assistant-citations");
      citations.forEach((citation) => {
        const href = safeCitationUrl(citation && citation.url);
        if (!href) return;
        const link = createElement("a", "", (citation && citation.title) || href);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        wrap.appendChild(link);
      });
      if (wrap.childElementCount) content.appendChild(wrap);
    }
    article.append(avatar, content);
    return article;
  }

  function renderAiMessages(messages) {
    const container = $('[data-ai-messages]');
    const items = (Array.isArray(messages) ? messages : []).map(renderAssistantMessage).filter(Boolean);
    if (!items.length) {
      const empty = $('[data-ai-empty]');
      if (empty) container.replaceChildren(empty);
      else replaceWithEmpty(container, copy("empty"));
      updateAiHistoryPaginationUi();
      return;
    }
    container.replaceChildren(...items);
    container.scrollTop = container.scrollHeight;
    updateAiHistoryPaginationUi();
  }

  function appendAiMessage(message) {
    const container = $('[data-ai-messages]');
    if ($('[data-ai-empty]', container)) container.replaceChildren();
    const element = renderAssistantMessage(message);
    if (element) container.appendChild(element);
    container.scrollTop = container.scrollHeight;
  }

  function updateUsage(usage) {
    const element = $('[data-assistant-usage]');
    if (!usage) return;
    if (element) element.textContent = copy("usage").replace("{remaining}", String(usage.remaining ?? "-"));
    const buckets = usage.buckets && typeof usage.buckets === "object" ? usage.buckets : {};
    $$('[data-quota-card]').forEach((card) => {
      const meter = buckets[card.dataset.quotaCard];
      if (!meter) return;
      const value = $('[data-quota-value]', card);
      if (value) value.textContent = `${meter.remaining ?? 0}/${meter.limit ?? 0}`;
      card.dataset.quotaRemaining = String(meter.remaining ?? 0);
      card.dataset.quotaLimit = String(meter.limit ?? 0);
    });
    const reset = usage.reset_at || buckets.text?.reset_at;
    const resetLabel = $('[data-quota-reset-label]');
    if (resetLabel && reset) {
      resetLabel.textContent = copy("quotaReset").replace("{date}", formatDate(reset));
    }
  }

  function updateUsageFromHeader(response) {
    const raw = response?.headers?.get("X-Timeblock-Usage");
    if (!raw) return;
    try { updateUsage(JSON.parse(raw)); } catch (_error) { /* Usage headers are advisory. */ }
  }

  function stopAssistantSpeech() {
    if (state.assistantSpeech) {
      state.assistantSpeech.pause();
      state.assistantSpeech.src = "";
      state.assistantSpeech = null;
    }
    if (state.assistantSpeechUrl) {
      URL.revokeObjectURL(state.assistantSpeechUrl);
      state.assistantSpeechUrl = "";
    }
    $$('[data-ai-speak]').forEach((button) => {
      button.disabled = false;
      button.classList.remove("is-speaking");
      button.textContent = copy("speechRead");
    });
  }

  async function playAssistantSpeech(button, text) {
    const value = String(text || "").trim();
    if (!value) return;
    if (state.assistantSpeech && !state.assistantSpeech.paused) {
      stopAssistantSpeech();
      return;
    }
    stopAssistantSpeech();
    button.disabled = true;
    button.classList.add("is-speaking");
    button.textContent = copy("speechStop");
    let audio = null;
    try {
      const response = await fetch("/api/assistant/speech", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ text: value, target_language: app.dataset.locale || "vi" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      updateUsageFromHeader(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      state.assistantSpeechUrl = url;
      audio = new Audio(url);
      state.assistantSpeech = audio;
      audio.addEventListener("ended", stopAssistantSpeech, { once: true });
      await audio.play();
    } catch (error) {
      stopAssistantSpeech();
      const feedback = $('[data-ai-meta]');
      setFeedback(feedback, errorMessage(error) || copy("speechUnavailable"), true);
    }
  }

  function updateAiHistoryPaginationUi() {
    const container = $('[data-ai-messages]');
    const pagination = $('[data-ai-history-pagination]');
    const button = $('[data-ai-history-load-earlier]');
    if (container) container.setAttribute("aria-busy", String(state.aiHistoryLoading));
    if (!button) return;
    const canLoadEarlier = Boolean(
      state.aiHistoryPage?.has_more_before
      && state.aiHistoryPage?.next_before_cursor,
    );
    const hidden = !state.aiHistoryLoading && !canLoadEarlier;
    if (pagination) pagination.hidden = hidden;
    button.hidden = hidden;
    button.disabled = state.aiHistoryLoading || !canLoadEarlier;
    button.textContent = state.aiHistoryLoading
      ? copy("aiHistoryLoading")
      : copy("aiHistoryLoadEarlier");
  }

  async function loadAiHistory() {
    if (state.aiHistoryPromise) return state.aiHistoryPromise;
    state.aiHistoryLoading = true;
    updateAiHistoryPaginationUi();
    const operation = (async () => {
      const payload = await api(`/api/assistant/history?limit=${AI_HISTORY_LIMIT}`);
      state.aiHistoryPage = {
        next_before_cursor: payload.next_before_cursor || null,
        has_more_before: Boolean(payload.has_more_before),
      };
      renderAiMessages(payload.messages || []);
      updateUsage(payload.usage);
      state.aiHistoryLoaded = true;
      return true;
    })();
    state.aiHistoryPromise = operation;
    try {
      return await operation;
    } catch (error) {
      state.aiHistoryLoaded = false;
      setFeedback($('[data-ai-meta]'), errorMessage(error), true);
      return false;
    } finally {
      if (state.aiHistoryPromise === operation) state.aiHistoryPromise = null;
      state.aiHistoryLoading = false;
      updateAiHistoryPaginationUi();
    }
  }

  function ensureAiHistoryLoaded() {
    if (state.aiHistoryLoaded) return Promise.resolve(true);
    return loadAiHistory();
  }

  async function loadEarlierAiHistory() {
    if (state.aiHistoryPromise) return state.aiHistoryPromise;
    const cursor = state.aiHistoryPage?.next_before_cursor;
    if (!state.aiHistoryPage?.has_more_before || !cursor) return false;
    const container = $('[data-ai-messages]');
    const previousScrollHeight = container?.scrollHeight || 0;
    const previousScrollTop = container?.scrollTop || 0;
    state.aiHistoryLoading = true;
    updateAiHistoryPaginationUi();
    const operation = (async () => {
      const payload = await api(
        `/api/assistant/history?limit=${AI_HISTORY_LIMIT}`
        + `&before_message_id=${encodeURIComponent(cursor)}`,
      );
      if (String(state.aiHistoryPage?.next_before_cursor || "") !== String(cursor)) return false;
      state.aiHistoryPage = {
        next_before_cursor: payload.next_before_cursor || null,
        has_more_before: Boolean(payload.has_more_before),
      };
      const existingIds = new Set(
        $$('[data-ai-message-id]', container).map((item) => item.dataset.aiMessageId),
      );
      const items = (payload.messages || [])
        .filter((message) => !message?.id || !existingIds.has(String(message.id)))
        .map(renderAssistantMessage)
        .filter(Boolean);
      if (items.length) {
        if ($('[data-ai-empty]', container)) container.replaceChildren();
        container.prepend(...items);
        container.scrollTop = previousScrollTop + (container.scrollHeight - previousScrollHeight);
      }
      updateUsage(payload.usage);
      return true;
    })();
    state.aiHistoryPromise = operation;
    try {
      return await operation;
    } catch (error) {
      setFeedback($('[data-ai-meta]'), errorMessage(error), true);
      return false;
    } finally {
      if (state.aiHistoryPromise === operation) state.aiHistoryPromise = null;
      state.aiHistoryLoading = false;
      updateAiHistoryPaginationUi();
    }
  }

  function supportedAudioMimeType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== "function") return "";
    return AUDIO_MIME_TYPES.find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
  }

  function audioFilename(mimeType, prefix) {
    if (String(mimeType).includes("mp4")) return `${prefix}.m4a`;
    if (String(mimeType).includes("ogg")) return `${prefix}.ogg`;
    return `${prefix}.webm`;
  }

  function stopOwnedRecorderStream(record) {
    if (!record?.ownsStream) return;
    record.stream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* noop */ }
    });
  }

  async function toggleAudioRecording(kind, button, onComplete, sourceStream = null) {
    if (state.recorder && state.recorder.kind === kind && state.recorder.mediaRecorder.state === "recording") {
      state.recorder.mediaRecorder.stop();
      return;
    }
    if (state.recorder) {
      const previous = state.recorder;
      previous.cancelled = true;
      previous.onComplete = () => {};
      if (previous.mediaRecorder.state === "recording") {
        const stopped = new Promise((resolve) => {
          previous.mediaRecorder.addEventListener("stop", resolve, { once: true });
        });
        previous.mediaRecorder.stop();
        await stopped;
      } else {
        stopOwnedRecorderStream(previous);
        if (state.recorder === previous) state.recorder = null;
      }
    }
    if (!window.MediaRecorder) throw new Error(copy("mediaDenied") || copy("error"));

    let stream;
    let ownsStream = false;
    if (sourceStream?.getAudioTracks?.().length) {
      stream = new MediaStream(sourceStream.getAudioTracks());
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(copy("mediaDenied") || copy("error"));
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      ownsStream = true;
    }

    const mimeType = supportedAudioMimeType();
    let mediaRecorder;
    try {
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      if (ownsStream) stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const chunks = [];
    const record = {
      kind,
      button,
      stream,
      ownsStream,
      mediaRecorder,
      chunks,
      onComplete,
      cancelled: false,
    };
    state.recorder = record;
    button.classList.add("is-recording");
    button.setAttribute("aria-pressed", "true");
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (record.cancelled) return;
      if (event.data && event.data.size) chunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const current = state.recorder === record;
      const outputType = mediaRecorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: outputType });
      stopOwnedRecorderStream(record);
      button.classList.remove("is-recording");
      button.setAttribute("aria-pressed", "false");
      if (current) state.recorder = null;
      if (!record.cancelled && blob.size) {
        Promise.resolve(record.onComplete({
          blob,
          name: audioFilename(outputType, kind),
          type: outputType,
        })).catch(() => undefined);
      }
    });
    mediaRecorder.addEventListener("error", () => {
      record.cancelled = true;
      stopOwnedRecorderStream(record);
      button.classList.remove("is-recording");
      button.setAttribute("aria-pressed", "false");
      if (state.recorder === record) state.recorder = null;
    });
    mediaRecorder.start(500);
  }

  function stopRecorder(cancel = false) {
    if (!state.recorder) return;
    const record = state.recorder;
    if (cancel) {
      record.cancelled = true;
      record.onComplete = () => {};
    }
    if (record.mediaRecorder.state === "recording") {
      record.mediaRecorder.stop();
      return;
    }
    stopOwnedRecorderStream(record);
    if (state.recorder === record) state.recorder = null;
  }

  function contextFormState() {
    return {
      type: $('[data-context-type]')?.value || "general",
      country: $('[data-context-country]')?.value || "usa",
      symbol: ($('[data-context-symbol]')?.value || "").trim(),
    };
  }

  function updateContextFields() {
    const context = contextFormState();
    $('[data-country-field]').hidden = context.type !== "equities";
    $('[data-symbol-field]').hidden = context.type !== "equities";
    const option = $('[data-context-type]')?.selectedOptions?.[0];
    if (option) $('[data-context-summary]').textContent = option.textContent;
  }

  function contextSummaryText(context, fallback) {
    if (!context || typeof context !== "object") return fallback;
    const values = [
      context.symbol,
      context.country && (context.country.label || context.country.name),
      context.source,
      context.updated_at || context.as_of,
    ].filter(Boolean);
    return values.length ? values.join(" / ") : fallback;
  }

  async function applyContext(event) {
    event.preventDefault();
    const next = contextFormState();
    const option = $('[data-context-type]').selectedOptions[0];
    const fallback = option ? option.textContent : "";
    if (next.type === "general") {
      state.context = next;
      $('[data-context-summary]').textContent = fallback;
      $('[data-context-panel]').classList.remove("is-mobile-open");
      return;
    }
    const params = new URLSearchParams({ lang: app.dataset.locale || "vi" });
    if (next.type === "equities") {
      params.set("country", next.country);
      if (next.symbol) params.set("symbol", next.symbol);
    }
    const summary = $('[data-context-summary]');
    summary.textContent = copy("loading");
    try {
      const payload = await api(`/api/assistant/context/${next.type}?${params.toString()}`);
      state.context = next;
      summary.textContent = contextSummaryText(payload.context, fallback);
      $('[data-context-panel]').classList.remove("is-mobile-open");
    } catch (error) {
      summary.textContent = errorMessage(error);
    }
  }

  async function submitAi(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = $('[data-ai-input]');
    const imageInput = $('[data-ai-file]');
    const text = input.value.trim();
    const file = state.aiAudio || (imageInput.files && imageInput.files[0]);
    const context = contextFormState();
    if (!text && !file && context.type === "general") return;

    const data = new FormData();
    data.append("text", text);
    data.append("web_search", state.webSearch ? "true" : "false");
    data.append("context_type", file ? "general" : context.type);
    data.append("country", context.country);
    data.append("symbol", context.symbol);
    data.append("lang", app.dataset.locale || "vi");
    if (file) {
      if (file.blob) data.append("file", file.blob, file.name);
      else data.append("file", file, file.name);
    }

    const submit = $('[data-ai-submit]');
    const meta = $('[data-ai-meta]');
    const contextLabel = $('[data-context-type]')?.selectedOptions?.[0]?.textContent || "";
    const displayText = text || (file ? (state.aiAudio ? copy("audioReady") : copy("imageSelected")) : contextLabel);
    appendAiMessage({ role: "user", content: displayText });
    setFeedback(meta, copy("loading"), false);
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const payload = await api("/api/assistant/analyze", { method: "POST", body: data });
      if (Array.isArray(payload.messages) && payload.messages.length) await loadAiHistory();
      else appendAiMessage({ role: "assistant", content: payload.answer || "", citations: payload.citations || [] });
      updateUsage(payload.usage);
      if (payload.transcript) setFeedback(meta, payload.transcript, false);
      else setFeedback(meta, "", false);
      input.value = "";
      resizeTextarea(input);
      imageInput.value = "";
      state.aiAudio = null;
      state.webSearch = false;
      $('[data-ai-web]').classList.remove("is-active");
      $('[data-ai-web]').setAttribute("aria-pressed", "false");
    } catch (error) {
      const message = errorMessage(error);
      await loadAiHistory();
      setFeedback(meta, message, true);
      if (error.payload && error.payload.usage) updateUsage(error.payload.usage);
    } finally {
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }

  function initAi() {
    const input = $('[data-ai-input]');
    input.addEventListener("input", () => resizeTextarea(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $('[data-ai-form]').requestSubmit();
      }
    });
    $('[data-ai-form]').addEventListener("submit", submitAi);
    $('[data-ai-history-load-earlier]')?.addEventListener("click", loadEarlierAiHistory);
    $('[data-ai-messages]').addEventListener("click", (event) => {
      const button = event.target.closest("[data-ai-speak]");
      if (!button) return;
      playAssistantSpeech(button, button.dataset.aiSpeakText);
    });
    $('[data-ai-file]').addEventListener("change", (event) => {
      const file = event.currentTarget.files && event.currentTarget.files[0];
      state.aiAudio = null;
      setFeedback($('[data-ai-meta]'), file ? copy("mediaSelected").replace("{name}", file.name) : "", false);
    });
    $('[data-ai-web]').addEventListener("click", (event) => {
      state.webSearch = !state.webSearch;
      event.currentTarget.classList.toggle("is-active", state.webSearch);
      event.currentTarget.setAttribute("aria-pressed", String(state.webSearch));
      setFeedback($('[data-ai-meta]'), state.webSearch ? copy("webEnabled") : "", false);
    });
    $('[data-ai-record]').addEventListener("click", async (event) => {
      try {
        await toggleAudioRecording("assistant-audio", event.currentTarget, (audio) => {
          state.aiAudio = audio;
          $('[data-ai-file]').value = "";
          setFeedback($('[data-ai-meta]'), copy("audioReady"), false);
        });
      } catch (error) {
        setFeedback($('[data-ai-meta]'), errorMessage(error), true);
      }
    });
    const initialContext = app.dataset.initialContext || "general";
    const contextSelect = $('[data-context-type]');
    if (Array.from(contextSelect.options).some((option) => option.value === initialContext)) {
      contextSelect.value = initialContext;
    }
    if (app.dataset.initialCountry) $('[data-context-country]').value = app.dataset.initialCountry;
    if (app.dataset.initialSymbol) $('[data-context-symbol]').value = app.dataset.initialSymbol;
    state.context = contextFormState();
    contextSelect.addEventListener("change", updateContextFields);
    $('[data-context-form]').addEventListener("submit", applyContext);
    $('[data-context-toggle]')?.addEventListener("click", () => $('[data-context-panel]').classList.add("is-mobile-open"));
    $('[data-context-close]')?.addEventListener("click", () => $('[data-context-panel]').classList.remove("is-mobile-open"));
    updateContextFields();
    const requestedInitialMode = new URL(window.location.href).searchParams.get("mode")
      || app.dataset.initialMode
      || "ai";
    const initialMode = VALID_MODES.has(requestedInitialMode) ? requestedInitialMode : "ai";
    if (initialMode === "ai") ensureAiHistoryLoaded();
  }

  function ensureAiInitialized() {
    if (state.aiInitialized) return;
    initAi();
    state.aiInitialized = true;
  }

  function makeListItem(entry, options = {}) {
    const clickable = typeof options.onClick === "function";
    const row = createElement(clickable ? "button" : "div", "assistant-list-item");
    if (clickable) {
      row.type = "button";
      row.addEventListener("click", options.onClick);
    }
    if (options.active) row.classList.add("is-active");
    const avatar = createElement("span", `assistant-list-avatar${options.online ? " is-online" : ""}`, initials(entry));
    avatar.setAttribute("aria-hidden", "true");
    const content = createElement("span", "assistant-list-copy");
    content.appendChild(createElement("strong", "", entry?.display_name || entry?.public_id || "-"));
    content.appendChild(createElement("small", "", options.subtitle ?? entry?.public_id ?? ""));
    row.append(avatar, content);
    if (options.count) {
      row.appendChild(createElement("b", "assistant-list-count", Number(options.count) > 99 ? "99+" : String(options.count)));
    }
    return row;
  }

  function miniButton(label, handler) {
    const button = createElement("button", "", label);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }

  function isIncomingConnection(connection) {
    return Boolean(
      state.me
      && connection?.status === "pending"
      && connection.addressee_type === state.me.owner_type
      && String(connection.addressee_id) === String(state.me.owner_id),
    );
  }

  function renderConnections(items) {
    state.connections = Array.isArray(items) ? items : [];
    const list = $('[data-connection-list]');
    const count = $('[data-connection-count]');
    count.textContent = String(state.connections.length);
    if (!state.connections.length) {
      replaceWithEmpty(list, copy("empty"));
      return;
    }
    const rows = state.connections.map((connection) => {
      const peer = connection.peer || {};
      const row = makeListItem(peer, { subtitle: peer.public_id || "" });
      const actions = createElement("span", "assistant-mini-actions");
      if (isIncomingConnection(connection)) {
        actions.append(
          miniButton(copy("accept"), () => updateConnection(connection.id, "accept")),
          miniButton(copy("reject"), () => updateConnection(connection.id, "reject")),
        );
      } else if (connection.status === "accepted") {
        actions.appendChild(miniButton(copy("chat"), () => openConversation(peer)));
      } else if (connection.status === "rejected") {
        actions.appendChild(miniButton(copy("addFriend"), () => requestFriend(peer.public_id)));
      }
      if (actions.childElementCount) row.appendChild(actions);
      return row;
    });
    list.replaceChildren(...rows);
  }

  function renderOnline(items) {
    state.online = Array.isArray(items) ? items : [];
    $('[data-online-count]').textContent = String(state.online.length);
    const list = $('[data-online-list]');
    if (!state.online.length) {
      replaceWithEmpty(list, copy("empty"));
      return;
    }
    list.replaceChildren(...state.online.map((entry) => makeListItem(entry, {
      online: true,
      subtitle: entry.public_id || "",
      onClick: () => openConversation(entry),
    })));
  }

  function conversationPeer(conversation) {
    if (conversation?.peer) return conversation.peer;
    if (!state.me || !Array.isArray(conversation?.members)) return null;
    return conversation.members.find((member) => !(
      member.owner_type === state.me.owner_type
      && String(member.owner_id) === String(state.me.owner_id)
    )) || null;
  }

  function renderConversations(items) {
    state.conversations = (Array.isArray(items) ? items : [])
      .filter((conversation) => conversation?.kind !== "group");
    $('[data-conversation-count]').textContent = String(state.conversations.length);
    const list = $('[data-conversation-list]');
    if (!state.conversations.length) {
      replaceWithEmpty(list, copy("empty"));
      emitMessagingEvent("conversations", {
        conversations: [],
        filters: { ...state.conversationFilters },
      });
      return;
    }
    const rows = state.conversations.map((conversation) => {
      const peer = conversationPeer(conversation) || {};
      const latestMessage = conversation.latest_visible_message || conversation.latest_message;
      const latest = latestMessage?.content_type === "tombstone"
        ? (app.dataset.v2MessageDeleted || "")
        : (latestMessage?.content || peer.public_id || "");
      const row = makeListItem(peer, {
        subtitle: latest,
        count: conversation.unread_count || 0,
        active: state.conversation && Number(state.conversation.id) === Number(conversation.id),
        onClick: () => selectConversation(conversation),
      });
      row.dataset.messagingConversationId = String(conversation.id);
      row.classList.toggle("is-pinned", Boolean(conversation.preferences?.pinned_at));
      row.classList.toggle("is-muted", Boolean(conversation.preferences?.muted));
      row.classList.toggle("is-archived", Boolean(conversation.preferences?.archived_at));
      row.setAttribute(
        "aria-current",
        state.conversation && Number(state.conversation.id) === Number(conversation.id)
          ? "true"
          : "false",
      );
      return row;
    });
    list.replaceChildren(...rows);
    emitMessagingEvent("conversations", {
      conversations: state.conversations,
      filters: { ...state.conversationFilters },
    });
  }

  function connectedProfiles() {
    return state.connections
      .filter((connection) => connection.status === "accepted")
      .map((connection) => connection.peer)
      .filter(Boolean);
  }

  function renderDirectoryResults(items) {
    const list = $('[data-connection-list]');
    const results = (Array.isArray(items) ? items : []).filter((entry) => !(
      state.me
      && entry.owner_type === state.me.owner_type
      && String(entry.owner_id) === String(state.me.owner_id)
    ));
    if (!results.length) {
      replaceWithEmpty(list, copy("noResults"));
      return;
    }
    const rows = results.map((entry) => {
      const row = makeListItem(entry, { subtitle: entry.public_id || "" });
      const actions = createElement("span", "assistant-mini-actions");
      if (entry.relationship === "accepted") {
        actions.appendChild(miniButton(copy("chat"), () => openConversation(entry)));
      } else if (!new Set(["pending_sent", "pending_received"]).has(entry.relationship)) {
        actions.appendChild(miniButton(copy("addFriend"), () => requestFriend(entry.public_id)));
      }
      if (actions.childElementCount) row.appendChild(actions);
      return row;
    });
    list.replaceChildren(...rows);
  }

  async function loadMe() {
    const payload = await api("/api/messaging/directory/me");
    state.me = payload.entry || null;
    const publicId = $('[data-network-public-id]');
    if (publicId) publicId.textContent = state.me?.public_id || "-";
    emitMessagingEvent("me", { me: state.me });
    return state.me;
  }

  async function loadConnections() {
    const payload = await api("/api/messaging/connections");
    if (!$('[data-network-query]').value.trim()) renderConnections(payload.connections || []);
    else state.connections = payload.connections || [];
  }

  async function loadOnline() {
    const payload = await api("/api/messaging/presence/online?within=90");
    renderOnline(payload.online || []);
  }

  async function loadConversations(filters) {
    if (filters && typeof filters === "object") {
      state.conversationFilters = {
        view: new Set(["inbox", "archived", "restricted"]).has(filters.view)
          ? filters.view
          : "inbox",
        pinned_only: Boolean(filters.pinned_only),
        unread_only: Boolean(filters.unread_only),
      };
    }
    const params = new URLSearchParams({
      view: state.conversationFilters.view,
      limit: "100",
    });
    if (state.conversationFilters.pinned_only) params.set("pinned_only", "1");
    if (state.conversationFilters.unread_only) params.set("unread_only", "1");
    const payload = await api(`/api/messaging/conversations?${params.toString()}`);
    renderConversations(payload.conversations || []);
    return payload;
  }

  function callEventLabel(eventType) {
    const normalized = String(eventType || "").toLowerCase();
    const labels = {
      started: copy("callEventStarted"),
      accepted: copy("callEventAccepted"),
      ended: copy("callEventEnded"),
      rejected: copy("callEventRejected"),
      missed: copy("callEventMissed"),
    };
    return labels[normalized] || normalized;
  }

  function formatCallDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    if (!total) return "";
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function renderCallHistory(items) {
    state.callHistory = Array.isArray(items) ? items : [];
    const list = $('[data-call-history]');
    if (!list) return;
    if (!state.callHistory.length) {
      replaceWithEmpty(list, copy("callEmpty"));
      return;
    }
    list.replaceChildren(...state.callHistory.map((call) => {
      const row = createElement("article", `assistant-communication-row is-call is-${call.status || "ended"}`);
      const mediaLabel = call.media === "video" ? copy("callVideo") : copy("callAudio");
      const peer = call.peer || {};
      const avatar = createElement("span", "assistant-list-avatar", initials(peer));
      const content = createElement("span", "assistant-list-copy");
      const duration = formatCallDuration(call.duration_seconds);
      const detail = [
        mediaLabel,
        callEventLabel(call.status),
        duration,
        formatDate(call.updated_at || call.created_at),
      ].filter(Boolean).join(" · ");
      content.append(
        createElement("strong", "", peer.display_name || peer.public_id || copy("empty")),
        createElement("small", "", detail),
      );
      const open = miniButton(copy("callOpen"), async () => {
        const conversation = state.conversations.find((item) => Number(item.id) === Number(call.conversation_id));
        if (!conversation) return;
        activateCommunicationTab("conversations");
        await selectConversation(conversation);
      });
      open.className = "assistant-secondary-button assistant-communication-action";
      row.append(avatar, content, open);
      return row;
    }));
  }

  async function loadCallHistory() {
    const payload = await api("/api/messaging/calls?history=1&limit=50");
    renderCallHistory(payload.calls || []);
    setFeedback($('[data-call-history-feedback]'), "", false);
  }

  async function heartbeat(visible = !document.hidden, keepalive = false) {
    if (!state.me) return;
    await api("/api/messaging/presence/heartbeat", {
      ...jsonOptions("POST", {
        active_conversation_id: visible && state.conversation ? state.conversation.id : null,
        app_visible: Boolean(visible),
      }),
      keepalive,
    });
    state.lastHeartbeat = Date.now();
  }

  async function refreshNetwork(forceHeartbeat = false) {
    if (document.hidden) return;
    const feedback = $('[data-network-feedback]');
    try {
      if (!state.me) await loadMe();
      if (forceHeartbeat || Date.now() - state.lastHeartbeat > 25000) await heartbeat();
      const results = await Promise.allSettled([loadConnections(), loadOnline(), loadConversations()]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      state.lastNetworkRefresh = Date.now();
      if (state.communicationTab === "calls") await loadCallHistory();
      setFeedback(feedback, "", false);
      const initialConnect = String(app.dataset.initialConnect || "").trim();
      if (!state.initialConnectHandled && initialConnect) {
        state.initialConnectHandled = true;
        $('[data-network-query]').value = initialConnect;
        await searchDirectory();
      }
      const initialConversation = Number(app.dataset.initialConversation || 0);
      if (!state.initialConversationHandled && initialConversation > 0) {
        state.initialConversationHandled = true;
        const conversation = state.conversations.find(
          (item) => Number(item.id) === initialConversation,
        );
        if (conversation) await selectConversation(conversation);
      }
      if (!state.pendingCallIntentHandled && state.pendingCallIntent) {
        const intent = state.pendingCallIntent;
        const conversation = state.conversations.find(
          (item) => Number(item.id) === intent.conversationId,
        );
        state.pendingCallIntentHandled = true;
        state.pendingCallIntent = null;
        if (conversation && conversation.kind !== "group") {
          await selectConversation(conversation);
          await startCall(intent.media);
        } else {
          setCallStatus(copy("error"), true);
        }
      }
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function searchDirectory(event) {
    event?.preventDefault();
    const query = $('[data-network-query]').value.trim();
    const feedback = $('[data-network-feedback]');
    if (query.length < 2) return;
    setFeedback(feedback, copy("loading"), false);
    try {
      const payload = await api(`/api/messaging/directory/search?q=${encodeURIComponent(query)}`);
      renderDirectoryResults(payload.results || []);
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function requestFriend(publicId) {
    const feedback = $('[data-network-feedback]');
    try {
      await api("/api/messaging/connections/request", jsonOptions("POST", { public_id: publicId }));
      $('[data-network-query]').value = "";
      await loadConnections();
      await loadSummary();
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function updateConnection(id, action) {
    const feedback = $('[data-network-feedback]');
    try {
      await api(`/api/messaging/connections/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: "POST" });
      await Promise.all([loadConnections(), loadOnline(), loadSummary()]);
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function openConversation(peer) {
    const feedback = $('[data-network-feedback]');
    if (!peer?.owner_type || peer.owner_id === undefined) return;
    try {
      const payload = await api("/api/messaging/conversations", jsonOptions("POST", {
        peer_type: peer.owner_type,
        peer_id: peer.owner_id,
      }));
      const conversation = { ...(payload.conversation || {}), peer };
      await selectConversation(conversation);
      await loadConversations();
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  function stopQrScanner() {
    state.qrScanner?.stop();
    const video = $('[data-qr-video]');
    if (video) video.hidden = true;
  }

  function clearQrPreview() {
    state.qrProfile = null;
    $('[data-qr-preview]').hidden = true;
    $('[data-qr-confirm]').disabled = true;
    $('[data-qr-add-friend]').hidden = true;
    $('[data-qr-add-friend]').disabled = true;
    $('[data-qr-preview-name]').textContent = "-";
    $('[data-qr-preview-id]').textContent = "-";
    $('[data-qr-preview-type]').textContent = "";
    $('[data-qr-preview-avatar]').textContent = "T";
  }

  function closeQrScanner() {
    stopQrScanner();
    const modal = $('[data-qr-modal]');
    modal.hidden = true;
    clearQrPreview();
    setFeedback($('[data-qr-feedback]'), "", false);
    const returnFocus = state.qrReturnFocus;
    state.qrReturnFocus = null;
    if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
  }

  async function resolveQrValue(value) {
    const feedback = $('[data-qr-feedback]');
    const candidate = String(value || "").trim();
    if (!candidate) {
      setFeedback(feedback, copy("qrInvalid"), true);
      return false;
    }
    setFeedback(feedback, copy("qrResolving"), false);
    stopQrScanner();
    try {
      const payload = await api(
        "/api/messaging/directory/qr/resolve",
        jsonOptions("POST", { value: candidate }),
      );
      const profile = payload.profile || null;
      if (!profile?.public_id) throw new Error("messaging.qr.invalid");
      state.qrProfile = profile;
      $('[data-qr-preview-name]').textContent = profile.display_name || profile.public_id;
      $('[data-qr-preview-id]').textContent = profile.public_id;
      $('[data-qr-preview-type]').textContent = profile.owner_type === "business"
        ? copy("qrBusiness")
        : copy("qrMember");
      $('[data-qr-preview-avatar]').textContent = initials(profile);
      const addFriendButton = $('[data-qr-add-friend]');
      const noActionRelationship = new Set(["accepted", "pending_sent", "pending_received"]);
      addFriendButton.hidden = noActionRelationship.has(profile.relationship);
      addFriendButton.disabled = addFriendButton.hidden;
      $('[data-qr-preview]').hidden = false;
      $('[data-qr-confirm]').disabled = false;
      setFeedback(feedback, copy("qrReady").replace("{id}", profile.public_id), false);
      $('[data-qr-confirm]').focus();
      return true;
    } catch (error) {
      clearQrPreview();
      setFeedback(feedback, error?.status === 429 ? errorMessage(error) : copy("qrInvalid"), true);
      return false;
    }
  }

  function openQrScanner(event) {
    const modal = $('[data-qr-modal]');
    state.qrReturnFocus = event?.currentTarget || document.activeElement;
    modal.hidden = false;
    clearQrPreview();
    $('[data-qr-manual]').value = "";
    setFeedback($('[data-qr-feedback]'), "", false);
    $('[data-qr-camera]').focus();
  }

  function ensureQrScannerInstance() {
    if (state.qrScanner || typeof window.TimeblockQrScanner !== "function") {
      return state.qrScanner;
    }
    const video = $('[data-qr-video]');
    if (!video) return null;
    state.qrScanner = new window.TimeblockQrScanner({
      video,
      scanIntervalMs: 320,
      onValue: resolveQrValue,
    });
    return state.qrScanner;
  }

  async function ensureQrScannerReady() {
    const scanner = ensureQrScannerInstance();
    if (scanner) return scanner;
    const pending = window.__TIMEBLOCK_QR_SCANNER_READY__;
    if (pending && typeof pending.then === "function") {
      await pending.catch(() => null);
    }
    return ensureQrScannerInstance();
  }

  async function startQrCamera(event) {
    const button = event.currentTarget;
    const feedback = $('[data-qr-feedback]');
    const video = $('[data-qr-video]');
    button.disabled = true;
    clearQrPreview();
    setFeedback(feedback, copy("loading"), false);
    try {
      const scanner = await ensureQrScannerReady();
      if (!scanner) throw new Error("qr-unsupported");
      video.hidden = false;
      await scanner.startCamera();
      setFeedback(feedback, "", false);
    } catch (error) {
      stopQrScanner();
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setFeedback(feedback, denied ? copy("qrPermission") : copy("qrUnsupported"), true);
    } finally {
      button.disabled = false;
    }
  }

  async function scanQrFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const feedback = $('[data-qr-feedback]');
    try {
      clearQrPreview();
      setFeedback(feedback, copy("loading"), false);
      const scanner = await ensureQrScannerReady();
      if (!scanner) throw new Error("qr-unsupported");
      const value = await scanner.decodeFile(file);
      if (!value || !(await resolveQrValue(value))) setFeedback(feedback, copy("qrInvalid"), true);
    } catch (error) {
      setFeedback(
        feedback,
        error?.message === "qr-invalid-file" ? copy("qrInvalid") : copy("qrUnsupported"),
        true,
      );
    } finally {
      event.currentTarget.value = "";
    }
  }

  async function confirmQrProfile(event) {
    const profile = state.qrProfile;
    if (!profile?.public_id) return;
    const button = event.currentTarget;
    button.disabled = true;
    setFeedback($('[data-qr-feedback]'), copy("loading"), false);
    try {
      if (!new Set(["accepted", "pending_sent", "pending_received"]).has(profile.relationship)) {
        await api(
          "/api/messaging/connections/request",
          jsonOptions("POST", { public_id: profile.public_id }),
        );
      }
      closeQrScanner();
      activateMode("messages", true, false);
      $('[data-network-query]').value = profile.public_id;
      await Promise.all([searchDirectory(), loadConnections(), loadSummary()]);
      setFeedback(
        $('[data-network-feedback]'),
        copy("qrReady").replace("{id}", profile.public_id),
        false,
      );
    } catch (error) {
      button.disabled = false;
      setFeedback($('[data-qr-feedback]'), errorMessage(error), true);
    }
  }

  function trapQrDialogFocus(event) {
    const modal = $('[data-qr-modal]');
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeQrScanner();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      $('[data-qr-dialog]').querySelectorAll(
        'button:not([disabled]), input:not([disabled]), label[tabindex="0"]',
      ),
    ).filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyMyPublicId() {
    const publicId = state.me?.public_id || $('[data-network-public-id]')?.textContent?.trim();
    if (!publicId) return;
    try {
      await navigator.clipboard.writeText(publicId);
      setFeedback($('[data-network-feedback]'), copy("copySuccess"), false);
    } catch (_error) {
      const helper = document.createElement("textarea");
      helper.value = publicId;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      setFeedback($('[data-network-feedback]'), copy("copySuccess"), false);
    }
  }

  async function shareMyContact() {
    const publicId = state.me?.public_id;
    if (!publicId) return;
    const url = new URL("/assistant", window.location.origin);
    url.searchParams.set("mode", "messages");
    url.searchParams.set("connect", publicId);
    url.searchParams.set("source", "share");
    url.searchParams.set("lang", app.dataset.locale || "vi");
    const shareData = {
      title: "Timeblock",
      text: `${copy("shareQr")} ${publicId}`,
      url: url.href,
    };
    try {
      if (navigator.share) {
        const response = await fetch($('[data-network-qr]').src, { credentials: "same-origin" });
        if (response.ok && navigator.canShare) {
          const blob = await response.blob();
          const file = new File([blob], "timeblock-contact-qr.png", { type: blob.type || "image/png" });
          if (navigator.canShare({ files: [file] })) shareData.files = [file];
        }
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url.href);
      }
      setFeedback($('[data-network-feedback]'), copy("shareSuccess"), false);
    } catch (error) {
      if (error?.name !== "AbortError") setFeedback($('[data-network-feedback]'), errorMessage(error), true);
    }
  }

  function initQrScanner() {
    ensureQrScannerInstance();
    $('[data-qr-scan]').addEventListener("click", openQrScanner);
    $('[data-qr-camera]').addEventListener("click", startQrCamera);
    $('[data-qr-close]').addEventListener("click", closeQrScanner);
    $('[data-qr-cancel]').addEventListener("click", closeQrScanner);
    $('[data-qr-confirm]').addEventListener("click", confirmQrProfile);
    $('[data-qr-add-friend]').addEventListener("click", confirmQrProfile);
    $('[data-qr-file]').addEventListener("change", scanQrFile);
    $('[data-qr-manual-form]').addEventListener("submit", async (event) => {
      event.preventDefault();
      await resolveQrValue($('[data-qr-manual]').value);
    });
    $('[data-qr-modal]').addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeQrScanner();
    });
    $('[data-qr-modal]').addEventListener("keydown", trapQrDialogFocus);
    $('[data-network-copy-id]')?.addEventListener("click", copyMyPublicId);
    $('[data-network-share-qr]')?.addEventListener("click", shareMyContact);
  }

  function messageSignature(messages) {
    if (!Array.isArray(messages) || !messages.length) return "empty";
    return messages.map((message) => {
      const reactions = (message.reactions || [])
        .map((reaction) => `${reaction.reaction}:${reaction.count}:${reaction.reacted_by_me ? 1 : 0}`)
        .join(",");
      const receipts = (message.receipts || [])
        .map((receipt) => `${receipt.owner_type}:${receipt.owner_id}:${receipt.delivered_at || ""}:${receipt.read_at || ""}`)
        .join(",");
      return [
        message.id,
        message.revision || 0,
        message.edited_at || "",
        message.deleted_for_everyone_at || "",
        message.pinned_by_me ? 1 : 0,
        reactions,
        receipts,
      ].join(":");
    }).join("|");
  }

  function renderThreadMessages(messages, options = {}) {
    const container = $('[data-thread-messages]');
    const items = Array.isArray(messages) ? messages : [];
    state.threadMessages = items;
    state.messageSignature = messageSignature(items);
    if (!items.length) {
      replaceWithEmpty(container, copy("empty"));
      emitMessagingEvent("messages", {
        conversation: state.conversation,
        messages: [],
        page: state.messagePage,
      });
      return;
    }
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    const renderSignature = (message) => JSON.stringify([
      message.revision || 0,
      message.content || "",
      message.content_type || "text",
      message.edited_at || "",
      message.deleted_for_everyone_at || "",
      message.pinned_by_me ? 1 : 0,
      message.attachments || {},
      message.reactions || [],
      message.receipts || [],
      message.reply_to || null,
    ]);
    const rows = items.map((message) => {
      const context = message.context && typeof message.context === "object" ? message.context : {};
      if (context.kind === "call_event") {
        const eventRow = createElement("article", "assistant-call-event");
        eventRow.dataset.messageId = String(message.id);
        eventRow.dataset.messageKind = "call_event";
        eventRow.dataset.messageRenderSignature = renderSignature(message);
        const eventIcon = createElement("span", "assistant-call-event-icon");
        eventIcon.setAttribute("aria-hidden", "true");
        eventIcon.appendChild(iconElement(context.media === "video" ? "video" : "phone"));
        const eventCopy = createElement("span", "assistant-call-event-copy");
        const duration = formatCallDuration(context.duration_seconds);
        eventCopy.append(
          createElement("strong", "", callEventLabel(context.event)),
          createElement("small", "", [
            context.media === "video" ? copy("callVideo") : copy("callAudio"),
            duration,
            formatDate(message.created_at),
          ].filter(Boolean).join(" · ")),
        );
        eventRow.append(eventIcon, eventCopy);
        return eventRow;
      }
      const mine = state.me
        && message.sender_type === state.me.owner_type
        && String(message.sender_id) === String(state.me.owner_id);
      const bubble = createElement("article", `assistant-thread-bubble${mine ? " is-mine" : ""}`);
      bubble.dataset.messageId = String(message.id);
      bubble.dataset.messageOwner = mine ? "mine" : "theirs";
      bubble.dataset.messageContentType = message.content_type || "text";
      bubble.dataset.messageRenderSignature = renderSignature(message);
      if (context.kind === "ptt") {
        bubble.classList.add("is-ptt");
        const pttHeading = createElement("div", "assistant-ptt-message-heading");
        const pttIcon = createElement("span", "assistant-record-icon");
        pttIcon.setAttribute("aria-hidden", "true");
        pttIcon.appendChild(iconElement("mic"));
        pttHeading.append(
          pttIcon,
          createElement("strong", "", copy("pttMessage")),
          context.source_language ? createElement("small", "", context.source_language) : document.createTextNode(""),
        );
        bubble.appendChild(pttHeading);
      }
      const attachment = privateImage(message.attachments, "/api/messaging/media/", "assistant-thread-image");
      if (attachment) bubble.appendChild(attachment);
      else if (message.attachments && message.attachments.expired) {
        bubble.appendChild(createElement("div", "assistant-media-expired", copy("mediaExpired")));
      }
      if (message.content && !(attachment && message.content === "image")) {
        bubble.appendChild(createElement("div", "assistant-thread-text", message.content));
      }
      const time = createElement("time", "", formatDate(message.created_at));
      if (message.created_at) time.dateTime = String(message.created_at);
      bubble.appendChild(time);
      return bubble;
    });
    const existingById = new Map(
      Array.from(container.children)
        .filter((row) => row.dataset?.messageId)
        .map((row) => [row.dataset.messageId, row]),
    );
    const desiredRows = rows.map((row) => {
      const existing = existingById.get(row.dataset.messageId);
      return existing
        && existing.dataset.messageRenderSignature === row.dataset.messageRenderSignature
        ? existing
        : row;
    });
    desiredRows.forEach((row, index) => {
      if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
    });
    const desiredSet = new Set(desiredRows);
    Array.from(container.children).forEach((row) => {
      if (!desiredSet.has(row)) row.remove();
    });
    emitMessagingEvent("messages", {
      conversation: state.conversation,
      messages: items,
      page: state.messagePage,
    });
    if (options.preserveScroll) {
      container.scrollTop = previousScrollTop + (container.scrollHeight - previousScrollHeight);
    } else if (nearBottom || !container.dataset.rendered) {
      container.scrollTop = container.scrollHeight;
    }
    container.dataset.rendered = "true";
  }

  async function loadConversationMessages(silent = false, forceLatest = false) {
    if (!state.conversation) return;
    try {
      const previousPage = state.messagePage;
      const previousMessages = state.threadMessages;
      const lastMessageId = previousMessages[previousMessages.length - 1]?.id;
      const useAfterCursor = silent && !forceLatest && lastMessageId;
      const query = useAfterCursor
        ? `limit=30&after_message_id=${encodeURIComponent(lastMessageId)}`
        : "limit=30";
      const payload = await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/messages?${query}`,
      );
      let nextMessages = payload.messages || [];
      if (useAfterCursor) {
        nextMessages = [...previousMessages, ...nextMessages];
        state.messagePage = {
          ...payload,
          next_before_cursor: previousPage?.next_before_cursor,
          has_more_before: previousPage?.has_more_before,
        };
      } else if (forceLatest && previousMessages.length && nextMessages.length) {
        const firstLatestId = Number(nextMessages[0].id);
        const loadedOlder = previousMessages.filter((message) => Number(message.id) < firstLatestId);
        nextMessages = [...loadedOlder, ...nextMessages];
        state.messagePage = {
          ...payload,
          next_before_cursor: loadedOlder.length ? previousPage?.next_before_cursor : payload.next_before_cursor,
          has_more_before: loadedOlder.length ? previousPage?.has_more_before : payload.has_more_before,
        };
      } else {
        state.messagePage = payload;
      }
      nextMessages = Array.from(
        new Map(nextMessages.map((message) => [Number(message.id), message])).values(),
      ).sort((left, right) => Number(left.id) - Number(right.id));
      const signature = messageSignature(nextMessages);
      if (signature !== state.messageSignature) {
        const previousSignature = state.messageSignature;
        renderThreadMessages(nextMessages);
        if (previousSignature) notifyForIncomingMessage(nextMessages);
      } else {
        emitMessagingEvent("messages", {
          conversation: state.conversation,
          messages: state.threadMessages,
          page: state.messagePage,
        });
      }
      if (!silent) setCallStatus("");
      await loadSummary();
    } catch (error) {
      if (!silent) setCallStatus(errorMessage(error), true);
    }
  }

  async function loadOlderConversationMessages() {
    if (!state.conversation || !state.messagePage?.has_more_before) return;
    const cursor = state.messagePage.next_before_cursor;
    if (!cursor) return;
    const conversationId = state.conversation.id;
    const payload = await api(
      `/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`
      + `?limit=30&before_message_id=${encodeURIComponent(cursor)}`,
    );
    if (!state.conversation || Number(state.conversation.id) !== Number(conversationId)) return;
    const combined = [...(payload.messages || []), ...state.threadMessages];
    const unique = Array.from(
      new Map(combined.map((message) => [Number(message.id), message])).values(),
    ).sort((left, right) => Number(left.id) - Number(right.id));
    state.messagePage = {
      ...payload,
      next_after_cursor: state.messagePage.next_after_cursor,
      has_more_after: state.messagePage.has_more_after,
    };
    renderThreadMessages(unique, { preserveScroll: true });
  }

  async function ensureConversationMessageLoaded(messageId, maxPages = 50) {
    const targetId = Number(messageId || 0);
    if (!targetId || !state.conversation) return false;
    const conversationId = Number(state.conversation.id || 0);
    for (let page = 0; page < maxPages; page += 1) {
      if (Number(state.conversation?.id || 0) !== conversationId) return false;
      if (state.threadMessages.some((message) => Number(message.id) === targetId)) {
        return true;
      }
      if (!state.messagePage?.has_more_before) return false;
      await loadOlderConversationMessages();
    }
    return Number(state.conversation?.id || 0) === conversationId
      && state.threadMessages.some((message) => Number(message.id) === targetId);
  }

  async function selectConversation(conversation) {
    if (!conversation?.id || conversation?.kind === "group") return;
    const stored = state.conversations.find((item) => Number(item.id) === Number(conversation.id));
    if (stored) stored.unread_count = 0;
    state.conversation = { ...(stored || {}), ...conversation };
    app.dataset.activeMessagingConversationId = String(state.conversation.id);
    app.dispatchEvent(new CustomEvent("timeblock:assistant:conversation-selected", {
      detail: { conversation: state.conversation },
    }));
    emitMessagingEvent("conversation", { conversation: state.conversation });
    const peer = conversationPeer(state.conversation) || {};
    $('[data-thread-title]').textContent = peer.display_name || peer.public_id || copy("empty");
    $('[data-thread-subtitle]').textContent = peer.public_id || "";
    $('[data-message-form]').hidden = false;
    $('[data-call-actions]').hidden = false;
    $('[data-messaging-layout]').classList.add("has-thread");
    state.messageSignature = "";
    state.threadMessages = [];
    state.messagePage = null;
    await loadConversationMessages(false);
    renderConversations(state.conversations);
  }

  async function sendConversationMessage(event) {
    event.preventDefault();
    if (!state.conversation || state.conversation.kind === "group") return;
    const input = $('[data-message-input]');
    const imageInput = $('[data-message-file]');
    const content = input.value.trim();
    const image = imageInput.files && imageInput.files[0];
    const pendingAttachment = window.TimeblockMessagingComposerAttachmentsV2?.getPending?.(event.currentTarget);
    const hasAttachment = Boolean(image || pendingAttachment);
    if (!content && !hasAttachment) return;
    const replyToMessageId = app.dataset.messagingReplyToMessageId || "";
    const requestSignature = [
      state.conversation.id,
      content,
      replyToMessageId,
      image?.name || "",
      image?.size || 0,
      image?.lastModified || 0,
      pendingAttachment?.type || "",
      pendingAttachment?.name || "",
      pendingAttachment?.size || 0,
      pendingAttachment?.durationSeconds || 0,
      pendingAttachment?.location?.latitude || "",
      pendingAttachment?.location?.longitude || "",
    ].join(":");
    if (!state.pendingMessage || state.pendingMessage.signature !== requestSignature) {
      state.pendingMessage = {
        signature: requestSignature,
        clientMessageId: createClientMessageId(),
      };
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      let options = jsonOptions("POST", {
        content,
        content_type: "text",
        client_message_id: state.pendingMessage.clientMessageId,
        reply_to_message_id: replyToMessageId || null,
      });
      if (hasAttachment) {
        const data = new FormData();
        data.append("content", content);
        if (image) data.append("image", image, image.name);
        data.append("client_message_id", state.pendingMessage.clientMessageId);
        if (replyToMessageId) data.append("reply_to_message_id", replyToMessageId);
        window.TimeblockMessagingComposerAttachmentsV2?.decorateFormData(event.currentTarget, data);
        options = { method: "POST", body: data };
      }
      await api(`/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/messages`, options);
      state.pendingMessage = null;
      input.value = "";
      imageInput.value = "";
      resizeTextarea(input);
      emitMessagingEvent("message-sent", {});
      await Promise.all([loadConversationMessages(false, true), loadConversations()]);
    } catch (error) {
      setCallStatus(errorMessage(error), true);
    } finally {
      submit.disabled = false;
    }
  }

  async function loadSummary() {
    try {
      const payload = await api("/api/messaging/notifications/summary");
      const summary = payload.summary || {};
      state.summary = summary;
      const total = Number(summary.total ?? summary.unread_count) || 0;
      const messageTotal = (Number(summary.unread_conversation_messages) || 0)
        + (Number(summary.pending_friend_requests) || 0)
        + (Number(summary.ringing_calls) || 0);
      setBadge($('[data-assistant-badge]'), total);
      setBadge($('[data-message-tab-badge]'), messageTotal);
      document.querySelectorAll('[data-global-assistant-badge]').forEach((badge) => setBadge(badge, total));
    } catch (_error) {
      // Global notification polling must fail quietly when the session expires.
    }
  }

  function openNotificationCenter() {
    const summary = state.summary || {};
    const messagingAttention = (Number(summary.unread_conversation_messages) || 0)
      + (Number(summary.pending_friend_requests) || 0)
      + (Number(summary.ringing_calls) || 0);
    activateMode(messagingAttention > 0 ? "messages" : "alerts");
  }

  function initMessaging() {
    state.callIdleText = $('[data-call-status]').textContent || "";
    $('[data-network-search]').addEventListener("submit", searchDirectory);
    $('[data-network-query]').addEventListener("input", (event) => {
      if (!event.currentTarget.value.trim()) {
        renderConnections(state.connections);
        setFeedback($('[data-network-feedback]'), "", false);
      }
    });
    $('[data-message-form]').addEventListener("submit", sendConversationMessage);
    $('[data-message-file]').addEventListener("change", (event) => {
      const file = event.currentTarget.files && event.currentTarget.files[0];
      setCallStatus(file ? copy("imageSelected").replace("{name}", file.name) : "");
    });
    $('[data-message-input]').addEventListener("input", (event) => resizeTextarea(event.currentTarget));
    $('[data-message-input]').addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $('[data-message-form]').requestSubmit();
      }
    });
    $('[data-thread-back]').addEventListener("click", () => {
      const layout = $('[data-messaging-layout]');
      layout.classList.remove("has-thread");
    });
    app.addEventListener("timeblock:messaging:filter", (event) => {
      loadConversations(event.detail || {}).catch((error) => {
        setFeedback($('[data-network-feedback]'), errorMessage(error), true);
      });
    });
    app.addEventListener("timeblock:messaging:load-older", () => {
      loadOlderConversationMessages().catch((error) => setCallStatus(errorMessage(error), true));
    });
    app.addEventListener("timeblock:messaging:jump-to-message", (event) => {
      const messageId = Number(event.detail?.messageId || 0);
      const conversationId = Number(state.conversation?.id || 0);
      if (!messageId || !conversationId) return;
      ensureConversationMessageLoaded(messageId)
        .then((found) => {
          emitMessagingEvent("jump-result", { messageId, found });
        })
        .catch((error) => {
          setCallStatus(errorMessage(error), true);
          emitMessagingEvent("jump-result", { messageId, found: false });
        });
    });
    app.addEventListener("timeblock:messaging:refresh", (event) => {
      const scope = event.detail?.scope || "all";
      const tasks = [];
      if (scope !== "thread") tasks.push(loadConversations());
      if (scope !== "conversations" && state.conversation) tasks.push(loadConversationMessages(true, true));
      if (!tasks.length) return;
      Promise.all(tasks).catch((error) => setCallStatus(errorMessage(error), true));
    });
    $('[data-call-history-refresh]')?.addEventListener("click", () => {
      loadCallHistory().catch((error) => setFeedback($('[data-call-history-feedback]'), errorMessage(error), true));
    });
  }

  function localNotificationPreferences() {
    try {
      return JSON.parse(localStorage.getItem("timeblockNotificationPreferences") || "{}");
    } catch (_error) {
      return {};
    }
  }

  function notifyForIncomingMessage(messages) {
    const latest = Array.isArray(messages) ? messages[messages.length - 1] : null;
    if (!latest || !state.me) return;
    const mine = latest.sender_type === state.me.owner_type
      && String(latest.sender_id) === String(state.me.owner_id);
    if (mine) return;
    const preferences = localNotificationPreferences();
    if (preferences.vibration_enabled !== false && navigator.vibrate) navigator.vibrate(90);
    if (preferences.in_app_sound_enabled === false || !state.audioContext) return;
    try {
      const oscillator = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, state.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, state.audioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + 0.16);
      oscillator.connect(gain).connect(state.audioContext.destination);
      oscillator.start();
      oscillator.stop(state.audioContext.currentTime + 0.17);
    } catch (_error) {
      // In-app sound is best-effort and never blocks message rendering.
    }
  }

  function unlockNotificationAudio() {
    if (state.audioContext && state.audioContext.state !== "closed") return;
    state.audioContext = null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    state.audioContext.resume?.().catch(() => undefined);
  }

  function closeNotificationAudioContext() {
    const context = state.audioContext;
    state.audioContext = null;
    if (!context) return Promise.resolve();
    document.addEventListener("pointerdown", unlockNotificationAudio, {
      once: true,
      passive: true,
    });
    if (context.state === "closed" || typeof context.close !== "function") return Promise.resolve();
    try {
      return Promise.resolve(context.close()).catch(() => undefined);
    } catch (_error) {
      return Promise.resolve();
    }
  }

  function scrollContextForInput(input) {
    if (input?.matches("[data-message-input]")) {
      return { key: "messages", container: $('[data-thread-messages]') };
    }
    if (input?.matches("[data-ai-input]")) {
      return { key: "ai", container: $('[data-ai-messages]') };
    }
    if (input?.matches("[data-live-translate-text]")) {
      return {
        key: "translate",
        container: input.closest("[data-live-translate]") || $("#assistant-panel-translate"),
      };
    }
    if (input?.matches("[data-image-generation-prompt]")) {
      return {
        key: "image",
        container: input.closest(".assistant-image-generation-panel"),
      };
    }
    return null;
  }

  function isNearScrollEnd(container, threshold = 96) {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  }

  function rememberScrollPin(input = document.activeElement) {
    const context = scrollContextForInput(input);
    if (!context) return;
    state.scrollPins[context.key] = isNearScrollEnd(context.container);
  }

  function applyVisualViewport() {
    state.viewportFrame = null;
    const viewport = window.visualViewport;
    const visibleHeight = Math.round(viewport?.height || window.innerHeight);
    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
    const pageTop = Math.max(0, Math.round(viewport?.pageTop || 0));
    const visibleBottom = offsetTop + visibleHeight;
    const currentLayoutHeight = Math.round(window.innerHeight);
    const activeContext = scrollContextForInput(document.activeElement);
    const wasKeyboardOpen = document.body.classList.contains("is-keyboard-open");

    if (!state.layoutViewportHeight || (!activeContext && !wasKeyboardOpen)) {
      state.layoutViewportHeight = currentLayoutHeight;
    } else if (currentLayoutHeight > state.layoutViewportHeight) {
      state.layoutViewportHeight = currentLayoutHeight;
    }

    const layoutHeight = Math.max(currentLayoutHeight, state.layoutViewportHeight);
    const keyboardHeight = Math.max(0, layoutHeight - visibleHeight - offsetTop);
    const keyboardThreshold = Math.max(96, Math.round(layoutHeight * 0.12));
    const keyboardOpen = keyboardHeight > keyboardThreshold && Boolean(activeContext || wasKeyboardOpen);

    document.body.style.setProperty("--assistant-visual-viewport-height", `${visibleHeight}px`);
    document.body.style.setProperty("--assistant-visual-viewport-offset-top", `${offsetTop}px`);
    document.body.style.setProperty("--assistant-visual-viewport-bottom", `${visibleBottom}px`);
    document.body.style.setProperty("--assistant-visual-viewport-page-top", `${pageTop}px`);
    document.body.style.setProperty("--assistant-keyboard-height", `${keyboardOpen ? keyboardHeight : 0}px`);
    document.body.classList.toggle("is-keyboard-open", keyboardOpen);

    // Direct Chat and AI Advisor intentionally pin to the latest message while
    // the keyboard opens. Live Translate and Image Prompt own their own form
    // scroll surfaces, so never force either panel to its bottom here.
    if (
      keyboardOpen
      && activeContext
      && ["messages", "ai"].includes(activeContext.key)
      && state.scrollPins[activeContext.key]
    ) {
      window.requestAnimationFrame(() => {
        activeContext.container.scrollTop = activeContext.container.scrollHeight;
      });
    }
  }

  function syncVisualViewport() {
    if (state.viewportFrame) window.cancelAnimationFrame(state.viewportFrame);
    state.viewportFrame = window.requestAnimationFrame(applyVisualViewport);
  }

  function initVisualViewport() {
    state.viewportCleanup?.();
    const viewport = window.visualViewport;
    const aiMessages = $('[data-ai-messages]');
    const threadMessages = $('[data-thread-messages]');
    const handleFocusIn = (event) => {
      rememberScrollPin(event.target);
      syncVisualViewport();
    };
    const handleOrientationChange = () => {
      state.layoutViewportHeight = 0;
      syncVisualViewport();
    };
    const handleAiScroll = () => {
      state.scrollPins.ai = isNearScrollEnd(aiMessages);
    };
    const handleThreadScroll = () => {
      state.scrollPins.messages = isNearScrollEnd(threadMessages);
    };

    syncVisualViewport();
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    window.addEventListener("resize", syncVisualViewport);
    window.addEventListener("orientationchange", handleOrientationChange);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", syncVisualViewport);
    aiMessages?.addEventListener("scroll", handleAiScroll, { passive: true });
    threadMessages?.addEventListener("scroll", handleThreadScroll, { passive: true });
    document.addEventListener("pointerdown", unlockNotificationAudio, {
      once: true,
      passive: true,
    });
    state.viewportCleanup = () => {
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
      window.removeEventListener("resize", syncVisualViewport);
      window.removeEventListener("orientationchange", handleOrientationChange);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", syncVisualViewport);
      aiMessages?.removeEventListener("scroll", handleAiScroll);
      threadMessages?.removeEventListener("scroll", handleThreadScroll);
      if (state.viewportFrame) window.cancelAnimationFrame(state.viewportFrame);
      state.viewportFrame = null;
      state.viewportCleanup = null;
    };
  }

  function setCallStatus(message, isError = false) {
    setFeedback($('[data-call-status]'), message || state.callIdleText, isError);
  }

  function ownerToken() {
    return state.me ? `${state.me.owner_type}:${state.me.owner_id}` : "";
  }

  function startRingtone(call) {
    state.ringtone?.start(call?.id, { media: call?.media }).catch(() => {});
  }

  function stopRingtone(callId = "") {
    state.ringtone?.stop(callId);
  }

  function callPeer(call) {
    const conversation = state.conversations.find((item) => Number(item.id) === Number(call?.conversation_id));
    return conversationPeer(conversation) || {};
  }

  async function showIncomingCallNotification(call) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !call?.id) return;
    if (state.notifiedCallIds.has(call.id)) return;
    state.notifiedCallIds.add(call.id);
    if (state.notifiedCallIds.size > 40) state.notifiedCallIds.delete(state.notifiedCallIds.values().next().value);
    const peer = callPeer(call);
    const title = `${copy("incoming")} · ${incomingMediaLabel(call.media)}`;
    const body = peer.display_name || peer.public_id || "Timeblock";
    const options = {
      body,
      tag: `timeblock-call-${call.id}`,
      renotify: true,
      requireInteraction: true,
      icon: "/static/img/timeblock-icon.svg",
      badge: "/static/img/timeblock-icon.svg",
      data: { url: `/assistant?mode=messages&call_id=${encodeURIComponent(call.id)}` },
    };
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    } catch (_error) {
      try { new Notification(title, options); } catch (_ignored) { /* Permission can change asynchronously. */ }
    }
  }

  async function enableCallNotifications() {
    const feedback = $('[data-network-feedback]');
    await state.ringtone?.arm();
    if (!("Notification" in window)) {
      setFeedback(feedback, copy("callNotificationsDenied"), true);
      return;
    }
    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      setFeedback(
        feedback,
        permission === "granted" ? copy("callNotificationsEnabled") : copy("callNotificationsDenied"),
        permission !== "granted",
      );
    } catch (_error) {
      setFeedback(feedback, copy("callNotificationsDenied"), true);
    }
  }

  function initRingtone() {
    if (CALL_V1_ASSISTANT_OWNERSHIP) return;
    if (!window.IncomingCallRingtoneController) return;
    state.ringtone = new window.IncomingCallRingtoneController();
    const enabled = $('[data-ringtone-enabled]');
    const volume = $('[data-ringtone-volume]');
    const volumeOutput = $('[data-ringtone-volume-output]');
    const duration = $('[data-ringtone-duration]');
    const preview = $('[data-ringtone-preview]');
    if (!enabled || !volume || !volumeOutput || !duration || !preview) return;

    const renderPreferences = () => {
      const preferences = state.ringtone.getPreferences();
      enabled.checked = preferences.enabled;
      volume.value = String(Math.round(preferences.volume * 100));
      volumeOutput.textContent = `${Math.round(preferences.volume * 100)}%`;
      duration.value = String(preferences.maxDurationMs);
    };
    const savePreferences = () => {
      state.ringtone.setPreferences({
        enabled: enabled.checked,
        volume: Number(volume.value) / 100,
        maxDurationMs: Number(duration.value),
      });
      renderPreferences();
    };

    enabled.addEventListener("change", savePreferences);
    volume.addEventListener("input", () => {
      volumeOutput.textContent = `${volume.value}%`;
    });
    volume.addEventListener("change", savePreferences);
    duration.addEventListener("change", savePreferences);
    preview.addEventListener("click", async () => {
      const feedback = $('[data-network-feedback]');
      const started = await state.ringtone.preview();
      setFeedback(feedback, started ? copy("ringtonePreviewing") : copy("ringtoneUnavailable"), !started);
    });
    renderPreferences();
  }

  async function iceServers(forceRefresh = false, context = null) {
    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && state.iceServers.length && (!state.iceRefreshAt || state.iceRefreshAt > now)) {
      return state.iceServers;
    }
    const abortEntry = context ? registerCallAbortController(context) : null;
    try {
      const payload = await api("/api/messaging/ice-servers", {
        signal: abortEntry?.controller?.signal,
      });
      if (context && !isCurrentCallContext(context)) throw abortCallError();
      state.iceServers = Array.isArray(payload.ice_servers) ? payload.ice_servers : [];
      state.iceExpiresAt = Number(payload.expires_at) || 0;
      const refreshInSeconds = Number(payload.refresh_in_seconds) || 0;
      state.iceRefreshAt = refreshInSeconds > 0
        ? now + refreshInSeconds
        : Number(payload.refresh_after) || (
          state.iceExpiresAt ? Math.max(now + 30, state.iceExpiresAt - 60) : 0
        );
      return state.iceServers;
    } finally {
      releaseCallAbortController(abortEntry);
    }
  }

  function clearIceRefreshTimers() {
    if (state.iceRefreshTimer) window.clearTimeout(state.iceRefreshTimer);
    if (state.iceDisconnectedTimer) window.clearTimeout(state.iceDisconnectedTimer);
    state.iceRefreshTimer = null;
    state.iceDisconnectedTimer = null;
  }

  function callOwnedByCurrentPrincipal(call = state.activeCall) {
    return Boolean(
      call
      && call.caller_type === state.me?.owner_type
      && String(call.caller_id) === String(state.me?.owner_id),
    );
  }

  function scheduleIceCredentialRefresh() {
    if (state.iceRefreshTimer) window.clearTimeout(state.iceRefreshTimer);
    state.iceRefreshTimer = null;
    if (!state.peer || !state.activeCall || !state.iceRefreshAt) return;
    const delay = Math.max(5000, (state.iceRefreshAt * 1000) - Date.now() + 1000);
    state.iceRefreshTimer = window.setTimeout(() => {
      recoverIceConnection(true).catch((error) => setCallStatus(errorMessage(error), true));
    }, Math.min(delay, 2147483647));
  }

  async function refreshPeerIceConfiguration(forceRefresh = true) {
    const peer = state.peer;
    const attempt = state.callAttempt;
    if (!isCurrentPeer(peer, attempt)) return;
    const context = captureCallContext(attempt);
    const servers = await iceServers(forceRefresh, context);
    if (!isCurrentPeer(peer, attempt) || !isCurrentCallContext(context)) return;
    const configuration = peer.getConfiguration();
    peer.setConfiguration({ ...configuration, iceServers: servers });
    scheduleIceCredentialRefresh();
  }

  async function publishIceRestart() {
    const peer = state.peer;
    const call = state.activeCall;
    const attempt = state.callAttempt;
    if (
      !isCurrentPeer(peer, attempt)
      || !call
      || call.status !== "accepted"
      || !callOwnedByCurrentPrincipal(call)
      || peer.signalingState !== "stable"
    ) return;
    const context = captureCallContext(attempt, call.id);
    if (typeof peer.restartIce === "function") peer.restartIce();
    const offer = await peer.createOffer({ iceRestart: true });
    if (!isCurrentPeer(peer, attempt) || !isCurrentCallContext(context)) return;
    await peer.setLocalDescription(offer);
    if (!isCurrentPeer(peer, attempt) || !isCurrentCallContext(context)) return;
    const abortEntry = registerCallAbortController(context);
    try {
      const response = await api(
        `/api/messaging/calls/${encodeURIComponent(call.id)}/signal`,
        {
          ...jsonOptions("POST", {
            kind: "offer",
            payload: { type: offer.type, sdp: offer.sdp },
          }),
          signal: abortEntry.controller.signal,
        },
      );
      if (!isCurrentPeer(peer, attempt) || !isCurrentCallContext(context)) return;
      state.activeCall = response.call;
    } finally {
      releaseCallAbortController(abortEntry);
    }
  }

  async function recoverIceConnection(proactive = false) {
    const peer = state.peer;
    const attempt = state.callAttempt;
    const generation = state.callGeneration;
    if (!isCurrentPeer(peer, attempt) || !state.activeCall || state.iceRecoveryInFlight) return;
    const now = Date.now();
    if (!proactive && now - state.lastIceRecoveryAt < 30000) return;
    state.iceRecoveryInFlight = true;
    state.lastIceRecoveryAt = now;
    try {
      await refreshPeerIceConfiguration(true);
      if (isCurrentPeer(peer, attempt) && callOwnedByCurrentPrincipal()) await publishIceRestart();
    } finally {
      if (state.callGeneration === generation) state.iceRecoveryInFlight = false;
    }
  }

  function safeSessionDescription(value, expectedType) {
    if (!value || value.type !== expectedType || !value.sdp) return null;
    return { type: expectedType, sdp: value.sdp };
  }

  async function applyCallNegotiation(call) {
    const attempt = state.callAttempt;
    if (!state.peer || !isCurrentCallAttempt(attempt) || !call?.id) return;
    setCallPhase("NEGOTIATING", attempt);
    const offerSeq = Number(call?.offer_seq) || 1;
    const answerSeq = Number(call?.answer_seq) || 0;
    const remoteOffer = safeSessionDescription(call?.offer, "offer");
    if (
      remoteOffer
      && call.offer?.source !== ownerToken()
      && offerSeq > state.remoteOfferSeq
      && state.peer.signalingState === "stable"
    ) {
      await refreshPeerIceConfiguration(true);
      if (!isCurrentPeer(state.peer, attempt)) return;
      await state.peer.setRemoteDescription(remoteOffer);
      if (!isCurrentPeer(state.peer, attempt)) return;
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: `remote_description_set_offer_${offerSeq}` });
      const answer = await state.peer.createAnswer();
      await state.peer.setLocalDescription(answer);
      if (!isCurrentPeer(state.peer, attempt)) return;
      state.remoteOfferSeq = offerSeq;
      const negotiationContext = captureCallContext(attempt, call.id);
      const negotiationAbort = registerCallAbortController(negotiationContext);
      let response;
      try {
        response = await api(
          `/api/messaging/calls/${encodeURIComponent(call.id)}/signal`,
          {
            ...jsonOptions("POST", {
              kind: "answer",
              payload: { type: answer.type, sdp: answer.sdp },
            }),
            signal: negotiationAbort.controller.signal,
          },
        );
      } finally {
        releaseCallAbortController(negotiationAbort);
      }
      if (!isCurrentPeer(state.peer, attempt) || !isCurrentCallContext(negotiationContext)) return;
      state.activeCall = response.call;
      state.remoteAnswerSeq = Number(response.call?.answer_seq) || offerSeq;
      await applyRemoteIce(response.call);
      return;
    }
    const remoteAnswer = safeSessionDescription(call?.answer, "answer");
    if (
      remoteAnswer
      && call.answer?.source !== ownerToken()
      && answerSeq === offerSeq
      && answerSeq > state.remoteAnswerSeq
      && state.peer.signalingState === "have-local-offer"
    ) {
      await state.peer.setRemoteDescription(remoteAnswer);
      if (!isCurrentPeer(state.peer, attempt)) return;
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: `remote_description_set_answer_${answerSeq}` });
      state.remoteAnswerSeq = answerSeq;
      setCallPhase("ICE_CONNECTING", attempt);
    }
  }

  function candidatePayload(candidate) {
    if (candidate && typeof candidate.toJSON === "function") return candidate.toJSON();
    return {
      candidate: candidate?.candidate || "",
      sdpMid: candidate?.sdpMid ?? null,
      sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
      usernameFragment: candidate?.usernameFragment ?? null,
    };
  }

  function candidateType(candidate) {
    const value = String(candidate?.candidate || "");
    const match = value.match(/\btyp\s+(host|srflx|relay)\b/i);
    return match ? match[1].toLowerCase() : "";
  }

  async function recordSelectedCandidatePair(peer, attempt) {
    if (!isCurrentPeer(peer, attempt) || typeof peer.getStats !== "function") return;
    try {
      const report = await peer.getStats();
      const entries = [];
      report.forEach((value) => entries.push(value));
      const pair = entries.find((value) => (
        value.type === "candidate-pair"
        && (value.selected || value.nominated)
        && value.state === "succeeded"
      ));
      if (!pair) return;
      const local = entries.find((value) => value.id === pair.localCandidateId);
      callTelemetryFor(attempt, "ice_candidate_pair_selected", {
        candidate_type: String(local?.candidateType || "").toLowerCase(),
        connection_state: String(peer.connectionState || ""),
      }, { onceKey: "ice_candidate_pair_selected" });
    } catch (_error) {
      // Stats are optional and must never affect media.
    }
  }

  function isCurrentPeer(peer, attempt = state.callAttempt) {
    return Boolean(
      peer
      && state.peer === peer
      && attempt
      && state.callAttempt === attempt
      && attempt.lifecycle === "active"
      && attempt.generation === state.callGeneration,
    );
  }

  function listenPeer(peer, eventName, handler) {
    peer.addEventListener(eventName, handler);
    state.peerListeners.push({ peer, eventName, handler });
  }

  function clearPeerListeners(peer) {
    state.peerListeners.forEach((entry) => {
      if (peer && entry.peer !== peer) return;
      try { entry.peer.removeEventListener(entry.eventName, entry.handler); } catch (_error) { /* noop */ }
    });
    state.peerListeners = peer
      ? state.peerListeners.filter((entry) => entry.peer !== peer)
      : [];
  }

  async function preparePeer(media) {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(copy("mediaDenied") || copy("error"));
    }
    const attempt = state.callAttempt;
    callTelemetryFor(attempt, "gum_requested", {}, { onceKey: "gum_requested" });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === "video" ? { facingMode: "user" } : false,
    });
    if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Call attempt is no longer active", "AbortError");
    }
    setCallPhase("NEGOTIATING", attempt);
    callTelemetryFor(attempt, "gum_ready", {}, { onceKey: "gum_ready" });
    let peer;
    try {
      const servers = await iceServers(false, captureCallContext(attempt));
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Call attempt is no longer active", "AbortError");
      }
      peer = new RTCPeerConnection({ iceServers: servers });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    listenPeer(peer, "track", (event) => {
      if (!isCurrentPeer(peer, attempt)) {
        event.track?.stop?.();
        return;
      }
      const remote = $('[data-remote-media]');
      remote.srcObject = event.streams?.[0] || new MediaStream([event.track]);
      if (event.track.kind === "video") $('[data-call-stage]').classList.add("has-remote");
      const trackKind = event.track.kind === "video" ? "video" : "audio";
      setCallPhase("MEDIA_CONNECTED", attempt);
      callTelemetryFor(attempt, `remote_track_${trackKind}`, { track_kind: trackKind }, { onceKey: `remote_track_${trackKind}` });
      playCallMedia(remote, "remote", trackKind, attempt);
    });
    listenPeer(peer, "icecandidate", async (event) => {
      if (!event.candidate || !isCurrentPeer(peer, attempt)) return;
      const candidate = candidatePayload(event.candidate);
      callTelemetryFor(attempt, "first_local_ice_candidate", {
        candidate_type: candidateType(candidate),
      }, { onceKey: "first_local_ice_candidate" });
      const payload = { source: ownerToken(), candidate };
      if (!state.activeCall) {
        state.pendingIce.push(payload);
        return;
      }
      try {
        await sendIce(payload, attempt);
      } catch (error) {
        setCallStatusForAttempt(attempt, errorMessage(error), true);
      }
    });
    listenPeer(peer, "connectionstatechange", () => {
      if (!isCurrentPeer(peer, attempt)) return;
      if (peer.connectionState === "connected") {
        setCallPhase("PEER_CONNECTED", attempt);
        callTelemetryFor(attempt, "peer_connected", { connection_state: peer.connectionState }, { onceKey: "peer_connected" });
        recordSelectedCandidatePair(peer, attempt);
        setCallStatusForAttempt(attempt, "");
      }
      if (peer.connectionState === "failed") {
        recordCallFailure(attempt, new Error("peer failed"), "PEER_FAILED");
        setCallStatusForAttempt(attempt, copy("error"), true);
        recoverIceConnection(false).catch((error) => setCallStatusForAttempt(attempt, errorMessage(error), true));
      }
    });
    listenPeer(peer, "iceconnectionstatechange", () => {
      if (!isCurrentPeer(peer, attempt)) return;
      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        setCallPhase("ICE_CONNECTED", attempt);
        callTelemetryFor(attempt, "ice_connected", { ice_connection_state: peer.iceConnectionState }, { onceKey: "ice_connected" });
        if (state.iceDisconnectedTimer) window.clearTimeout(state.iceDisconnectedTimer);
        state.iceDisconnectedTimer = null;
        setCallStatusForAttempt(attempt, "");
      } else if (peer.iceConnectionState === "failed") {
        recordCallFailure(attempt, new Error("ice failed"), "ICE_FAILED");
        recoverIceConnection(false).catch((error) => setCallStatusForAttempt(attempt, errorMessage(error), true));
      } else if (peer.iceConnectionState === "disconnected" && !state.iceDisconnectedTimer) {
        state.iceDisconnectedTimer = window.setTimeout(() => {
          state.iceDisconnectedTimer = null;
          if (peer.iceConnectionState === "disconnected") {
            recoverIceConnection(false).catch((error) => setCallStatusForAttempt(attempt, errorMessage(error), true));
          }
        }, 5000);
      }
    });
    state.peer = peer;
    state.peerGeneration += 1;
    attempt.peerGeneration = state.peerGeneration;
    state.mediaGeneration += 1;
    attempt.mediaGeneration = state.mediaGeneration;
    state.localStream = stream;
    state.remoteIce.clear();
    state.pendingRemoteIce.clear();
    setCallPhase("ICE_CONNECTING", attempt);
    const local = $('[data-local-media]');
    local.srcObject = stream;
    playCallMedia(local, "local", media === "video" ? "video" : "audio", attempt);
    setCallUi(true, media);
    scheduleIceCredentialRefresh();
    return peer;
  }

  async function sendIce(payload, attempt = state.callAttempt) {
    const peer = state.peer;
    const call = state.activeCall;
    if (!call || !isCurrentPeer(peer, attempt)) return;
    const context = captureCallContext(attempt, call.id);
    const abortEntry = registerCallAbortController(context);
    try {
      await api(
        `/api/messaging/calls/${encodeURIComponent(call.id)}/signal`,
        {
          ...jsonOptions("POST", { kind: "ice", payload }),
          signal: abortEntry.controller.signal,
        },
      );
      if (!isCurrentPeer(peer, attempt) || !isCurrentCallContext(context)) throw abortCallError();
    } finally {
      releaseCallAbortController(abortEntry);
    }
  }

  async function flushIce(attempt = state.callAttempt) {
    const pending = state.pendingIce.splice(0);
    for (const payload of pending) {
      if (!isCurrentPeer(state.peer, attempt)) return;
      await sendIce(payload, attempt);
    }
  }

  function updateCallControl(button, enabled, enabledLabel, disabledLabel) {
    const off = !enabled;
    button.classList.toggle("is-off", off);
    button.setAttribute("aria-pressed", String(off));
    const label = off ? disabledLabel : enabledLabel;
    button.title = label;
    button.setAttribute("aria-label", label);
    const labelNode = button.querySelector("small");
    if (labelNode) labelNode.textContent = label;
  }

  function setCallUi(active, media = state.activeCall?.media || state.callMedia || "audio") {
    state.callMedia = media;
    $$('[data-call-start]').forEach((button) => { button.hidden = active; });
    $('[data-call-end]').hidden = !active;
    const stage = $('[data-call-stage]');
    stage.hidden = !active;
    stage.classList.toggle("is-audio", media !== "video");
    $('[data-call-toggle-camera]').hidden = media !== "video";
    if (active) {
      const title = $('[data-thread-title]')?.textContent || copy("callActive");
      $('[data-call-stage-title]').textContent = `${copy("callActive")} · ${title}`;
      const audioTrack = state.localStream?.getAudioTracks?.()[0];
      const videoTrack = state.localStream?.getVideoTracks?.()[0];
      updateCallControl($('[data-call-toggle-mic]'), audioTrack?.enabled !== false, copy("callMute"), copy("callUnmute"));
      updateCallControl($('[data-call-toggle-camera]'), videoTrack?.enabled !== false, copy("callCameraOff"), copy("callCameraOn"));
      $('[data-local-media-wrap]').classList.toggle("is-camera-off", media !== "video" || videoTrack?.enabled === false);
    }
  }

  function toggleLocalTrack(kind) {
    const isVideo = kind === "video";
    const track = isVideo ? state.localStream?.getVideoTracks?.()[0] : state.localStream?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const button = isVideo ? $('[data-call-toggle-camera]') : $('[data-call-toggle-mic]');
    updateCallControl(
      button,
      track.enabled,
      isVideo ? copy("callCameraOff") : copy("callMute"),
      isVideo ? copy("callCameraOn") : copy("callUnmute"),
    );
    if (isVideo) $('[data-local-media-wrap]').classList.toggle("is-camera-off", !track.enabled);
  }

  function toggleCallMinimize() {
    const stage = $('[data-call-stage]');
    if (document.fullscreenElement === stage && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    stage.classList.remove("is-expanded");
    const minimized = stage.classList.toggle("is-minimized");
    $('[data-call-minimize]').setAttribute("aria-pressed", String(minimized));
  }

  async function toggleCallFullscreen() {
    const stage = $('[data-call-stage]');
    stage.classList.remove("is-minimized");
    if (document.fullscreenElement === stage) {
      await document.exitFullscreen();
      return;
    }
    if (stage.requestFullscreen) {
      try {
        await stage.requestFullscreen();
        return;
      } catch (_error) {
        // iOS Safari can reject the Fullscreen API; the CSS fallback remains available.
      }
    }
    stage.classList.toggle("is-expanded");
  }

  async function startCall(media) {
    if (!state.conversation || state.activeCall || state.peer || state.callSetupInFlight) return;
    state.callSetupInFlight = true;
    const attempt = beginCallAttempt("caller", media);
    callTelemetryFor(attempt, "call_start_click");
    setCallPhase("NEGOTIATING", attempt);
    setCallStatus(copy("loading"));
    try {
      const peer = await preparePeer(media);
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") return;
      const offer = await peer.createOffer();
      callTelemetryFor(attempt, "offer_created", {}, { onceKey: "offer_created" });
      await peer.setLocalDescription(offer);
      const payload = await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/calls`,
        jsonOptions("POST", {
          media,
          offer: { type: offer.type, sdp: offer.sdp },
        }),
      );
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") {
        if (payload.call?.id) {
          api(`/api/messaging/calls/${encodeURIComponent(payload.call.id)}/action`, jsonOptions("POST", { action: "end" })).catch(() => undefined);
        }
        return;
      }
      state.activeCall = payload.call;
      bindCallAttempt(attempt, state.activeCall);
      setCallPhase("OUTGOING_RINGING", attempt);
      callTelemetryFor(attempt, "offer_persisted", {}, { onceKey: "offer_persisted" });
      emitCallEvent("created", state.activeCall);
      state.remoteOfferSeq = 0;
      state.remoteAnswerSeq = 0;
      setCallUi(true, media);
      scheduleIceCredentialRefresh();
      await flushIce();
      setCallStatus(payload.delivery?.email_queued ? copy("callOfflineEmail") : "");
      await Promise.allSettled([loadSummary(), loadConversationMessages(true), loadCallHistory()]);
    } catch (error) {
      recordCallFailure(attempt, error, error?.name === "AbortError" ? "NETWORK_INTERRUPTED" : "SDP_OFFER_FAILED");
      closePeer(false);
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setCallStatus(denied ? copy("mediaDenied") : errorMessage(error), true);
    } finally {
      state.callSetupInFlight = false;
    }
  }

  async function applyRemoteIce(call) {
    const attempt = state.callAttempt;
    if (!state.peer || !isCurrentCallAttempt(attempt)) return;
    const queued = Array.from(state.pendingRemoteIce.values());
    state.pendingRemoteIce.clear();
    const items = queued.concat(Array.isArray(call?.ice) ? call.ice : []);
    for (const item of items) {
      if (!isCurrentPeer(state.peer, attempt)) return;
      if (!item || item.source === ownerToken() || !item.candidate) continue;
      const key = JSON.stringify(item.candidate);
      if (state.remoteIce.has(key)) continue;
      if (!state.peer.remoteDescription) {
        state.pendingRemoteIce.set(key, item);
        continue;
      }
      try {
        await state.peer.addIceCandidate(item.candidate);
        if (!isCurrentPeer(state.peer, attempt)) return;
        state.remoteIce.add(key);
        callTelemetryFor(attempt, "first_remote_ice_candidate_applied", {}, { onceKey: "first_remote_ice_candidate_applied" });
      } catch (error) {
        state.pendingRemoteIce.set(key, item);
        recordCallFailure(attempt, error, "ICE_FAILED");
      }
    }
  }

  async function answerIncomingCall() {
    const incoming = state.incomingCall;
    if (!incoming || state.peer || state.callSetupInFlight) return;
    state.callSetupInFlight = true;
    const attempt = beginCallAttempt("callee", incoming.media, incoming.id);
    callTelemetryFor(attempt, "answer_click");
    setCallPhase("ANSWERING", attempt);
    setCallStatus(copy("loading"));
    try {
      state.activeCall = incoming;
      const peer = await preparePeer(incoming.media);
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") return;
      const initialOffer = safeSessionDescription(incoming.offer, "offer");
      if (!initialOffer) throw new Error(copy("error"));
      await peer.setRemoteDescription(initialOffer);
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") return;
      setCallPhase("NEGOTIATING", attempt);
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: "remote_description_set" });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (!isCurrentCallAttempt(attempt) || attempt.lifecycle !== "active") return;
      const answerContext = captureCallContext(attempt, incoming.id);
      const answerAbort = registerCallAbortController(answerContext);
      let payload;
      try {
        payload = await api(
          `/api/messaging/calls/${encodeURIComponent(incoming.id)}/signal`,
          {
            ...jsonOptions("POST", { kind: "answer", payload: { type: answer.type, sdp: answer.sdp } }),
            signal: answerAbort.controller.signal,
          },
        );
      } finally {
        releaseCallAbortController(answerAbort);
      }
      if (!isCurrentCallContext(answerContext) || !isCurrentPeer(peer, attempt)) return;
      state.activeCall = payload.call;
      bindCallAttempt(attempt, state.activeCall);
      callTelemetryFor(attempt, "answer_persisted", {}, { onceKey: "answer_persisted" });
      emitCallEvent("updated", state.activeCall);
      state.remoteOfferSeq = Number(incoming.offer_seq) || 1;
      state.remoteAnswerSeq = Number(payload.call?.answer_seq) || state.remoteOfferSeq;
      state.incomingCall = null;
      stopRingtone();
      $('[data-incoming-call]').hidden = true;
      setCallUi(true, incoming.media);
      await flushIce();
      await applyRemoteIce(payload.call);
      setCallStatus("");
      await Promise.allSettled([loadSummary(), loadConversationMessages(true), loadCallHistory()]);
    } catch (error) {
      recordCallFailure(attempt, error, error?.name === "NotAllowedError" ? "MEDIA_PERMISSION_DENIED" : "SDP_ANSWER_FAILED");
      closePeer(false);
      state.activeCall = null;
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setCallStatus(denied ? copy("mediaDenied") : errorMessage(error), true);
    } finally {
      state.callSetupInFlight = false;
    }
  }

  async function rejectIncomingCall() {
    const rejectedCall = state.incomingCall;
    if (!rejectedCall) return;
    try {
      await api(
        `/api/messaging/calls/${encodeURIComponent(rejectedCall.id)}/action`,
        jsonOptions("POST", { action: "reject" }),
      );
      setCallStatus("");
    } catch (error) {
      setCallStatus(errorMessage(error), true);
    } finally {
      terminalCleanup(false, { reason: "reject", attempt: null, call: rejectedCall });
      Promise.all([loadSummary(), loadConversationMessages(true), loadCallHistory()]).catch(() => {});
    }
  }

  async function endCall() {
    const endingCall = state.activeCall;
    const endingAttempt = state.callAttempt;
    callTelemetryFor(endingAttempt, "hangup_click", {}, { onceKey: "hangup_click" });
    terminalCleanup(true, { reason: "hangup", attempt: endingAttempt });
    if (!endingCall?.id) {
      Promise.all([loadSummary(), loadConversationMessages(true), loadCallHistory()]).catch(() => {});
      return;
    }
    emitCallEvent("ended", endingCall);
    callTelemetryFor(endingAttempt, "server_end_started", {}, { onceKey: "server_end_started" });
    try {
      await api(
        `/api/messaging/calls/${encodeURIComponent(endingCall.id)}/action`,
        jsonOptions("POST", { action: "end" }),
      );
      if (endingAttempt) endingAttempt.lifecycle = "server_reconciled_success";
      callTelemetryFor(endingAttempt, "server_end_ack", {}, { onceKey: "server_end_ack" });
    } catch (error) {
      if (endingAttempt) endingAttempt.lifecycle = "server_reconciled_error";
      callTelemetryFor(endingAttempt, "server_end_error", {
        error_name: String(error?.name || `HTTP_${error?.status || "unknown"}`),
      }, { onceKey: "server_end_error" });
      if (isCurrentCallAttempt(endingAttempt) && !state.activeCall) {
        setCallStatus(errorMessage(error), true);
      }
    }
    Promise.all([loadSummary(), loadConversationMessages(true), loadCallHistory()]).catch(() => {});
  }

  function hardResetMediaElement(element) {
    if (!element) return;
    try { element.pause(); } catch (_error) { /* noop */ }
    ["onplay", "onpause", "onended", "onerror", "onloadedmetadata", "onsuspend", "onemptied"]
      .forEach((handler) => {
        try { element[handler] = null; } catch (_error) { /* noop */ }
      });
    try { element.currentTime = 0; } catch (_error) { /* noop */ }
    try { element.srcObject = null; } catch (_error) { /* noop */ }
    try { element.removeAttribute("src"); } catch (_error) { /* noop */ }
    try { element.load?.(); } catch (_error) { /* noop */ }
  }

  function terminalCleanup(resetStatus = true, options = {}) {
    const reason = String(options.reason || "terminal");
    const hasAttemptOverride = Object.prototype.hasOwnProperty.call(options, "attempt");
    const attempt = hasAttemptOverride ? options.attempt : state.callAttempt;
    const cleanupGeneration = state.callGeneration;
    if (attempt?.cleanupPromise) return attempt.cleanupPromise;
    if (!attempt && state.callCleanupPromise && state.callCleanupGeneration === cleanupGeneration) {
      return state.callCleanupPromise;
    }

    let resolveCleanup;
    const cleanupPromise = new Promise((resolve) => { resolveCleanup = resolve; });
    if (attempt) attempt.cleanupPromise = cleanupPromise;
    state.callCleanupPromise = cleanupPromise;
    state.callCleanupGeneration = cleanupGeneration;

    const call = options.call || state.activeCall || state.incomingCall;
    const callId = String(call?.id || attempt?.callId || "");
    rememberTerminalCallId(callId);
    const peer = state.peer;
    const localStream = state.localStream;
    const remote = $('[data-remote-media]');
    const local = $('[data-local-media]');
    const remoteStream = remote?.srcObject;
    const pending = [];
    const step = (name, fn) => {
      try {
        const result = fn();
        if (result && typeof result.then === "function") {
          pending.push(Promise.resolve(result).catch((error) => {
            callTelemetryFor(attempt, "cleanup_step_failed", {
              reason: `cleanup:${name}`,
              error_name: String(error?.name || "Error"),
            });
          }));
        }
      } catch (error) {
        callTelemetryFor(attempt, "cleanup_step_failed", {
          reason: `cleanup:${name}`,
          error_name: String(error?.name || "Error"),
        });
      }
    };

    setCallPhase("TERMINATING", attempt);
    if (attempt && attempt.lifecycle === "active") attempt.lifecycle = "terminating";
    callTelemetryFor(attempt, "local_cleanup_started", { reason }, { onceKey: "local_cleanup_started" });

    state.callGeneration += 1;
    step("abort-requests", abortCallRequests);
    step("ringtone", () => stopRingtone(callId));
    step("cross-tab-terminal", () => {
      if (window.TimeblockCallAudio?.terminal) return window.TimeblockCallAudio.terminal(callId);
      window.TimeblockCallAudio?.stopRingback?.();
      return undefined;
    });
    step("translation-speech", () => window.TimeblockLiveTranslate?.stopTts?.());
    step("call-object-urls", revokeCallObjectUrls);
    step("notification-audio-context", closeNotificationAudioContext);

    step("remote-tracks", () => remoteStream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* noop */ }
    }));
    step("local-tracks", () => localStream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* noop */ }
    }));
    step("peer-listeners", () => { clearPeerListeners(peer); });
    step("peer", () => {
      if (!peer) return;
      peer.getSenders?.().forEach((sender) => {
        try {
          const detached = sender.replaceTrack?.(null);
          if (detached?.catch) pending.push(detached.catch(() => undefined));
        } catch (_error) { /* noop */ }
      });
      try { peer.close(); } catch (_error) { /* noop */ }
    });

    step("state-reset", () => {
      state.peer = null;
      state.peerGeneration += 1;
      state.mediaGeneration += 1;
      state.localStream = null;
      state.activeCall = null;
      state.incomingCall = null;
      state.pendingIce = [];
      state.pendingRemoteIce.clear();
      state.remoteIce.clear();
      clearIceRefreshTimers();
      state.iceRecoveryInFlight = false;
      state.lastIceRecoveryAt = 0;
      state.remoteOfferSeq = 0;
      state.remoteAnswerSeq = 0;
      state.callSetupInFlight = false;
    });

    step("remote-media-reset", () => hardResetMediaElement(remote));
    step("local-media-reset", () => hardResetMediaElement(local));
    step("picture-in-picture", () => {
      if (document.pictureInPictureElement && document.exitPictureInPicture) {
        return document.exitPictureInPicture();
      }
      if (remote?.webkitPresentationMode === "picture-in-picture" && remote.webkitSetPresentationMode) {
        remote.webkitSetPresentationMode("inline");
      }
      return undefined;
    });
    step("call-ui", () => {
      const stage = $('[data-call-stage]');
      stage?.classList.remove("has-remote", "is-minimized", "is-expanded", "is-audio");
      $('[data-incoming-call]').hidden = true;
      if (document.fullscreenElement === stage && document.exitFullscreen) {
        pending.push(document.exitFullscreen().catch(() => undefined));
      }
      setCallUi(false);
    });

    setCallPhase("ENDED", attempt);
    if (resetStatus) setCallStatus("");
    if (attempt && ["active", "terminating"].includes(attempt.lifecycle)) attempt.lifecycle = "local_terminal";

    Promise.allSettled(pending).then(() => {
      callTelemetryFor(attempt, "local_cleanup_completed", { reason }, { onceKey: "local_cleanup_completed" });
      resolveCleanup(true);
    }).catch(() => resolveCleanup(true));
    return cleanupPromise;
  }

  function closePeer(resetStatus = true) {
    terminalCleanup(resetStatus, { reason: "close-peer" });
  }

  function incomingMediaLabel(media) {
    const button = $(`[data-call-start="${media === "video" ? "video" : "audio"}"]`);
    return button?.getAttribute("title") || media || "";
  }

  async function renderIncomingCall(call) {
    if (!call?.id || call.status !== "ringing") return;
    const incomingId = String(call.id);
    if (isTerminalCallId(incomingId)) return;
    const incomingGeneration = state.callGeneration;
    const isNewIncoming = state.incomingCall?.id !== call.id;
    state.incomingCall = call;
    setCallPhase("INCOMING_RINGING", state.callAttempt);
    $('[data-incoming-call]').hidden = false;
    activateMode("messages", true, false);
    activateCommunicationTab("conversations", false);
    if (isNewIncoming) {
      await refreshNetwork(true).catch(() => undefined);
      if (state.callGeneration !== incomingGeneration || String(state.incomingCall?.id || "") !== incomingId) return;
    }
    const peer = callPeer(call);
    const peerLabel = peer.display_name || peer.public_id || "Timeblock";
    $('[data-incoming-label]').textContent = `${copy("incoming")} · ${peerLabel} · ${incomingMediaLabel(call.media)}`;
    if (!state.conversation || Number(state.conversation.id) !== Number(call.conversation_id)) {
      const conversation = state.conversations.find((item) => Number(item.id) === Number(call.conversation_id));
      if (conversation) await selectConversation(conversation).catch(() => undefined);
      if (state.callGeneration !== incomingGeneration || String(state.incomingCall?.id || "") !== incomingId) return;
    }
    startRingtone(call);
    emitCallEvent("updated", call);
    if (isNewIncoming) await showIncomingCallNotification(call);
    await loadSummary().catch(() => undefined);
  }

  async function clearIncomingCall(call, reason = "remote-ended") {
    if (!call?.id || state.incomingCall?.id !== call.id) return;
    emitCallEvent("ended", call);
    terminalCleanup(false, { reason, attempt: null, call });
    if (call.status === "missed") window.TimeblockCallAudio?.playMissedChime(call.id);
    if (reason === "accepted") setCallStatus("");
  }

  async function applyCanonicalCall(call, reason = "refresh") {
    if (!call?.id) return;
    const callId = String(call.id);
    if (CALL_TERMINAL_STATUSES.has(String(call.status || ""))) {
      if (state.activeCall?.id === callId) {
        emitCallEvent("ended", call);
        terminalCleanup(false, { reason: reason === "poll" ? "remote-ended" : "realtime-ended" });
        setCallStatus("");
        await Promise.allSettled([loadSummary(), loadConversationMessages(true), loadCallHistory()]);
      } else if (state.incomingCall?.id === callId) {
        await clearIncomingCall(call);
      }
      return;
    }
    if (state.activeCall?.id === callId) {
      state.activeCall = call;
      setCallPhase(call.status === "ringing" ? "OUTGOING_RINGING" : "NEGOTIATING", state.callAttempt);
      emitCallEvent("updated", call);
      await applyCallNegotiation(call);
      const canonical = state.activeCall || call;
      await applyRemoteIce(canonical);
      setCallStatus("");
      return;
    }
    if (call.status === "ringing" && call.callee_type === state.me?.owner_type
      && String(call.callee_id) === String(state.me?.owner_id)) {
      await renderIncomingCall(call);
      return;
    }
    if (state.incomingCall?.id === callId) {
      await clearIncomingCall(call, call.status === "accepted" ? "accepted" : reason);
    }
  }

  function requestCanonicalCallRefresh(callId, reason = "realtime") {
    const id = String(callId || "");
    if (!id || isTerminalCallId(id)) return Promise.resolve();
    const context = captureCallContext(state.callAttempt, id);
    let entry = state.callRefreshes.get(id);
    if (entry && entry.context.generation !== context.generation) {
      try { entry.abortEntry?.controller?.abort?.(); } catch (_error) { /* noop */ }
      state.callRefreshes.delete(id);
      entry = null;
    }
    if (entry?.inFlight) {
      entry.pending = true;
      entry.reason = reason;
      return entry.promise;
    }
    const abortEntry = registerCallAbortController(context);
    entry = {
      inFlight: true,
      pending: false,
      reason,
      promise: null,
      context,
      abortEntry,
    };
    state.callRefreshes.set(id, entry);
    entry.promise = (async () => {
      do {
        entry.pending = false;
        const payload = await api(`/api/messaging/calls/${encodeURIComponent(id)}`, {
          signal: abortEntry.controller.signal,
        });
        if (!isCurrentCallContext(context)) return;
        await applyCanonicalCall(payload.call, entry.reason);
      } while (entry.pending && isCurrentCallContext(context));
    })().catch((error) => {
      if (error?.name === "AbortError" || !isCurrentCallContext(context)) return;
      if (state.activeCall?.id === id || state.incomingCall?.id === id) {
        recordCallFailure(state.callAttempt, error, error?.status === 409 ? "SIGNALING_STALE" : "SIGNALING_TIMEOUT");
        setCallStatus(errorMessage(error), true);
      }
    }).finally(() => {
      entry.inFlight = false;
      releaseCallAbortController(abortEntry);
      if (state.callRefreshes.get(id) === entry) state.callRefreshes.delete(id);
    });
    return entry.promise;
  }

  function handleCallStateEvent(event) {
    const detail = event.detail || {};
    const payload = detail.event || {};
    const eventId = String(payload.event_id || "");
    if (eventId) {
      if (state.callEventIds.has(eventId)) return;
      state.callEventIds.add(eventId);
      if (state.callEventIds.size > 500) state.callEventIds.delete(state.callEventIds.values().next().value);
    }
    const callId = payload.resource_id || payload.payload?.call_id || detail.callId;
    requestCanonicalCallRefresh(callId, detail.eventType || "realtime");
  }

  async function pollCalls() {
    if (CALL_V1_ASSISTANT_OWNERSHIP) return;
    if (!state.me) return;
    try {
      if (state.activeCall) {
        await requestCanonicalCallRefresh(state.activeCall.id, "poll");
        if (state.activeCall && CALL_TERMINAL_STATUSES.has(String(state.activeCall.status || ""))) {
          terminalCleanup(false, { reason: "remote-ended" });
        }
        return;
      }

      const payload = await api("/api/messaging/calls");
      emitCallList(payload.calls || []);
      const incoming = (payload.calls || []).find((call) => (
        call.status === "ringing"
        && call.callee_type === state.me.owner_type
        && String(call.callee_id) === String(state.me.owner_id)
      ));
      if (!incoming) {
        if (state.incomingCall) {
          await requestCanonicalCallRefresh(state.incomingCall.id, "poll");
        }
        stopRingtone();
        return;
      }
      await renderIncomingCall(incoming);
    } catch (error) {
      if (state.activeCall || state.incomingCall) setCallStatus(errorMessage(error), true);
    }
  }

  function initCalls() {
    if (CALL_V1_ASSISTANT_OWNERSHIP) return;
    app.addEventListener("timeblock:messaging:call-state", handleCallStateEvent);
    $$('[data-call-start]').forEach((button) => {
      button.addEventListener("click", () => startCall(button.dataset.callStart));
    });
    $('[data-call-answer]').addEventListener("click", answerIncomingCall);
    $('[data-call-reject]').addEventListener("click", rejectIncomingCall);
    $$('[data-call-end], [data-call-hangup]').forEach((button) => button.addEventListener("click", endCall));
    $('[data-call-toggle-mic]').addEventListener("click", () => toggleLocalTrack("audio"));
    $('[data-call-toggle-camera]').addEventListener("click", () => toggleLocalTrack("video"));
    $('[data-call-minimize]').addEventListener("click", toggleCallMinimize);
    $('[data-call-fullscreen]').addEventListener("click", toggleCallFullscreen);
    $('[data-call-notifications]').addEventListener("click", enableCallNotifications);
    const remote = $('[data-remote-media]');
    remote.setAttribute("aria-label", $('[data-call-start="video"]')?.getAttribute("title") || "");
    $('[data-local-media]').setAttribute("aria-label", copy("you") || "You");
    $('[data-call-canvas]').addEventListener("dblclick", toggleCallFullscreen);
    document.addEventListener("fullscreenchange", () => {
      const stage = $('[data-call-stage]');
      if (document.fullscreenElement === stage) stage.classList.remove("is-expanded", "is-minimized");
    });
  }

  function applyPreferences(preferences) {
    $$('[data-pref]').forEach((input) => {
      input.checked = Boolean(preferences && preferences[input.dataset.pref]);
    });
  }

  async function loadPreferences() {
    const feedback = $('[data-preferences-feedback]');
    try {
      const payload = await api("/api/assistant/notifications/preferences");
      applyPreferences(payload.preferences || {});
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function loadReferenceRates() {
    const container = $('[data-reference-rates]');
    if (!container || state.referenceRatesLoaded) return;
    try {
      const payload = await api("/api/assistant/notifications/exchange-rates");
      const rates = payload.rates || {};
      const fields = [
        ["TWD/VND", rates.twd_vnd_buy, rates.twd_vnd_sell],
        ["TWD/USDT", rates.twd_usdt_buy, rates.twd_usdt_sell],
      ];
      container.replaceChildren(...fields.map((item) => {
        const row = createElement("div", "assistant-rate-row");
        row.appendChild(createElement("strong", "", item[0]));
        row.appendChild(createElement("span", "", `${copy("rateBuy")}: ${item[1] || "-"}`));
        row.appendChild(createElement("span", "", `${copy("rateSell")}: ${item[2] || "-"}`));
        return row;
      }));
      const updated = createElement("small", "assistant-rate-updated", `${copy("rateUpdated")}: ${formatDate(rates.updated_at)}`);
      container.appendChild(updated);
      state.referenceRatesLoaded = true;
    } catch (error) {
      state.referenceRatesLoaded = false;
      replaceWithEmpty(container, errorMessage(error));
    }
  }

  async function savePreferences(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const values = {};
    $$('[data-pref]', form).forEach((input) => { values[input.dataset.pref] = input.checked; });
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const payload = await api(
        "/api/assistant/notifications/preferences",
        jsonOptions("PUT", values),
      );
      applyPreferences(payload.preferences || values);
      setFeedback($('[data-preferences-feedback]'), copy("preferencesSaved"), false);
    } catch (error) {
      setFeedback($('[data-preferences-feedback]'), errorMessage(error), true);
    } finally {
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }

  function conditionLabel(value) {
    const option = Array.from($('[data-alert-condition]').options).find((item) => item.value === value);
    return option?.textContent || value || "";
  }

  function selectLabel(selector, value) {
    const select = $(selector);
    const option = Array.from(select?.options || []).find((item) => item.value === value);
    return option?.textContent || value || "";
  }

  function renderInbox(items) {
    const list = $('[data-notification-inbox]');
    const messages = (Array.isArray(items) ? items : []).filter((message) => !message.conversation_id);
    if (!messages.length) {
      replaceWithEmpty(list, copy("inboxEmpty"));
      return;
    }
    const rows = messages.map((message) => {
      const unread = !message.read_at;
      const row = createElement("article", `assistant-alert-item${unread ? " is-unread" : ""}`);
      const content = createElement("div", "");
      if (message.title) content.appendChild(createElement("strong", "", message.title));
      content.appendChild(createElement("small", "", message.content || ""));
      const time = createElement("time", "", formatDate(message.created_at));
      if (message.created_at) time.dateTime = String(message.created_at);
      content.appendChild(time);
      row.appendChild(content);
      if (unread) {
        const button = createElement("button", "assistant-secondary-button", copy("markRead"));
        button.type = "button";
        button.addEventListener("click", () => markInboxMessageRead(message.id, button));
        row.appendChild(button);
      }
      return row;
    });
    list.replaceChildren(...rows);
  }

  async function loadInbox(silent = false) {
    try {
      const payload = await api("/api/internal-messages/inbox");
      renderInbox(payload.messages || []);
    } catch (error) {
      if (!silent) setFeedback($('[data-alert-feedback]'), errorMessage(error), true);
    }
  }

  async function markInboxMessageRead(id, button) {
    button.disabled = true;
    try {
      await api(`/api/internal-messages/inbox/${encodeURIComponent(id)}/read`, { method: "POST" });
      await Promise.all([loadInbox(), loadSummary()]);
      setFeedback($('[data-alert-feedback]'), "", false);
    } catch (error) {
      button.disabled = false;
      setFeedback($('[data-alert-feedback]'), errorMessage(error), true);
    }
  }

  function renderAlerts(items) {
    const list = $('[data-alert-list]');
    const alerts = Array.isArray(items) ? items : [];
    if (!alerts.length) {
      replaceWithEmpty(list, copy("alertsEmpty"));
      return;
    }
    const rows = alerts.map((alert) => {
      const row = createElement("article", "assistant-alert-item");
      const content = createElement("div", "");
      const title = [
        selectLabel('[data-alert-market]', alert.market),
        alert.symbol,
        alert.country ? selectLabel('[data-alert-country]', alert.country) : "",
      ].filter(Boolean).join(" / ");
      const threshold = alert.threshold === null || alert.threshold === undefined ? "" : ` / ${alert.threshold}`;
      content.append(
        createElement("strong", "", title || "-"),
        createElement("small", "", `${conditionLabel(alert.condition)}${threshold}`),
      );
      const remove = createElement("button", "assistant-danger-button", copy("delete"));
      remove.type = "button";
      remove.addEventListener("click", () => deleteAlert(alert.id, remove));
      row.append(content, remove);
      return row;
    });
    list.replaceChildren(...rows);
  }

  async function loadAlerts() {
    try {
      const payload = await api("/api/internal-messages/alerts");
      renderAlerts(payload.alerts || []);
    } catch (error) {
      setFeedback($('[data-alert-feedback]'), errorMessage(error), true);
    }
  }

  function alertPayload() {
    return {
      market: $('[data-alert-market]').value,
      symbol: $('[data-alert-symbol]').value.trim().toUpperCase(),
      country: $('[data-alert-country]').value,
      condition: $('[data-alert-condition]').value,
      threshold: Number($('[data-alert-threshold]').value),
    };
  }

  function updateAlertFields() {
    const equities = $('[data-alert-market]').value === "equities";
    const country = $('[data-alert-country]');
    const symbol = $('[data-alert-symbol]');
    const condition = $('[data-alert-condition]');
    const wasReadOnly = symbol.readOnly;
    country.disabled = !equities;
    if (!equities) country.value = "";
    if (equities) {
      symbol.readOnly = false;
      symbol.removeAttribute("aria-readonly");
      if (wasReadOnly && state.lastEquitySymbol) symbol.value = state.lastEquitySymbol;
      else if (wasReadOnly && symbol.value.trim().toUpperCase() === "BTC") symbol.value = "";
    } else {
      const currentSymbol = symbol.value.trim();
      if (currentSymbol && currentSymbol.toUpperCase() !== "BTC") state.lastEquitySymbol = currentSymbol;
      symbol.value = "BTC";
      symbol.readOnly = true;
      symbol.setAttribute("aria-readonly", "true");
    }
    $$('option[data-alert-scope="equities"]', condition).forEach((option) => {
      option.disabled = !equities;
    });
    if (condition.selectedOptions[0]?.disabled) condition.value = "direction_gt";
    const actionCondition = new Set(["action_buy", "action_sell"]).has(condition.value);
    $('[data-alert-threshold]').disabled = actionCondition;
  }

  async function createAlert(event) {
    event.preventDefault();
    const feedback = $('[data-alert-feedback]');
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    setFeedback(feedback, copy("loading"), false);
    try {
      await api("/api/internal-messages/alerts", jsonOptions("POST", alertPayload()));
      await loadAlerts();
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteAlert(id, button) {
    button.disabled = true;
    try {
      await api(`/api/internal-messages/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadAlerts();
      setFeedback($('[data-alert-feedback]'), "", false);
    } catch (error) {
      button.disabled = false;
      setFeedback($('[data-alert-feedback]'), errorMessage(error), true);
    }
  }

  async function evaluateAlerts() {
    const feedback = $('[data-alert-feedback]');
    const button = $('[data-alert-evaluate]');
    const values = alertPayload();
    button.disabled = true;
    setFeedback(feedback, copy("loading"), false);
    try {
      await api("/api/internal-messages/alerts/evaluate", jsonOptions("POST", {
        context_type: values.market === "equities" ? "equities" : "market",
        country: values.country || "usa",
        symbol: values.symbol,
        lang: app.dataset.locale || "vi",
      }));
      await Promise.all([loadAlerts(), loadInbox(), loadSummary()]);
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function initAlerts() {
    $('[data-preferences-form]').addEventListener("submit", savePreferences);
    $('[data-alert-form]').addEventListener("submit", createAlert);
    $('[data-alert-evaluate]').addEventListener("click", evaluateAlerts);
    $('[data-alert-market]').addEventListener("change", updateAlertFields);
    $('[data-alert-condition]').addEventListener("change", updateAlertFields);
    updateAlertFields();
  }

  function ensureAlertsInitialized() {
    if (state.alertsInitialized) return;
    initAlerts();
    state.alertsInitialized = true;
  }

  async function pollTick() {
    if (state.polling) return;
    state.polling = true;
    try {
      if (!state.me) {
        const startup = await Promise.allSettled([loadSummary(), loadMe()]);
        if (startup[1].status === "rejected" || !state.me) return;
      } else {
        await loadSummary();
      }
      if (Date.now() - state.lastHeartbeat > 25000) {
        try {
          await heartbeat();
        } catch (_error) {
          // Presence is best-effort and retried on the next visible poll.
        }
      }
      await pollCalls();
      if (document.hidden) return;
      if (state.mode === "messages") {
        const networkRefreshMs = app.dataset.messagingRealtimeActive === "true" ? 60000 : 15000;
        if (Date.now() - state.lastNetworkRefresh > networkRefreshMs) await refreshNetwork(false);
        if (state.conversation && app.dataset.messagingRealtimeActive !== "true") {
          await loadConversationMessages(true);
        }
      }
      if (state.mode === "alerts") await loadInbox(true);
    } finally {
      state.polling = false;
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(pollTick, MESSAGING_FALLBACK_POLL_INTERVAL_MS);
    pollTick();
  }

  function stopLiveResources() {
    heartbeat(false, true).catch(() => undefined);
    const call = state.activeCall || state.incomingCall;
    const action = state.activeCall ? "end" : "reject";
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
    stopRecorder(true);
    stopQrScanner();
    if (!CALL_V1_ASSISTANT_OWNERSHIP) terminalCleanup(false, { reason: "pagehide" });
    if (!CALL_V1_ASSISTANT_OWNERSHIP && call?.id && navigator.sendBeacon) {
      const payload = new Blob([JSON.stringify({ action })], { type: "application/json" });
      navigator.sendBeacon(`/api/messaging/calls/${encodeURIComponent(call.id)}/action`, payload);
    }
    state.viewportCleanup?.();
    document.body.classList.remove("is-keyboard-open");
    document.body.style.removeProperty("--assistant-visual-viewport-height");
    document.body.style.removeProperty("--assistant-visual-viewport-offset-top");
    document.body.style.removeProperty("--assistant-visual-viewport-bottom");
    document.body.style.removeProperty("--assistant-visual-viewport-page-top");
    document.body.style.removeProperty("--assistant-keyboard-height");
  }

  function initLifecycle() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        heartbeat(false, true).catch(() => undefined);
      } else {
        syncVisualViewport();
        pollTick();
      }
    });
    window.addEventListener("pagehide", stopLiveResources);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        initVisualViewport();
        startPolling();
      }
    });
  }

  function init() {
    state.polling = false;
    state.pendingCallIntent = readPendingCallIntent();
    initMessaging();
    initQrScanner();
    initRingtone();
    initCalls();
    initCommunicationTabs();
    initModes();
    initVisualViewport();
    state.ready = true;
    initLifecycle();
    startPolling();
  }

  init();
}());
