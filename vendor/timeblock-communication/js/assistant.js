(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const VALID_MODES = new Set(["ai", "messages", "translate", "alerts"]);
  const MESSAGING_FALLBACK_POLL_INTERVAL_MS = 15_000;
  const AI_HISTORY_LIMIT = 20;
  const AUDIO_MIME_TYPES = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

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
    groups: [],
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
    translationSpeech: null,
    translationAudioUrls: {},
    translationDirection: "1",
    translationInitialized: false,
    alertsInitialized: false,
    referenceRatesLoaded: false,
    callCaptionSignature: "",
    callMedia: "audio",
    callAttempt: null,
    callTelemetry: [],
    peerListeners: [],
    oneTouch: null,
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
    "connection_state",
    "ice_connection_state",
    "reason",
  ]);

  function beginCallAttempt(role, media, callId = "") {
    const attempt = {
      id: createClientMessageId(),
      role: String(role || "unknown"),
      media: String(media || "audio"),
      callId: String(callId || ""),
      startedAt: performance.now(),
      seen: new Set(),
      lifecycle: "active",
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
    if (state.oneTouch?.mode === "translate" && mode !== "translate") stopOneTouch();
    state.mode = mode;
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
    if (mode === "translate") ensureTranslationInitialized();
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
    const validTabs = new Set(["conversations", "groups", "calls", "ptt"]);
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
    if (state.ready) {
      if (tabName === "groups") loadGroups().catch((error) => setFeedback($('[data-group-feedback]'), errorMessage(error), true));
      if (tabName === "calls") loadCallHistory().catch((error) => setFeedback($('[data-call-history-feedback]'), errorMessage(error), true));
      if (tabName === "ptt") renderPttDestinations();
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
    content.appendChild(createElement("div", "assistant-message-bubble", message.content || ""));

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
    if (!element || !usage) return;
    element.textContent = copy("usage").replace("{remaining}", String(usage.remaining ?? "-"));
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

  async function toggleAudioRecording(kind, button, onComplete, sourceStream = null) {
    if (state.oneTouch) stopOneTouch();
    if (state.recorder && state.recorder.kind === kind && state.recorder.mediaRecorder.state === "recording") {
      state.recorder.mediaRecorder.stop();
      return;
    }
    if (state.recorder && state.recorder.mediaRecorder.state === "recording") {
      const previous = state.recorder;
      previous.onComplete = () => {};
      const stopped = new Promise((resolve) => {
        previous.mediaRecorder.addEventListener("stop", resolve, { once: true });
      });
      previous.mediaRecorder.stop();
      await stopped;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error(copy("mediaDenied") || copy("error"));
    }
    let stream;
    if (sourceStream?.getAudioTracks?.().length) {
      stream = new MediaStream(sourceStream.getAudioTracks().map((track) => track.clone()));
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    const mimeType = supportedAudioMimeType();
    let mediaRecorder;
    try {
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const chunks = [];
    const record = { kind, button, stream, mediaRecorder, chunks, onComplete };
    state.recorder = record;
    button.classList.add("is-recording");
    button.setAttribute("aria-pressed", "true");
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const outputType = mediaRecorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: outputType });
      stream.getTracks().forEach((track) => track.stop());
      button.classList.remove("is-recording");
      button.setAttribute("aria-pressed", "false");
      if (state.recorder === record) state.recorder = null;
      if (blob.size) record.onComplete({ blob, name: audioFilename(outputType, kind), type: outputType });
    });
    mediaRecorder.addEventListener("error", () => {
      stream.getTracks().forEach((track) => track.stop());
      button.classList.remove("is-recording");
      button.setAttribute("aria-pressed", "false");
      if (state.recorder === record) state.recorder = null;
    });
    mediaRecorder.start(500);
  }

  function stopRecorder(cancel = false) {
    if (!state.recorder) return;
    const record = state.recorder;
    if (cancel) record.onComplete = () => {};
    if (record.mediaRecorder.state === "recording") record.mediaRecorder.stop();
    else record.stream.getTracks().forEach((track) => track.stop());
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
    $('[data-ai-file]').addEventListener("change", (event) => {
      const file = event.currentTarget.files && event.currentTarget.files[0];
      state.aiAudio = null;
      setFeedback($('[data-ai-meta]'), file ? copy("imageSelected").replace("{name}", file.name) : "", false);
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
    if (conversation?.kind === "group") {
      const members = Array.isArray(conversation.member_profiles)
        ? conversation.member_profiles.filter(Boolean)
        : [];
      return {
        display_name: conversation.title || copy("group"),
        public_id: copy("groupMembersCount").replace("{count}", String(members.length || conversation.members?.length || 0)),
        kind: "group",
      };
    }
    if (conversation?.peer) return conversation.peer;
    if (!state.me || !Array.isArray(conversation?.members)) return null;
    return conversation.members.find((member) => !(
      member.owner_type === state.me.owner_type
      && String(member.owner_id) === String(state.me.owner_id)
    )) || null;
  }

  function renderConversations(items) {
    state.conversations = Array.isArray(items) ? items : [];
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
    renderPttDestinations();
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

  function renderGroupMembers() {
    const container = $('[data-group-members]');
    if (!container) return;
    const profiles = connectedProfiles();
    if (!profiles.length) {
      replaceWithEmpty(container, copy("groupConnectionsRequired"));
      return;
    }
    container.replaceChildren(...profiles.map((profile) => {
      const label = createElement("label", "assistant-group-member-option");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = profile.public_id || "";
      input.name = "group_member";
      const avatar = createElement("span", "assistant-list-avatar", initials(profile));
      const content = createElement("span", "assistant-list-copy");
      content.append(
        createElement("strong", "", profile.display_name || profile.public_id),
        createElement("small", "", profile.public_id || ""),
      );
      label.append(input, avatar, content);
      return label;
    }));
  }

  function renderGroups(items) {
    state.groups = Array.isArray(items) ? items : [];
    const list = $('[data-group-list]');
    if (!list) return;
    if (!state.groups.length) {
      replaceWithEmpty(list, copy("groupEmpty"));
      return;
    }
    list.replaceChildren(...state.groups.map((group) => {
      const row = createElement("article", "assistant-communication-row");
      const avatar = createElement("span", "assistant-list-avatar", initials({ display_name: group.title }));
      const content = createElement("span", "assistant-list-copy");
      const memberCount = Array.isArray(group.member_profiles)
        ? group.member_profiles.filter(Boolean).length
        : (group.members || []).length;
      content.append(
        createElement("strong", "", group.title || copy("group")),
        createElement("small", "", copy("groupMembersCount").replace("{count}", String(memberCount))),
      );
      const open = miniButton(copy("groupOpen"), async () => {
        activateCommunicationTab("conversations");
        await selectConversation(group);
      });
      open.className = "assistant-secondary-button assistant-communication-action";
      row.append(avatar, content, open);
      return row;
    }));
  }

  async function loadGroups() {
    const payload = await api("/api/messaging/groups");
    renderGroups(payload.groups || []);
    renderGroupMembers();
  }

  async function createGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = $('[data-group-title]').value.trim();
    const memberPublicIds = $$('[data-group-members] input[type="checkbox"]:checked')
      .map((input) => input.value)
      .filter(Boolean);
    const feedback = $('[data-group-feedback]');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setFeedback(feedback, copy("loading"), false);
    try {
      const payload = await api("/api/messaging/groups", jsonOptions("POST", {
        title,
        member_public_ids: memberPublicIds,
      }));
      form.reset();
      await Promise.all([loadGroups(), loadConversations()]);
      setFeedback(feedback, copy("groupCreated"), false);
      if (payload.group) {
        activateCommunicationTab("conversations");
        await selectConversation(payload.group);
      }
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      submit.disabled = false;
    }
  }

  function renderPttDestinations() {
    const select = $('[data-ptt-conversation]');
    if (!select) return;
    const previous = select.value;
    const options = state.conversations.map((conversation) => {
      const peer = conversationPeer(conversation) || {};
      return new Option(
        conversation.kind === "group"
          ? (conversation.title || copy("group"))
          : (peer.display_name || peer.public_id || copy("empty")),
        String(conversation.id),
      );
    });
    if (!options.length) options.push(new Option(copy("pttNoDestination"), ""));
    select.replaceChildren(...options);
    if (options.some((option) => option.value === previous)) select.value = previous;
    select.disabled = !state.conversations.length;
    const button = $('[data-ptt-record]');
    if (button) button.disabled = !state.conversations.length;
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
      renderGroupMembers();
      if (state.communicationTab === "groups") await loadGroups();
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

  async function startQrCamera(event) {
    const button = event.currentTarget;
    const feedback = $('[data-qr-feedback]');
    const video = $('[data-qr-video]');
    button.disabled = true;
    clearQrPreview();
    setFeedback(feedback, copy("loading"), false);
    try {
      if (!state.qrScanner) throw new Error("qr-unsupported");
      video.hidden = false;
      await state.qrScanner.startCamera();
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
      if (!state.qrScanner) throw new Error("qr-unsupported");
      const value = await state.qrScanner.decodeFile(file);
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
    const video = $('[data-qr-video]');
    if (typeof window.TimeblockQrScanner === "function") {
      state.qrScanner = new window.TimeblockQrScanner({
        video,
        scanIntervalMs: 320,
        onValue: resolveQrValue,
      });
    }
    $('[data-qr-scan]').addEventListener("click", openQrScanner);
    $('[data-qr-camera]').addEventListener("click", startQrCamera);
    $('[data-qr-close]').addEventListener("click", closeQrScanner);
    $('[data-qr-cancel]').addEventListener("click", closeQrScanner);
    $('[data-qr-confirm]').addEventListener("click", confirmQrProfile);
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

  async function selectConversation(conversation) {
    if (!conversation?.id) return;
    const stored = state.conversations.find((item) => Number(item.id) === Number(conversation.id));
    if (stored) stored.unread_count = 0;
    state.conversation = { ...(stored || {}), ...conversation };
    app.dataset.activeMessagingConversationId = String(state.conversation.id);
    emitMessagingEvent("conversation", { conversation: state.conversation });
    const peer = conversationPeer(state.conversation) || {};
    const isGroup = state.conversation.kind === "group";
    $('[data-thread-title]').textContent = isGroup
      ? (state.conversation.title || copy("group"))
      : (peer.display_name || peer.public_id || copy("empty"));
    $('[data-thread-subtitle]').textContent = isGroup
      ? copy("groupMembersCount").replace(
        "{count}",
        String(state.conversation.member_profiles?.filter(Boolean).length || state.conversation.members?.length || 0),
      )
      : (peer.public_id || "");
    $('[data-message-form]').hidden = false;
    $('[data-call-actions]').hidden = isGroup;
    $('[data-messaging-layout]').classList.add("has-thread");
    state.messageSignature = "";
    state.threadMessages = [];
    state.messagePage = null;
    await loadConversationMessages(false);
    renderConversations(state.conversations);
  }

  async function sendConversationMessage(event) {
    event.preventDefault();
    if (!state.conversation) return;
    const input = $('[data-message-input]');
    const imageInput = $('[data-message-file]');
    const content = input.value.trim();
    const image = imageInput.files && imageInput.files[0];
    if (!content && !image) return;
    const replyToMessageId = app.dataset.messagingReplyToMessageId || "";
    const requestSignature = [
      state.conversation.id,
      content,
      replyToMessageId,
      image?.name || "",
      image?.size || 0,
      image?.lastModified || 0,
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
      if (image) {
        const data = new FormData();
        data.append("content", content);
        data.append("image", image, image.name);
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

  async function sendPttRecording(audio) {
    const conversationId = $('[data-ptt-conversation]').value;
    const sourceLanguage = $('[data-ptt-language]').value;
    const feedback = $('[data-ptt-feedback]');
    const button = $('[data-ptt-record]');
    const label = $('[data-ptt-record-label]');
    if (!conversationId) {
      setFeedback(feedback, copy("pttNoDestination"), true);
      return;
    }
    button.disabled = true;
    label.textContent = copy("translationProcessing");
    setFeedback(feedback, copy("translationProcessing"), false);
    try {
      const data = new FormData();
      data.append("source_language", sourceLanguage);
      data.append("lang", app.dataset.locale || "vi");
      data.append("file", audio.blob, audio.name);
      const transcription = await api("/translator/api/transcribe", { method: "POST", body: data });
      const content = String(transcription.transcript || "").trim();
      if (!content) throw new Error(copy("error"));
      await api(
        `/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`,
        jsonOptions("POST", {
          content,
          kind: "ptt",
          source_language: sourceLanguage,
        }),
      );
      await loadConversations();
      if (state.conversation && Number(state.conversation.id) === Number(conversationId)) {
        await loadConversationMessages(false, true);
      }
      setFeedback(feedback, copy("pttSent"), false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      button.disabled = false;
      label.textContent = copy("pttHold");
    }
  }

  async function togglePttRecording() {
    const button = $('[data-ptt-record]');
    const label = $('[data-ptt-record-label]');
    const feedback = $('[data-ptt-feedback]');
    if (!button || button.disabled) return;
    try {
      const stopping = state.recorder
        && state.recorder.kind === "network-ptt"
        && state.recorder.mediaRecorder.state === "recording";
      label.textContent = stopping ? copy("translationProcessing") : copy("translationListening");
      setFeedback(feedback, stopping ? copy("translationProcessing") : copy("translationListening"), false);
      await toggleAudioRecording("network-ptt", button, sendPttRecording);
    } catch (error) {
      label.textContent = copy("pttHold");
      setFeedback(feedback, errorMessage(error), true);
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
      $('[data-messaging-layout]').classList.remove("has-thread");
    });
    app.addEventListener("timeblock:messaging:filter", (event) => {
      loadConversations(event.detail || {}).catch((error) => {
        setFeedback($('[data-network-feedback]'), errorMessage(error), true);
      });
    });
    app.addEventListener("timeblock:messaging:load-older", () => {
      loadOlderConversationMessages().catch((error) => setCallStatus(errorMessage(error), true));
    });
    app.addEventListener("timeblock:messaging:refresh", (event) => {
      const scope = event.detail?.scope || "all";
      const tasks = [];
      if (scope !== "thread") tasks.push(loadConversations());
      if (scope !== "conversations" && state.conversation) tasks.push(loadConversationMessages(true, true));
      if (!tasks.length) return;
      Promise.all(tasks).catch((error) => setCallStatus(errorMessage(error), true));
    });
    $('[data-group-form]')?.addEventListener("submit", createGroup);
    $('[data-group-refresh]')?.addEventListener("click", () => {
      loadGroups().catch((error) => setFeedback($('[data-group-feedback]'), errorMessage(error), true));
    });
    $('[data-call-history-refresh]')?.addEventListener("click", () => {
      loadCallHistory().catch((error) => setFeedback($('[data-call-history-feedback]'), errorMessage(error), true));
    });
    $('[data-ptt-record]')?.addEventListener("click", togglePttRecording);
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
    if (state.audioContext) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    state.audioContext.resume?.().catch(() => undefined);
  }

  function scrollContextForInput(input) {
    if (input?.matches("[data-message-input]")) {
      return { key: "messages", container: $('[data-thread-messages]') };
    }
    if (input?.matches("[data-ai-input]")) {
      return { key: "ai", container: $('[data-ai-messages]') };
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
    document.body.style.setProperty("--assistant-keyboard-height", `${keyboardOpen ? keyboardHeight : 0}px`);
    document.body.classList.toggle("is-keyboard-open", keyboardOpen);

    if (keyboardOpen && activeContext && state.scrollPins[activeContext.key]) {
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

  async function iceServers(forceRefresh = false) {
    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && state.iceServers.length && (!state.iceRefreshAt || state.iceRefreshAt > now)) {
      return state.iceServers;
    }
    const payload = await api("/api/messaging/ice-servers");
    state.iceServers = Array.isArray(payload.ice_servers) ? payload.ice_servers : [];
    state.iceExpiresAt = Number(payload.expires_at) || 0;
    const refreshInSeconds = Number(payload.refresh_in_seconds) || 0;
    state.iceRefreshAt = refreshInSeconds > 0
      ? now + refreshInSeconds
      : Number(payload.refresh_after) || (
        state.iceExpiresAt ? Math.max(now + 30, state.iceExpiresAt - 60) : 0
      );
    return state.iceServers;
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
    if (!state.peer) return;
    const servers = await iceServers(forceRefresh);
    const configuration = state.peer.getConfiguration();
    state.peer.setConfiguration({ ...configuration, iceServers: servers });
    scheduleIceCredentialRefresh();
  }

  async function publishIceRestart() {
    if (
      !state.peer
      || !state.activeCall
      || state.activeCall.status !== "accepted"
      || !callOwnedByCurrentPrincipal()
      || state.peer.signalingState !== "stable"
    ) return;
    if (typeof state.peer.restartIce === "function") state.peer.restartIce();
    const offer = await state.peer.createOffer({ iceRestart: true });
    await state.peer.setLocalDescription(offer);
    const response = await api(
      `/api/messaging/calls/${encodeURIComponent(state.activeCall.id)}/signal`,
      jsonOptions("POST", {
        kind: "offer",
        payload: { type: offer.type, sdp: offer.sdp },
      }),
    );
    state.activeCall = response.call;
  }

  async function recoverIceConnection(proactive = false) {
    if (!state.peer || !state.activeCall || state.iceRecoveryInFlight) return;
    const now = Date.now();
    if (!proactive && now - state.lastIceRecoveryAt < 30000) return;
    state.iceRecoveryInFlight = true;
    state.lastIceRecoveryAt = now;
    try {
      await refreshPeerIceConfiguration(true);
      if (callOwnedByCurrentPrincipal()) await publishIceRestart();
    } finally {
      state.iceRecoveryInFlight = false;
    }
  }

  function safeSessionDescription(value, expectedType) {
    if (!value || value.type !== expectedType || !value.sdp) return null;
    return { type: expectedType, sdp: value.sdp };
  }

  async function applyCallNegotiation(call) {
    const attempt = state.callAttempt;
    if (!state.peer) return;
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
      await state.peer.setRemoteDescription(remoteOffer);
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: `remote_description_set_offer_${offerSeq}` });
      const answer = await state.peer.createAnswer();
      await state.peer.setLocalDescription(answer);
      state.remoteOfferSeq = offerSeq;
      const response = await api(
        `/api/messaging/calls/${encodeURIComponent(call.id)}/signal`,
        jsonOptions("POST", {
          kind: "answer",
          payload: { type: answer.type, sdp: answer.sdp },
        }),
      );
      state.activeCall = response.call;
      state.remoteAnswerSeq = Number(response.call?.answer_seq) || offerSeq;
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
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: `remote_description_set_answer_${answerSeq}` });
      state.remoteAnswerSeq = answerSeq;
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
    callTelemetryFor(attempt, "gum_ready", {}, { onceKey: "gum_ready" });
    let peer;
    try {
      peer = new RTCPeerConnection({ iceServers: await iceServers() });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    listenPeer(peer, "track", (event) => {
      const remote = $('[data-remote-media]');
      remote.srcObject = event.streams?.[0] || new MediaStream([event.track]);
      if (event.track.kind === "video") $('[data-call-stage]').classList.add("has-remote");
      const trackKind = event.track.kind === "video" ? "video" : "audio";
      callTelemetryFor(attempt, `remote_track_${trackKind}`, { track_kind: trackKind }, { onceKey: `remote_track_${trackKind}` });
      playCallMedia(remote, "remote", trackKind, attempt);
    });
    listenPeer(peer, "icecandidate", async (event) => {
      if (!event.candidate) return;
      callTelemetryFor(attempt, "first_local_ice_candidate", {}, { onceKey: "first_local_ice_candidate" });
      const payload = { source: ownerToken(), candidate: candidatePayload(event.candidate) };
      if (!state.activeCall) {
        state.pendingIce.push(payload);
        return;
      }
      try {
        await sendIce(payload);
      } catch (error) {
        setCallStatusForAttempt(attempt, errorMessage(error), true);
      }
    });
    listenPeer(peer, "connectionstatechange", () => {
      if (peer.connectionState === "connected") {
        callTelemetryFor(attempt, "peer_connected", { connection_state: peer.connectionState }, { onceKey: "peer_connected" });
        setCallStatusForAttempt(attempt, "");
      }
      if (peer.connectionState === "failed") {
        setCallStatusForAttempt(attempt, copy("error"), true);
        recoverIceConnection(false).catch((error) => setCallStatusForAttempt(attempt, errorMessage(error), true));
      }
    });
    listenPeer(peer, "iceconnectionstatechange", () => {
      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        callTelemetryFor(attempt, "ice_connected", { ice_connection_state: peer.iceConnectionState }, { onceKey: "ice_connected" });
        if (state.iceDisconnectedTimer) window.clearTimeout(state.iceDisconnectedTimer);
        state.iceDisconnectedTimer = null;
        setCallStatusForAttempt(attempt, "");
      } else if (peer.iceConnectionState === "failed") {
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
    state.localStream = stream;
    state.remoteIce.clear();
    const local = $('[data-local-media]');
    local.srcObject = stream;
    playCallMedia(local, "local", media === "video" ? "video" : "audio", attempt);
    setCallUi(true, media);
    scheduleIceCredentialRefresh();
    return peer;
  }

  async function sendIce(payload) {
    if (!state.activeCall) return;
    await api(`/api/messaging/calls/${encodeURIComponent(state.activeCall.id)}/signal`, jsonOptions("POST", {
      kind: "ice",
      payload,
    }));
  }

  async function flushIce() {
    const pending = state.pendingIce.splice(0);
    for (const payload of pending) await sendIce(payload);
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
    $('[data-call-interpreter-toggle]').hidden = media !== "video";
    if (!active) {
      $('[data-call-interpreter-panel]').hidden = true;
      $('[data-call-interpreter-toggle]').setAttribute("aria-pressed", "false");
      $('[data-call-caption]').hidden = true;
    }
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
    if (!state.conversation || state.activeCall) return;
    const attempt = beginCallAttempt("caller", media);
    callTelemetryFor(attempt, "call_start_click");
    setCallStatus(copy("loading"));
    try {
      const peer = await preparePeer(media);
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
      state.activeCall = payload.call;
      bindCallAttempt(attempt, state.activeCall);
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
      closePeer(false);
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setCallStatus(denied ? copy("mediaDenied") : errorMessage(error), true);
    }
  }

  async function applyRemoteIce(call) {
    const attempt = state.callAttempt;
    if (!state.peer || !state.peer.remoteDescription) return;
    const items = Array.isArray(call?.ice) ? call.ice : [];
    for (const item of items) {
      if (!item || item.source === ownerToken() || !item.candidate) continue;
      const key = JSON.stringify(item.candidate);
      if (state.remoteIce.has(key)) continue;
      try {
        await state.peer.addIceCandidate(item.candidate);
        state.remoteIce.add(key);
        callTelemetryFor(attempt, "first_remote_ice_candidate_applied", {}, { onceKey: "first_remote_ice_candidate_applied" });
      } catch (_error) {
        // A candidate can arrive before the remote description; the next poll retries it.
      }
    }
  }

  async function answerIncomingCall() {
    const incoming = state.incomingCall;
    if (!incoming || state.peer) return;
    const attempt = beginCallAttempt("callee", incoming.media, incoming.id);
    callTelemetryFor(attempt, "answer_click");
    setCallStatus(copy("loading"));
    try {
      state.activeCall = incoming;
      const peer = await preparePeer(incoming.media);
      const initialOffer = safeSessionDescription(incoming.offer, "offer");
      if (!initialOffer) throw new Error(copy("error"));
      await peer.setRemoteDescription(initialOffer);
      callTelemetryFor(attempt, "remote_description_set", {}, { onceKey: "remote_description_set" });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const payload = await api(
        `/api/messaging/calls/${encodeURIComponent(incoming.id)}/signal`,
        jsonOptions("POST", { kind: "answer", payload: { type: answer.type, sdp: answer.sdp } }),
      );
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
      closePeer(false);
      state.activeCall = null;
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setCallStatus(denied ? copy("mediaDenied") : errorMessage(error), true);
    }
  }

  async function rejectIncomingCall() {
    if (!state.incomingCall) return;
    try {
      await api(
        `/api/messaging/calls/${encodeURIComponent(state.incomingCall.id)}/action`,
        jsonOptions("POST", { action: "reject" }),
      );
      setCallStatus("");
    } catch (error) {
      setCallStatus(errorMessage(error), true);
    } finally {
      state.incomingCall = null;
      stopRingtone();
      $('[data-incoming-call]').hidden = true;
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

  function terminalCleanup(resetStatus = true, options = {}) {
    const reason = String(options.reason || "terminal");
    const attempt = options.attempt || state.callAttempt;
    callTelemetryFor(attempt, "local_cleanup_started", { reason }, { onceKey: "local_cleanup_started" });
    if (state.oneTouch?.mode === "call") stopOneTouch();
    if (state.recorder?.kind === "call-translation") stopRecorder(true);
    stopRingtone();
    window.TimeblockCallAudio?.stopRingback?.();
    stopTranslationSpeech();

    const peer = state.peer;
    const localStream = state.localStream;
    const remote = $('[data-remote-media]');
    const local = $('[data-local-media]');
    const remoteStream = remote?.srcObject;

    remoteStream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* noop */ }
    });
    localStream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* noop */ }
    });
    clearPeerListeners(peer);
    if (peer) {
      try {
        peer.getSenders?.().forEach((sender) => {
          try {
            const detached = sender.replaceTrack?.(null);
            detached?.catch?.(() => undefined);
          } catch (_error) { /* noop */ }
        });
      } catch (_error) { /* noop */ }
      try { peer.close(); } catch (_error) { /* noop */ }
    }

    state.peer = null;
    state.localStream = null;
    state.activeCall = null;
    state.pendingIce = [];
    state.remoteIce.clear();
    clearIceRefreshTimers();
    state.iceRecoveryInFlight = false;
    state.lastIceRecoveryAt = 0;
    state.remoteOfferSeq = 0;
    state.remoteAnswerSeq = 0;

    if (remote) {
      try { remote.pause(); } catch (_error) { /* noop */ }
      remote.srcObject = null;
    }
    if (local) {
      try { local.pause(); } catch (_error) { /* noop */ }
      local.srcObject = null;
    }
    const stage = $('[data-call-stage]');
    stage?.classList.remove("has-remote", "is-minimized", "is-expanded", "is-audio");
    $('[data-call-interpreter-panel]').hidden = true;
    $('[data-call-caption]').hidden = true;
    state.callCaptionSignature = "";
    if (document.fullscreenElement === stage && document.exitFullscreen) {
      document.exitFullscreen().catch(() => undefined);
    }
    setCallUi(false);
    if (resetStatus) setCallStatus("");
    if (attempt && attempt.lifecycle === "active") attempt.lifecycle = "local_terminal";
    callTelemetryFor(attempt, "local_cleanup_completed", { reason }, { onceKey: "local_cleanup_completed" });
  }

  function closePeer(resetStatus = true) {
    terminalCleanup(resetStatus, { reason: "close-peer" });
  }

  function incomingMediaLabel(media) {
    const button = $(`[data-call-start="${media === "video" ? "video" : "audio"}"]`);
    return button?.getAttribute("title") || media || "";
  }

  function toggleCallInterpreter(forceOpen) {
    const panel = $('[data-call-interpreter-panel]');
    const button = $('[data-call-interpreter-toggle]');
    const open = forceOpen === undefined ? panel.hidden : Boolean(forceOpen);
    panel.hidden = !open;
    button.setAttribute("aria-pressed", String(open));
    button.classList.toggle("is-active", open);
    setCallStatus(open ? copy("callInterpreterOn") : "");
  }

  function renderCallCaption(caption) {
    const container = $('[data-call-caption]');
    const sourceText = String(caption?.source_text || "").trim();
    const translation = String(caption?.translation || "").trim();
    if (!sourceText || !translation) {
      container.hidden = true;
      return;
    }
    $('[data-call-caption-source]').textContent = sourceText;
    $('[data-call-caption-translation]').textContent = translation;
    container.hidden = false;
  }

  async function sendCallCaption(payload) {
    if (!state.activeCall) return;
    const response = await api(
      `/api/messaging/calls/${encodeURIComponent(state.activeCall.id)}/signal`,
      jsonOptions("POST", { kind: "caption", payload }),
    );
    state.activeCall = response.call;
  }

  async function applyCallCaption(call) {
    const caption = call?.caption || {};
    const signature = `${call?.caption_seq || 0}:${caption.created_at || ""}:${caption.source || ""}`;
    if (!caption.translation || signature === state.callCaptionSignature) return;
    state.callCaptionSignature = signature;
    renderCallCaption(caption);
    if (caption.source && caption.source !== ownerToken() && $('[data-call-translate-auto-speak]').checked) {
      try {
        await playTranslatedSpeech(caption.translation, caption.target_language, "call");
      } catch (error) {
        setFeedback($('[data-call-translate-feedback]'), errorMessage(error), true);
      }
    }
  }

  async function translateCallAudio(audio) {
    const button = $('[data-call-translate-record]');
    const feedback = $('[data-call-translate-feedback]');
    button.disabled = true;
    setFeedback(feedback, copy("translationProcessing"), false);
    try {
      const payload = await translateConversationSegment(audio, "call");
      const caption = {
        source: ownerToken(),
        source_language: payload.source_language,
        target_language: payload.target_language,
        source_text: payload.transcript,
        translation: payload.translation,
      };
      renderCallCaption(caption);
      await sendCallCaption(caption);
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      button.disabled = false;
      $('[data-call-translate-record-label]').textContent = copy("translationHoldToTalk") || copy("translationSpeak");
    }
  }

  async function toggleCallInterpreterRecording() {
    const button = $('[data-call-translate-record]');
    const label = $('[data-call-translate-record-label]');
    const feedback = $('[data-call-translate-feedback]');
    if (!$('[data-call-translate-consent]').checked) {
      setFeedback(feedback, copy("translationConsentRequired"), true);
      return;
    }
    try {
      const stopping = state.recorder
        && state.recorder.kind === "call-translation"
        && state.recorder.mediaRecorder.state === "recording";
      label.textContent = stopping ? copy("translationProcessing") : copy("translationListening");
      await toggleAudioRecording("call-translation", button, translateCallAudio, state.localStream);
    } catch (error) {
      label.textContent = copy("translationHoldToTalk") || copy("translationSpeak");
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function pollCalls() {
    if (!state.me) return;
    try {
      if (state.activeCall) {
        const payload = await api(`/api/messaging/calls/${encodeURIComponent(state.activeCall.id)}`);
        const call = payload.call || {};
        if (new Set(["ended", "rejected", "missed"]).has(call.status)) {
          emitCallEvent("ended", call);
          terminalCleanup(false, { reason: "remote-ended" });
          setCallStatus("");
          await Promise.allSettled([loadSummary(), loadConversationMessages(true), loadCallHistory()]);
          return;
        }
        state.activeCall = call;
        emitCallEvent("updated", call);
        await applyCallNegotiation(call);
        await applyRemoteIce(call);
        await applyCallCaption(call);
        setCallStatus("");
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
          const previousIncoming = state.incomingCall;
          state.incomingCall = null;
          $('[data-incoming-call]').hidden = true;
          api(`/api/messaging/calls/${encodeURIComponent(previousIncoming.id)}`)
            .then((result) => {
              if (result.call?.status === "missed") window.TimeblockCallAudio?.playMissedChime(previousIncoming.id);
            })
            .catch(() => undefined);
        }
        stopRingtone();
        return;
      }
      const isNewIncoming = state.incomingCall?.id !== incoming.id;
      state.incomingCall = incoming;
      $('[data-incoming-call]').hidden = false;
      activateMode("messages", true, false);
      activateCommunicationTab("conversations", false);
      await refreshNetwork(true);
      const peer = callPeer(incoming);
      const peerLabel = peer.display_name || peer.public_id || "Timeblock";
      $('[data-incoming-label]').textContent = `${copy("incoming")} · ${peerLabel} · ${incomingMediaLabel(incoming.media)}`;
      if (!state.conversation || Number(state.conversation.id) !== Number(incoming.conversation_id)) {
        const conversation = state.conversations.find((item) => Number(item.id) === Number(incoming.conversation_id));
        if (conversation) await selectConversation(conversation);
      }
      startRingtone(incoming);
      emitCallEvent("updated", incoming);
      if (isNewIncoming) await showIncomingCallNotification(incoming);
      await loadSummary();
    } catch (error) {
      if (state.activeCall || state.incomingCall) setCallStatus(errorMessage(error), true);
    }
  }

  function initCalls() {
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
    $('[data-call-interpreter-toggle]').addEventListener("click", () => toggleCallInterpreter());
    $('[data-call-interpreter-close]').addEventListener("click", () => toggleCallInterpreter(false));
    $('[data-call-translate-record]').addEventListener("click", toggleCallInterpreterRecording);
    $('[data-call-one-touch-toggle]').addEventListener("click", () => toggleOneTouch("call"));
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

  function directionNode(direction, type) {
    return $(`[data-interpreter-${type}="${direction}"]`);
  }

  function conversationDirectionNode(mode, direction, type) {
    if (mode === "call") return $(`[data-call-interpreter-${type}="${direction}"]`);
    return directionNode(direction, type);
  }

  function conversationAudioFormData(audio, mode) {
    const data = new FormData();
    ["1", "2"].forEach((direction) => {
      data.append(
        `source_language_${direction}`,
        conversationDirectionNode(mode, direction, "source").value,
      );
      data.append(
        `target_language_${direction}`,
        conversationDirectionNode(mode, direction, "target").value,
      );
    });
    data.append("lang", app.dataset.locale || "vi");
    data.append("file", audio.blob, audio.name);
    return data;
  }

  async function translateConversationSegment(audio, mode) {
    return api("/translator/api/conversation-audio", {
      method: "POST",
      body: conversationAudioFormData(audio, mode),
    });
  }

  function setOneTouchUi(mode, statusKey, active) {
    const callMode = mode === "call";
    const button = $(callMode ? '[data-call-one-touch-toggle]' : '[data-one-touch-toggle]');
    const label = $(callMode ? '[data-call-one-touch-label]' : '[data-one-touch-label]');
    const status = $(callMode ? '[data-call-one-touch-status]' : '[data-one-touch-status]');
    if (!button || !label || !status) return;
    const running = active === undefined ? state.oneTouch?.mode === mode : Boolean(active);
    button.classList.toggle("is-recording", running);
    button.setAttribute("aria-pressed", String(running));
    label.textContent = running ? copy("oneTouchStop") : copy("oneTouchStart");
    status.textContent = copy(statusKey || (running ? "oneTouchListening" : "oneTouchStopped"));
    status.classList.toggle("is-live", running && statusKey === "oneTouchListening");
  }

  function stopOneTouch() {
    const controller = state.oneTouch;
    if (!controller) return;
    controller.stopped = true;
    if (controller.animationFrame) cancelAnimationFrame(controller.animationFrame);
    if (controller.recorder?.state === "recording") controller.recorder.stop();
    controller.stream?.getTracks?.().forEach((track) => track.stop());
    controller.audioContext?.close?.().catch(() => {});
    state.oneTouch = null;
    setOneTouchUi(controller.mode, "oneTouchStopped", false);
  }

  async function processOneTouchSegment(controller, audio) {
    if (controller.stopped || !audio.blob.size) return;
    controller.processing = true;
    setOneTouchUi(controller.mode, "oneTouchProcessing", true);
    const feedback = controller.mode === "call"
      ? $('[data-call-translate-feedback]')
      : $('[data-translate-feedback]');
    try {
      const payload = await translateConversationSegment(audio, controller.mode);
      if (controller.stopped) return;
      const direction = String(payload.direction || "1");
      if (controller.mode === "call") {
        const caption = {
          source: ownerToken(),
          source_language: payload.source_language,
          target_language: payload.target_language,
          source_text: payload.transcript,
          translation: payload.translation,
        };
        renderCallCaption(caption);
        await sendCallCaption(caption);
      } else {
        setTranslationResult(payload, direction);
        if ($(`[data-interpreter-auto-speak="${direction}"]`)?.checked) {
          setOneTouchUi(controller.mode, "oneTouchSpeaking", true);
          await playTranslatedSpeech(payload.translation, payload.target_language, direction);
        }
      }
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      controller.processing = false;
      controller.voiceStartedAt = 0;
      controller.lastVoiceAt = 0;
      if (!controller.stopped && state.oneTouch === controller) setOneTouchUi(controller.mode, "oneTouchListening", true);
    }
  }

  function startOneTouchSegment(controller) {
    if (controller.stopped || controller.processing || controller.recorder) return;
    const mimeType = supportedAudioMimeType();
    const recorder = mimeType
      ? new MediaRecorder(controller.stream, { mimeType })
      : new MediaRecorder(controller.stream);
    const chunks = [];
    controller.recorder = recorder;
    controller.voiceStartedAt = performance.now();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const outputType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: outputType });
      if (controller.recorder === recorder) controller.recorder = null;
      if (!controller.stopped && blob.size) {
        processOneTouchSegment(controller, {
          blob,
          name: audioFilename(outputType, `${controller.mode}-one-touch`),
          type: outputType,
        });
      }
    });
    recorder.addEventListener("error", () => {
      if (controller.recorder === recorder) controller.recorder = null;
    });
    recorder.start(250);
  }

  function analyseOneTouch(controller) {
    if (controller.stopped || state.oneTouch !== controller) return;
    if (!controller.processing) {
      controller.analyser.getByteTimeDomainData(controller.samples);
      let energy = 0;
      for (let index = 0; index < controller.samples.length; index += 1) {
        const sample = (controller.samples[index] - 128) / 128;
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / controller.samples.length);
      const now = performance.now();
      if (rms >= controller.threshold) {
        if (!controller.recorder) startOneTouchSegment(controller);
        controller.lastVoiceAt = now;
      }
      const recording = controller.recorder?.state === "recording";
      const segmentLength = now - controller.voiceStartedAt;
      const silenceLength = now - controller.lastVoiceAt;
      if (recording && segmentLength > 500 && (silenceLength > 900 || segmentLength > 12000)) {
        controller.recorder.stop();
      }
    }
    controller.animationFrame = requestAnimationFrame(() => analyseOneTouch(controller));
  }

  async function startOneTouch(mode) {
    if (state.oneTouch) stopOneTouch();
    stopRecorder(true);
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(copy("mediaDenied") || copy("error"));
    }
    if (mode === "call" && !state.localStream?.getAudioTracks?.().length) {
      throw new Error(copy("mediaDenied") || copy("error"));
    }
    const stream = mode === "call"
      ? new MediaStream(state.localStream.getAudioTracks().map((track) => track.clone()))
      : await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(copy("mediaDenied") || copy("error"));
    }
    const audioContext = new AudioContext();
    await audioContext.resume();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const controller = {
      mode,
      stream,
      audioContext,
      analyser,
      samples: new Uint8Array(analyser.fftSize),
      threshold: 0.028,
      lastVoiceAt: 0,
      voiceStartedAt: 0,
      recorder: null,
      processing: false,
      stopped: false,
      animationFrame: 0,
    };
    state.oneTouch = controller;
    setOneTouchUi(mode, "oneTouchListening", true);
    analyseOneTouch(controller);
  }

  async function toggleOneTouch(mode) {
    const consent = mode === "call" ? $('[data-call-translate-consent]') : $('[data-translate-consent]');
    const feedback = mode === "call" ? $('[data-call-translate-feedback]') : $('[data-translate-feedback]');
    if (state.oneTouch?.mode === mode) {
      stopOneTouch();
      return;
    }
    if (!consent?.checked) {
      setFeedback(feedback, copy("translationConsentRequired"), true);
      consent?.focus();
      return;
    }
    try {
      await startOneTouch(mode);
      setFeedback(feedback, "", false);
      await loadAudioOutputs();
    } catch (error) {
      stopOneTouch();
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  function appendInterpreterTurn(payload, direction) {
    const transcriptText = String(payload?.transcript || payload?.sourceText || "").trim();
    const translation = String(payload?.translation || "").trim();
    if (!translation) return;
    const timeline = $('[data-translate-timeline]');
    $('[data-translate-timeline-empty]')?.remove();
    const item = createElement("article", "assistant-interpreter-turn");
    const heading = createElement("div", "assistant-interpreter-turn-heading");
    heading.append(
      createElement("strong", "", directionNode(direction, "source")?.selectedOptions?.[0]?.textContent || ""),
      createElement("time", "", new Intl.DateTimeFormat(app.dataset.locale || undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date())),
    );
    const source = createElement("p", "assistant-interpreter-source", transcriptText);
    const translated = createElement("p", "assistant-interpreter-translated", translation);
    const replay = createElement("button", "assistant-secondary-button", copy("translationSpeak"));
    replay.type = "button";
    replay.addEventListener("click", () => playTranslatedSpeech(
      translation,
      directionNode(direction, "target")?.value || "vi",
      direction,
    ));
    item.append(heading);
    if (transcriptText) item.append(source);
    item.append(translated, replay);
    timeline.prepend(item);
  }

  function setTranslationResult(payload, direction = "1", appendTurn = true) {
    stopTranslationSpeech();
    state.translationDirection = String(direction);
    const translation = String(payload?.translation || "").trim();
    const output = $('[data-translate-output]');
    output.textContent = translation || copy("translationEmpty");
    output.dataset.translation = translation;
    output.dataset.targetLanguage = directionNode(direction, "target")?.value || "vi";
    $('[data-translate-speak]').disabled = !translation;
    const transcript = $('[data-translate-transcript]');
    const transcriptText = String(payload?.transcript || payload?.sourceText || "").trim();
    transcript.hidden = !transcriptText;
    const value = transcript.querySelector("span");
    if (value) value.textContent = transcriptText;
    if (appendTurn) appendInterpreterTurn(payload, String(direction));
  }

  function translationVoiceLocale(language) {
    return {
      vi: "vi-VN",
      en: "en-US",
      "zh-TW": "zh-TW",
      ja: "ja-JP",
      ko: "ko-KR",
      th: "th-TH",
      id: "id-ID",
    }[language] || language || app.dataset.locale || "vi-VN";
  }

  function setTranslationSpeechUi(speaking) {
    const button = $('[data-translate-speak]');
    button.classList.toggle("is-speaking", speaking);
    button.setAttribute("aria-pressed", String(speaking));
    const label = speaking ? copy("translationStopSpeech") : copy("translationSpeak");
    button.title = label;
    button.setAttribute("aria-label", label);
    $('[data-translate-speak-label]').textContent = label;
  }

  function stopTranslationSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $$('[data-translation-audio]').forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    state.translationSpeech = null;
    setTranslationSpeechUi(false);
  }

  function browserSpeechFallback(text, language, feedback) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      throw new Error(copy("translationSpeechUnavailable"));
    }
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = translationVoiceLocale(language);
      utterance.rate = 0.96;
      utterance.onstart = () => setTranslationSpeechUi(true);
      utterance.onend = () => {
        if (state.translationSpeech === utterance) state.translationSpeech = null;
        setTranslationSpeechUi(false);
        resolve();
      };
      utterance.onerror = (event) => {
        if (state.translationSpeech === utterance) state.translationSpeech = null;
        setTranslationSpeechUi(false);
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setFeedback(feedback, copy("translationSpeechUnavailable"), true);
          reject(new Error(copy("translationSpeechUnavailable")));
          return;
        }
        resolve();
      };
      state.translationSpeech = utterance;
      if (feedback) setFeedback(feedback, copy("translationOutputSystem"), false);
      window.speechSynthesis.speak(utterance);
    });
  }

  function outputStorageKey(channel) {
    return `timeblock.interpreter.output.${channel}`;
  }

  function savedOutputDevice(channel) {
    try { return localStorage.getItem(outputStorageKey(channel)) || "default"; }
    catch (_error) { return "default"; }
  }

  function saveOutputDevice(channel, value) {
    try { localStorage.setItem(outputStorageKey(channel), value || "default"); }
    catch (_error) { /* Private browsing can disable persistent storage. */ }
  }

  function supportsAudioOutputSelection() {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  }

  async function loadAudioOutputs() {
    const selects = $$('[data-audio-output]');
    let devices = [];
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput");
      } catch (_error) {
        devices = [];
      }
    }
    selects.forEach((select) => {
      const channel = select.dataset.audioOutput;
      const selected = savedOutputDevice(channel);
      const options = [new Option(copy("translationOutputDefault") || "System default", "default")];
      devices.filter((device) => device.deviceId !== "default").forEach((device, index) => {
        options.push(new Option(device.label || `${copy("translationOutputUnnamed")} ${index + 1}`, device.deviceId));
      });
      select.replaceChildren(...options);
      if (Array.from(select.options).some((option) => option.value === selected)) select.value = selected;
      else saveOutputDevice(channel, "default");
      select.disabled = !supportsAudioOutputSelection();
      select.title = supportsAudioOutputSelection() ? "" : copy("translationOutputUnsupported");
    });
  }

  async function pickAudioOutput(channel) {
    const feedback = channel === "call" ? $('[data-call-translate-feedback]') : $('[data-translate-feedback]');
    if (navigator.mediaDevices?.selectAudioOutput) {
      try {
        const device = await navigator.mediaDevices.selectAudioOutput();
        saveOutputDevice(channel, device.deviceId);
        await loadAudioOutputs();
        setFeedback(feedback, copy("translationOutputSaved"), false);
        return;
      } catch (error) {
        if (error?.name !== "NotAllowedError") setFeedback(feedback, errorMessage(error), true);
        return;
      }
    }
    if (!supportsAudioOutputSelection()) {
      setFeedback(feedback, copy("translationOutputUnsupported"), true);
      return;
    }
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      await loadAudioOutputs();
      $(`[data-audio-output="${channel}"]`)?.focus();
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    }
  }

  async function applyAudioOutput(audio, channel) {
    const deviceId = savedOutputDevice(channel);
    if (!supportsAudioOutputSelection() || !audio.setSinkId) return;
    try {
      await audio.setSinkId(deviceId === "default" ? "" : deviceId);
    } catch (_error) {
      saveOutputDevice(channel, "default");
      try { await audio.setSinkId(""); } catch (_ignored) { /* OS default remains active. */ }
    }
  }

  async function playTranslatedSpeech(text, targetLanguage, channel = "1") {
    const value = String(text || "").trim();
    if (!value) return;
    const feedback = channel === "call" ? $('[data-call-translate-feedback]') : $('[data-translate-feedback]');
    stopTranslationSpeech();
    if (channel !== "call") setFeedback(feedback, copy("translationSpeaking"), false);
    try {
      const response = await fetch("/translator/api/speech", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ text: value, target_language: targetLanguage, lang: app.dataset.locale || "vi" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const audio = $(`[data-translation-audio="${channel}"]`);
      if (state.translationAudioUrls[channel]) URL.revokeObjectURL(state.translationAudioUrls[channel]);
      const url = URL.createObjectURL(blob);
      state.translationAudioUrls[channel] = url;
      audio.src = url;
      await applyAudioOutput(audio, channel);
      audio.onplay = () => { if (channel !== "call") setTranslationSpeechUi(true); };
      await new Promise(async (resolve, reject) => {
        audio.onended = () => {
          if (channel !== "call") {
            setTranslationSpeechUi(false);
            setFeedback(feedback, "", false);
          }
          resolve();
        };
        audio.onpause = () => resolve();
        audio.onerror = () => reject(new Error(copy("translationSpeechUnavailable")));
        try {
          await audio.play();
        } catch (error) {
          reject(error);
        }
      });
    } catch (_error) {
      await browserSpeechFallback(value, targetLanguage, feedback);
    }
  }

  function toggleTranslationSpeech() {
    const channel = state.translationDirection || "1";
    const audio = $(`[data-translation-audio="${channel}"]`);
    if ((audio && !audio.paused) || state.translationSpeech || window.speechSynthesis?.speaking) {
      stopTranslationSpeech();
      return;
    }
    const output = $('[data-translate-output]');
    const text = output.dataset.translation || "";
    if (!text) return;
    playTranslatedSpeech(text, output.dataset.targetLanguage || "vi", channel).catch((error) => {
      setFeedback($('[data-translate-feedback]'), errorMessage(error), true);
    });
  }

  function translationFormData(includeText = true, direction = "1") {
    const data = new FormData();
    data.append("source_language", directionNode(direction, "source").value);
    data.append("target_language", directionNode(direction, "target").value);
    data.append("lang", app.dataset.locale || "vi");
    if (includeText) data.append("text", $('[data-translate-text]').value.trim());
    return data;
  }

  async function submitTranslation(event) {
    event.preventDefault();
    const text = $('[data-translate-text]').value.trim();
    const feedback = $('[data-translate-feedback]');
    if (!text) {
      setFeedback(feedback, copy("translationEmpty"), true);
      return;
    }
    const submit = $('[data-translate-submit]');
    submit.disabled = true;
    event.currentTarget.setAttribute("aria-busy", "true");
    setFeedback(feedback, copy("loading"), false);
    try {
      const payload = await api("/translator/api/text", { method: "POST", body: translationFormData(true, "1") });
      payload.sourceText = text;
      setTranslationResult(payload, "1");
      setFeedback(feedback, "", false);
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      submit.disabled = false;
      event.currentTarget.removeAttribute("aria-busy");
    }
  }

  async function translateRecordedAudio(audio, direction) {
    const feedback = $('[data-translate-feedback]');
    const recordButtons = [
      $(`[data-interpreter-record="${direction}"]`),
      direction === "1" ? $('[data-quick-translate-record]') : null,
    ].filter(Boolean);
    const data = translationFormData(false, direction);
    data.append("file", audio.blob, audio.name);
    recordButtons.forEach((button) => { button.disabled = true; });
    setFeedback(feedback, copy("loading"), false);
    try {
      const payload = await api("/translator/api/audio", { method: "POST", body: data });
      setTranslationResult(payload, direction);
      setFeedback(feedback, "", false);
      if ($(`[data-interpreter-auto-speak="${direction}"]`)?.checked) {
        await playTranslatedSpeech(payload.translation, directionNode(direction, "target").value, direction);
      }
    } catch (error) {
      setFeedback(feedback, errorMessage(error), true);
    } finally {
      recordButtons.forEach((button) => { button.disabled = false; });
    }
  }

  function initTranslation() {
    const form = $('[data-translate-form]');
    form.addEventListener("submit", submitTranslation);
    $('[data-translate-speak]').addEventListener("click", toggleTranslationSpeech);
    $('[data-one-touch-toggle]').addEventListener("click", () => toggleOneTouch("translate"));
    $$('[data-interpreter-record]').forEach((recordButton) => {
      const direction = recordButton.dataset.interpreterRecord;
      const label = $(`[data-interpreter-record-label="${direction}"]`);
      recordButton.addEventListener("click", async () => {
        if (!$('[data-translate-consent]').checked) {
          setFeedback($('[data-translate-feedback]'), copy("translationConsentRequired"), true);
          $('[data-translate-consent]').focus();
          return;
        }
        try {
          const kind = `translation-audio-${direction}`;
          const stopping = state.recorder
            && state.recorder.kind === kind
            && state.recorder.mediaRecorder.state === "recording";
          label.textContent = stopping ? copy("translationProcessing") : copy("translationListening");
          await toggleAudioRecording(kind, recordButton, (audio) => {
            label.textContent = copy("translationHoldToTalk") || copy("translationSpeak");
            translateRecordedAudio(audio, direction);
          });
          if (stopping) label.textContent = copy("translationProcessing");
          else await loadAudioOutputs();
        } catch (error) {
          label.textContent = copy("translationHoldToTalk") || copy("translationSpeak");
          setFeedback($('[data-translate-feedback]'), errorMessage(error), true);
        }
      });
    });
    const quickRecordButton = $('[data-quick-translate-record]');
    const quickRecordLabel = $('[data-quick-translate-record-label]');
    quickRecordButton.addEventListener("click", async () => {
      if (!$('[data-translate-consent]').checked) {
        setFeedback($('[data-translate-feedback]'), copy("translationConsentRequired"), true);
        $('[data-translate-consent]').focus();
        return;
      }
      try {
        const kind = "translation-quick-audio";
        const stopping = state.recorder
          && state.recorder.kind === kind
          && state.recorder.mediaRecorder.state === "recording";
        quickRecordLabel.textContent = stopping ? copy("translationProcessing") : copy("translationListening");
        await toggleAudioRecording(kind, quickRecordButton, (audio) => {
          quickRecordLabel.textContent = copy("translationProcessing");
          translateRecordedAudio(audio, "1").finally(() => {
            quickRecordLabel.textContent = copy("translationRecord");
          });
        });
        if (stopping) quickRecordLabel.textContent = copy("translationProcessing");
      } catch (error) {
        quickRecordLabel.textContent = copy("translationRecord");
        setFeedback($('[data-translate-feedback]'), errorMessage(error), true);
      }
    });
    $$('[data-interpreter-swap]').forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.interpreterSwap;
        const source = directionNode(direction, "source");
        const target = directionNode(direction, "target");
        const previous = source.value;
        source.value = target.value;
        target.value = previous;
      });
    });
    $$('[data-audio-output]').forEach((select) => {
      select.addEventListener("change", () => {
        saveOutputDevice(select.dataset.audioOutput, select.value);
        const feedback = select.dataset.audioOutput === "call" ? $('[data-call-translate-feedback]') : $('[data-translate-feedback]');
        setFeedback(feedback, copy("translationOutputSaved"), false);
      });
    });
    $$('[data-audio-output-pick]').forEach((button) => {
      button.addEventListener("click", () => pickAudioOutput(button.dataset.audioOutputPick));
    });
    $('[data-translate-clear]').addEventListener("click", () => {
      stopTranslationSpeech();
      $('[data-translate-timeline]').replaceChildren(createElement("div", "assistant-note-card", copy("translationTimelineEmpty")));
      $('[data-translate-output]').textContent = copy("translationEmpty");
      $('[data-translate-output]').dataset.translation = "";
      $('[data-translate-transcript]').hidden = true;
      $('[data-translate-speak]').disabled = true;
    });
    loadAudioOutputs();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadAudioOutputs);
  }

  function ensureTranslationInitialized() {
    if (state.translationInitialized) return;
    initTranslation();
    state.translationInitialized = true;
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
    Object.values(state.translationAudioUrls).forEach((url) => URL.revokeObjectURL(url));
    state.translationAudioUrls = {};
    terminalCleanup(false, { reason: "pagehide" });
    if (call?.id && navigator.sendBeacon) {
      const payload = new Blob([JSON.stringify({ action })], { type: "application/json" });
      navigator.sendBeacon(`/api/messaging/calls/${encodeURIComponent(call.id)}/action`, payload);
    }
    state.viewportCleanup?.();
    document.body.classList.remove("is-keyboard-open");
    document.body.style.removeProperty("--assistant-visual-viewport-height");
    document.body.style.removeProperty("--assistant-visual-viewport-offset-top");
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
