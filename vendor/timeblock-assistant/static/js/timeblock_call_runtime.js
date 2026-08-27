(() => {
  "use strict";

  if (window.__TIMEBLOCK_CALL_RUNTIME__) return;

  const POLL_MS = 2000;
  const HEARTBEAT_MS = 2000;
  const LEASE_MS = 7000;
  const LEASE_KEY = "timeblock.call-runtime.leader.v2";
  const OUTGOING_KEY = "timeblock.outgoing-call.v1";
  const LOCK_NAME = "timeblock-call-runtime-audio";
  const CHANNEL_NAME = "timeblock.call-runtime.v2";
  const TERMINAL = new Set(["accepted", "rejected", "cancelled", "missed", "ended"]);
  const assistantPage = Boolean(document.getElementById("assistant-app"));
  if (assistantPage && window.__TIMEBLOCK_CALL_V1_ENABLED__ === true) {
    const disabledOwner = { mode: "assistant-v1-disabled", stopped: true };
    window.__TIMEBLOCK_CALL_RUNTIME__ = disabledOwner;
    window.TIMEBLOCK_CALL_RUNTIME = disabledOwner;
    return;
  }
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const state = {
    mode: assistantPage ? "assistant-passive" : "global",
    me: null,
    incoming: null,
    outgoing: null,
    outgoingId: restoreOutgoingId(),
    missingOutgoing: 0,
    overlay: null,
    countdown: null,
    pollTimer: null,
    heartbeatTimer: null,
    ringtone: null,
    ringtonePromise: null,
    incomingAudioId: "",
    ringbackContext: null,
    ringbackTimer: null,
    ringbackId: "",
    ringbackGeneration: 0,
    ringbackNodes: new Set(),
    missedChimed: new Set(),
    leader: false,
    stopped: false,
    notified: new Set(),
    channel: null,
    lockHeld: false,
    lockPending: false,
    releaseLock: null,
    returnFocus: null,
  };

  window.__TIMEBLOCK_CALL_RUNTIME__ = state;
  window.TIMEBLOCK_CALL_RUNTIME = state;

  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const sameId = (left, right) => String(left || "") === String(right || "");

  function parse(value) {
    try { return JSON.parse(value || "null"); }
    catch (_error) { return null; }
  }

  function restoreOutgoingId() {
    try {
      const stored = parse(sessionStorage.getItem(OUTGOING_KEY));
      if (!stored || Date.now() - Number(stored.createdAt || 0) > 120000) {
        sessionStorage.removeItem(OUTGOING_KEY);
        return "";
      }
      return String(stored.callId || "");
    } catch (_error) {
      return "";
    }
  }

  function rememberOutgoing(created) {
    const callId = String(created?.id || "");
    if (!callId) return;
    state.outgoingId = callId;
    state.missingOutgoing = 0;
    try {
      sessionStorage.setItem(OUTGOING_KEY, JSON.stringify({ callId, createdAt: Date.now() }));
    } catch (_error) {
      // Session storage is only a recovery hint.
    }
  }

  function clearOutgoing(options = {}) {
    const previous = state.outgoing;
    const ringbackAlreadyStopped = Boolean(options.ringbackAlreadyStopped);
    state.outgoing = null;
    state.outgoingId = "";
    state.missingOutgoing = 0;
    if (!ringbackAlreadyStopped) stopRingback();
    try { sessionStorage.removeItem(OUTGOING_KEY); } catch (_error) { /* noop */ }
    if (previous?.id) emit("timeblock:call-status", {
      callId: previous.id,
      status: previous.status || "terminal",
    });
  }

  function readLease() {
    try { return parse(localStorage.getItem(LEASE_KEY)); }
    catch (_error) { return null; }
  }

  function broadcast(type, detail = {}) {
    try { state.channel?.postMessage({ type, tabId, at: Date.now(), ...detail }); }
    catch (_error) { /* noop */ }
  }

  function setLeader(value) {
    const next = Boolean(value) && !state.stopped;
    if (state.leader === next) return;
    state.leader = next;
    if (next) {
      broadcast("leader-active");
      syncAudio();
    } else {
      stopAudio();
    }
  }

  function claimFallbackLease() {
    if (state.stopped || navigator.locks?.request) return;
    const now = Date.now();
    const current = readLease();
    if (!current || Number(current.expiresAt || 0) <= now || current.tabId === tabId) {
      try {
        localStorage.setItem(LEASE_KEY, JSON.stringify({ tabId, expiresAt: now + LEASE_MS }));
      } catch (_error) {
        setLeader(true);
        return;
      }
    }
    setLeader(readLease()?.tabId === tabId);
  }

  function requestNavigatorLock() {
    if (state.stopped || !navigator.locks?.request || state.lockHeld || state.lockPending) return;
    state.lockPending = true;
    navigator.locks.request(LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      state.lockPending = false;
      if (!lock || state.stopped) {
        setLeader(false);
        return;
      }
      state.lockHeld = true;
      setLeader(true);
      await new Promise((resolve) => { state.releaseLock = resolve; });
      state.releaseLock = null;
      state.lockHeld = false;
      setLeader(false);
    }).catch(() => {
      state.lockPending = false;
      claimFallbackLease();
    });
  }

  function maintainLeadership() {
    if (navigator.locks?.request) requestNavigatorLock();
    else claimFallbackLease();
  }

  function releaseLeadership() {
    state.releaseLock?.();
    state.releaseLock = null;
    if (!navigator.locks?.request && readLease()?.tabId === tabId) {
      try { localStorage.removeItem(LEASE_KEY); } catch (_error) { /* noop */ }
    }
    broadcast("leader-release");
    setLeader(false);
  }

  function initLeadership() {
    try {
      state.channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
      state.channel?.addEventListener("message", (event) => {
        if (event.data?.tabId === tabId) return;
        if (event.data?.type === "leader-release") {
          setTimeout(maintainLeadership, 60 + Math.floor(Math.random() * 180));
        } else if (event.data?.type === "call-terminal") {
          terminal(event.data?.callId, { broadcastEvent: false });
        }
      });
    } catch (_error) {
      state.channel = null;
    }
    maintainLeadership();
    state.heartbeatTimer = setInterval(maintainLeadership, HEARTBEAT_MS);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { "X-Requested-With": "XMLHttpRequest", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadIdentity() {
    try {
      const entry = (await api("/api/messaging/directory/me")).entry || {};
      const ownerType = String(entry.owner_type || "");
      const ownerId = String(entry.owner_id || "");
      if (!["member", "business"].includes(ownerType) || !ownerId) return false;
      state.me = { ownerType, ownerId };
      return true;
    } catch (_error) {
      return false;
    }
  }

  const isIncoming = (call) => call?.status === "ringing" && state.me
    && String(call.callee_type) === state.me.ownerType
    && String(call.callee_id) === state.me.ownerId;
  const isOutgoing = (call) => call?.status === "ringing" && state.me
    && String(call.caller_type) === state.me.ownerType
    && String(call.caller_id) === state.me.ownerId;

  function seconds(call) {
    const expires = Date.parse(call?.ring_expires_at || "");
    const serverNow = Date.parse(call?.server_now || "");
    const skew = Number.isFinite(serverNow) ? Date.now() - serverNow : 0;
    return Number.isFinite(expires)
      ? Math.max(0, Math.ceil((expires + skew - Date.now()) / 1000))
      : Math.max(0, Number(call?.ring_timeout_seconds) || 60);
  }

  function overlay() {
    if (state.overlay) return state.overlay;
    const node = document.createElement("section");
    node.id = "timeblock-global-incoming-call";
    node.hidden = true;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-labelledby", "timeblock-global-call-title");
    node.innerHTML = `<div class="tb-global-call-card"><div class="tb-global-call-pulse" aria-hidden="true">&#9742;</div>
      <p class="tb-global-call-eyebrow">Cuộc gọi đến</p><h2 id="timeblock-global-call-title" data-global-call-title>Timeblock Contact</h2>
      <p data-global-call-media>Cuộc gọi thoại</p><strong data-global-call-countdown>60 giây</strong>
      <p data-global-call-error hidden></p><div class="tb-global-call-actions">
      <button type="button" data-global-call-reject>Từ chối</button><button type="button" data-global-call-answer>Trả lời</button></div></div>`;
    const style = document.createElement("style");
    style.textContent = `#timeblock-global-incoming-call{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(4,18,16,.76);backdrop-filter:blur(10px)}#timeblock-global-incoming-call[hidden]{display:none}.tb-global-call-card{width:min(92vw,410px);padding:30px;border-radius:28px;background:#fff;color:#102b27;text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.38)}.tb-global-call-pulse{display:grid;width:88px;height:88px;margin:0 auto 18px;place-items:center;border-radius:50%;background:#e8fff7;font-size:38px;animation:tbCallPulse 1.3s infinite}.tb-global-call-eyebrow{color:#168267;font-weight:800}.tb-global-call-card strong{display:block;margin:18px 0;font-size:28px}.tb-global-call-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tb-global-call-actions button{min-height:48px;border:0;border-radius:16px;padding:14px;font-size:16px;font-weight:800}.tb-global-call-actions [data-global-call-reject]{background:#ffe7e7;color:#a32121}.tb-global-call-actions [data-global-call-answer]{background:#0d8f70;color:#fff}@keyframes tbCallPulse{50%{transform:scale(1.08)}}@media(prefers-reduced-motion:reduce){.tb-global-call-pulse{animation:none}}`;
    document.head.appendChild(style);
    document.body.appendChild(node);
    node.querySelector("[data-global-call-answer]").addEventListener("click", answer);
    node.querySelector("[data-global-call-reject]").addEventListener("click", reject);
    state.overlay = node;
    return node;
  }

  function show(call) {
    const node = overlay();
    if (node.hidden) state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.hidden = false;
    node.querySelector("[data-global-call-title]").textContent = call.caller_display_name || call.caller_public_id || "Timeblock Contact";
    node.querySelector("[data-global-call-media]").textContent = call.media === "video" ? "Cuộc gọi video" : "Cuộc gọi thoại";
    const update = () => {
      const remaining = seconds(call);
      node.querySelector("[data-global-call-countdown]").textContent = `${remaining} giây`;
      if (remaining <= 0) hide();
    };
    update();
    clearInterval(state.countdown);
    state.countdown = setInterval(update, 250);
    requestAnimationFrame(() => node.querySelector("[data-global-call-answer]")?.focus({ preventScroll: true }));
  }

  function hide() {
    if (state.overlay) state.overlay.hidden = true;
    clearInterval(state.countdown);
    state.countdown = null;
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  }

  function answer() {
    const call = state.incoming;
    if (!call) return;
    stopIncoming();
    try {
      sessionStorage.setItem("timeblock.pending-call-answer", JSON.stringify({ call_id: String(call.id), created_at: Date.now() }));
    } catch (_error) { /* URL is the fallback. */ }
    emit("timeblock:call-answer-requested", { call });
    const url = new URL("/assistant", location.origin);
    url.searchParams.set("mode", "messages");
    url.searchParams.set("communication", "calls");
    url.searchParams.set("call_id", String(call.id));
    url.searchParams.set("answer", "1");
    location.assign(url.toString());
  }

  async function reject() {
    const call = state.incoming;
    if (!call) return;
    try {
      await api(`/api/messaging/calls/${encodeURIComponent(call.id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      state.incoming = null;
      hide();
      stopIncoming();
      emit("timeblock:call-rejected", { callId: call.id });
    } catch (error) {
      const message = overlay().querySelector("[data-global-call-error]");
      message.textContent = error.status === 409 ? "Cuộc gọi đã kết thúc." : "Không thể từ chối cuộc gọi.";
      message.hidden = false;
    }
  }

  function loadRingtone() {
    if (window.IncomingCallRingtoneController) return Promise.resolve(true);
    if (state.ringtonePromise) return state.ringtonePromise;
    state.ringtonePromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "/static/js/incoming_call_ringtone.js";
      script.onload = () => resolve(Boolean(window.IncomingCallRingtoneController));
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    return state.ringtonePromise;
  }

  async function startIncoming(call) {
    if (!state.leader || state.mode !== "global" || !call?.id || state.incomingAudioId === String(call.id)) return;
    stopRingback();
    if (!state.ringtone && await loadRingtone()) state.ringtone = new window.IncomingCallRingtoneController();
    if (!state.ringtone || !state.leader || !sameId(state.incoming?.id, call.id)) return;
    state.incomingAudioId = String(call.id);
    await state.ringtone.start(call.id, {
      media: call.media,
      maxDurationMs: Math.max(20000, Math.min(60000, seconds(call) * 1000)),
    }).catch(() => undefined);
  }

  function stopIncoming() {
    state.incomingAudioId = "";
    state.ringtone?.stop();
    if (navigator.userActivation?.hasBeenActive) {
      try { navigator.vibrate?.(0); } catch (_error) { /* noop */ }
    }
  }

  function preferences() {
    try {
      const stored = parse(localStorage.getItem("timeblockNotificationPreferences")) || {};
      const ringbackVolume = Number(stored.outgoing_ringback_volume_percent);
      const chimeVolume = Number(stored.missed_call_chime_volume_percent);
      return {
        ringbackEnabled: stored.outgoing_ringback_enabled !== false,
        ringbackVolume: Number.isFinite(ringbackVolume)
          ? Math.max(0.05, Math.min(ringbackVolume / 100, 1))
          : 0.7,
        chimeEnabled: stored.missed_call_chime_enabled !== false,
        chimeVolume: Number.isFinite(chimeVolume)
          ? Math.max(0.05, Math.min(chimeVolume / 100, 1))
          : 0.6,
      };
    } catch (_error) {
      return {
        ringbackEnabled: true,
        ringbackVolume: 0.7,
        chimeEnabled: true,
        chimeVolume: 0.6,
      };
    }
  }

  function audioContext() {
    if (state.ringbackContext && state.ringbackContext.state !== "closed") return state.ringbackContext;
    const Context = window.AudioContext || window.webkitAudioContext;
    state.ringbackContext = Context ? new Context() : null;
    return state.ringbackContext;
  }

  async function ringbackPulse(callId, generation) {
    if (
      !state.leader
      || !state.outgoing
      || state.incoming
      || String(state.ringbackId || "") !== String(callId || "")
      || state.ringbackGeneration !== generation
    ) return;
    const prefs = preferences();
    if (!prefs.ringbackEnabled) return;
    const context = audioContext();
    if (!context) return;
    try { await context.resume(); } catch (_error) { return; }
    if (
      !state.leader
      || state.incoming
      || String(state.ringbackId || "") !== String(callId || "")
      || state.ringbackGeneration !== generation
      || state.ringbackContext !== context
    ) return;
    const now = context.currentTime + 0.02;
    [0, 0.44].forEach((offset) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(440, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.09 * prefs.ringbackVolume, now + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.34);
      state.ringbackNodes.add(oscillator);
      state.ringbackNodes.add(gain);
      oscillator.addEventListener("ended", () => {
        try { oscillator.disconnect(); gain.disconnect(); } catch (_error) { /* noop */ }
        state.ringbackNodes.delete(oscillator);
        state.ringbackNodes.delete(gain);
      }, { once: true });
    });
  }

  function startRingback(call = state.outgoing) {
    if (!state.leader || state.incoming || !call?.id || call.status !== "ringing") return;
    if (state.ringbackId === String(call.id) && state.ringbackTimer) return;
    stopRingback();
    state.ringbackId = String(call.id);
    const generation = state.ringbackGeneration;
    ringbackPulse(state.ringbackId, generation);
    state.ringbackTimer = setInterval(() => ringbackPulse(state.ringbackId, generation), 3200);
  }

  function stopRingback() {
    state.ringbackGeneration += 1;
    clearInterval(state.ringbackTimer);
    state.ringbackTimer = null;
    state.ringbackId = "";
    const context = state.ringbackContext;
    state.ringbackContext = null;
    const nodes = Array.from(state.ringbackNodes);
    state.ringbackNodes.clear();
    nodes.forEach((node) => {
      try { node.stop?.(); } catch (_error) { /* noop */ }
      try { node.disconnect(); } catch (_error) { /* noop */ }
    });
    if (context && context.state !== "closed" && typeof context.close === "function") {
      try {
        const closing = context.close();
        closing?.catch?.(() => undefined);
      } catch (_error) { /* noop */ }
    }
  }

  function terminal(callId, options = {}) {
    const id = String(callId || "");
    const incomingMatches = !id || sameId(state.incoming?.id, id);
    const outgoingMatches = !id || sameId(state.outgoing?.id, id) || sameId(state.outgoingId, id);
    const ringbackMatches = !id || sameId(state.ringbackId, id);
    if (incomingMatches) {
      state.incoming = null;
      hide();
      stopIncoming();
    }
    if (outgoingMatches) clearOutgoing();
    else if (ringbackMatches) stopRingback();
    if (options.broadcastEvent !== false) broadcast("call-terminal", { callId: id });
  }

  async function playMissedChime(callId) {
    const normalizedId = String(callId || "");
    const prefs = preferences();
    if (
      !normalizedId
      || !state.leader
      || document.visibilityState !== "visible"
      || !prefs.chimeEnabled
      || state.missedChimed.has(normalizedId)
    ) return false;
    state.missedChimed.add(normalizedId);
    if (state.missedChimed.size > 100) {
      state.missedChimed.delete(state.missedChimed.values().next().value);
    }
    stopRingback();
    const context = audioContext();
    if (!context) return false;
    try { await context.resume(); } catch (_error) { return false; }
    const startAt = context.currentTime + 0.02;
    [659.25, 523.25].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const offset = index * 0.16;
      oscillator.frequency.setValueAtTime(frequency, startAt + offset);
      gain.gain.setValueAtTime(0.0001, startAt + offset);
      gain.gain.exponentialRampToValueAtTime(
        0.12 * prefs.chimeVolume,
        startAt + offset + 0.025,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt + offset);
      oscillator.stop(startAt + offset + 0.16);
    });
    return true;
  }

  window.TimeblockCallAudio = Object.freeze({
    playMissedChime,
    stopRingback,
    terminal,
  });

  function stopAudio() {
    stopIncoming();
    stopRingback();
  }

  function syncAudio() {
    if (!state.leader || state.stopped) {
      stopAudio();
      return;
    }
    if (state.incoming && state.mode === "global") {
      stopRingback();
      startIncoming(state.incoming);
      return;
    }
    stopIncoming();
    if (state.outgoing?.status === "ringing") startRingback(state.outgoing);
    else stopRingback();
  }

  async function notify(call) {
    if (!state.leader || state.mode !== "global" || state.notified.has(String(call.id)) || !("Notification" in window) || Notification.permission !== "granted") return;
    state.notified.add(String(call.id));
    const title = call.media === "video" ? "Bạn có cuộc gọi video đến" : "Bạn có cuộc gọi thoại đến";
    const url = `/assistant?mode=messages&communication=calls&call_id=${encodeURIComponent(call.id)}&answer=1`;
    const options = {
      body: `${call.caller_display_name || "Timeblock Contact"} đang gọi cho bạn.`,
      tag: `timeblock-call-${call.id}`,
      renotify: true,
      requireInteraction: true,
      icon: "/static/img/timeblock-icon-192.png",
      badge: "/static/img/timeblock-badge-96.png",
      data: { url, callId: call.id, type: "incoming_call" },
      vibrate: window.TIMEBLOCK_RINGTONE_VIBRATION_PATTERN,
    };
    try {
      if ("serviceWorker" in navigator) await (await navigator.serviceWorker.ready).showNotification(title, options);
      else new Notification(title, options);
    } catch (_error) { /* best effort */ }
  }

  function syncObserved(call) {
    if (!call?.id || !state.outgoingId) return;
    if (!sameId(call.id, state.outgoingId)) return;
    if (call.status === "ringing") {
      state.outgoing = call;
      state.missingOutgoing = 0;
      syncAudio();
    } else if (TERMINAL.has(String(call.status || ""))) {
      clearOutgoing();
    }
  }

  function callFromEvent(event) {
    return event?.detail?.call || null;
  }

  function observeAssistantCreated(event) {
    const call = callFromEvent(event);
    if (!call?.id || call.status !== "ringing") return;
    rememberOutgoing(call);
    state.outgoing = call;
    emit("timeblock:call-status", { callId: call.id, status: "ringing" });
    syncAudio();
  }

  function observeAssistantUpdated(event) {
    syncObserved(callFromEvent(event));
  }

  function observeAssistantEnded(event) {
    const callId = event?.detail?.callId || callFromEvent(event)?.id;
    if (state.outgoingId && sameId(callId, state.outgoingId)) {
      clearOutgoing({ ringbackAlreadyStopped: true });
    }
  }

  function observeAssistantList(event) {
    if (!state.outgoingId) return;
    const calls = Array.isArray(event?.detail?.calls) ? event.detail.calls : [];
    const current = calls.find((call) => sameId(call?.id, state.outgoingId));
    if (current) {
      state.missingOutgoing = 0;
      syncObserved(current);
    } else {
      state.missingOutgoing += 1;
      if (state.missingOutgoing >= 2) clearOutgoing();
    }
  }

  function installAssistantEventObserver() {
    addEventListener("timeblock:call-created", observeAssistantCreated);
    addEventListener("timeblock:call-updated", observeAssistantUpdated);
    addEventListener("timeblock:call-ended", observeAssistantEnded);
    addEventListener("timeblock:call-list", observeAssistantList);
  }

  async function pollGlobalCalls() {
    if (state.stopped || state.mode !== "global" || !state.me) return;
    try {
      const calls = (await api("/api/messaging/calls")).calls || [];
      const nextIncoming = calls.find(isIncoming) || null;
      const nextOutgoing = calls.find(isOutgoing) || null;
      if (nextIncoming) {
        const changed = !sameId(state.incoming?.id, nextIncoming.id);
        state.incoming = nextIncoming;
        show(nextIncoming);
        if (changed) emit("timeblock:call-incoming", { call: nextIncoming });
        if (state.leader) notify(nextIncoming);
      } else if (state.incoming) {
        const previousIncoming = state.incoming;
        emit("timeblock:call-ended", { callId: previousIncoming.id });
        state.incoming = null;
        hide();
        stopIncoming();
        api(`/api/messaging/calls/${encodeURIComponent(previousIncoming.id)}`)
          .then((result) => {
            if (result.call?.status === "missed") {
              playMissedChime(previousIncoming.id);
            }
          })
          .catch(() => undefined);
      }
      if (nextOutgoing) {
        state.outgoing = nextOutgoing;
        rememberOutgoing(nextOutgoing);
      } else if (state.outgoing) {
        clearOutgoing();
      }
      syncAudio();
    } catch (error) {
      if ([401, 403].includes(error.status)) stopRuntime();
    }
  }

  function arm() {
    state.ringtone?.arm?.();
    audioContext()?.resume?.().catch(() => undefined);
    syncAudio();
  }

  function stopRuntime() {
    if (state.stopped) return;
    state.stopped = true;
    clearInterval(state.pollTimer);
    clearInterval(state.heartbeatTimer);
    hide();
    stopAudio();
    releaseLeadership();
    try { state.channel?.close(); } catch (_error) { /* noop */ }
  }

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => document.addEventListener(eventName, arm, { passive: true }));
  addEventListener("storage", (event) => { if (event.key === LEASE_KEY && !navigator.locks?.request) maintainLeadership(); });
  addEventListener("beforeunload", stopRuntime);
  addEventListener("pagehide", stopRuntime);

  initLeadership();

  if (assistantPage) {
    // Assistant owns WebRTC, incoming UI, polling and ringtone. This passive
    // observer derives caller ringback from explicit Assistant call events.
    installAssistantEventObserver();
    return;
  }

  (async () => {
    if (!(await loadIdentity())) {
      stopRuntime();
      return;
    }
    await pollGlobalCalls();
    state.pollTimer = setInterval(pollGlobalCalls, POLL_MS);
  })();
})();
