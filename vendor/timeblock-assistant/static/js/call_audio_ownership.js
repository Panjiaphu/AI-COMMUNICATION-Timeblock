(() => {
  "use strict";

  const root = globalThis;
  if (root.TimeblockCallAudioOwnership) return;

  const CHANNEL_NAME = "timeblock.call-audio-ownership.v1";
  const LOCK_NAME = "timeblock-call-runtime-audio";
  const LEASE_KEY = "timeblock.call-runtime.leader.v2";
  const ASSISTANT_OWNER_KEY = "timeblock.call-audio.assistant-owner.v1";
  const LEASE_MS = 5000;
  const HEARTBEAT_MS = 1500;
  const TERMINAL_EVENTS = new Set([
    "call.rejected",
    "call.cancelled",
    "call.canceled",
    "call.missed",
    "call.ended",
    "call.failed",
  ]);
  const priorities = Object.freeze({
    "assistant-v1": 20,
    "global-runtime": 10,
  });

  const safeString = (value) => String(value || "").slice(0, 160);
  const now = () => Date.now();
  const makeTabId = () => `${now()}-${Math.random().toString(36).slice(2, 12)}`;
  const tabId = makeTabId();
  const participants = new Set();
  let channel = null;

  function parse(value) {
    try { return JSON.parse(value || "null"); }
    catch (_error) { return null; }
  }

  function readStorage(key) {
    try { return parse(root.localStorage?.getItem?.(key)); }
    catch (_error) { return null; }
  }

  function writeStorage(key, value) {
    try {
      root.localStorage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function removeStorageIfOwned(key, ownerTabId = tabId) {
    try {
      const current = readStorage(key);
      if (current?.tabId === ownerTabId) root.localStorage?.removeItem?.(key);
    } catch (_error) { /* optional storage */ }
  }

  function active(record, at = now()) {
    return Boolean(record?.tabId && Number(record.expiresAt || 0) > at);
  }

  function priority(ownerType) {
    return priorities[safeString(ownerType)] || 0;
  }

  function broadcast(type, detail = {}) {
    try {
      channel?.postMessage?.({ type, sourceTabId: tabId, at: now(), ...detail });
    } catch (_error) { /* best effort */ }
  }

  function suppressGlobalAudio(callId = "", reason = "assistant-priority") {
    const state = root.TIMEBLOCK_CALL_RUNTIME || root.__TIMEBLOCK_CALL_RUNTIME__;
    if (!state || state.mode !== "global") return;
    try { root.TimeblockCallAudio?.stopRingback?.(); } catch (_error) { /* best effort */ }
    try { state.ringtone?.stop?.(); } catch (_error) { /* best effort */ }
    state.incomingAudioId = "";
    try { state.releaseLock?.(); } catch (_error) { /* best effort */ }
    state.releaseLock = null;
    state.lockHeld = false;
    state.lockPending = false;
    state.leader = false;
    if (callId && state.ringbackId && safeString(state.ringbackId) === safeString(callId)) {
      state.ringbackId = "";
    }
    try {
      root.dispatchEvent?.(new root.CustomEvent("timeblock:call-audio-suppressed", {
        detail: { callId: safeString(callId), reason: safeString(reason) },
      }));
    } catch (_error) { /* optional diagnostic event */ }
  }

  function notifyLoss(record, reason) {
    for (const participant of Array.from(participants)) {
      if (!participant._current) continue;
      if (record?.callId && participant._current.callId !== safeString(record.callId)) continue;
      participant._lose(reason, record);
    }
  }

  function handleMessage(event) {
    const data = event?.data || {};
    if (!data || data.sourceTabId === tabId) return;
    if (data.type === "claim" && data.ownerType === "assistant-v1") {
      suppressGlobalAudio(data.callId, "assistant-claim");
      notifyLoss(data, "higher-priority-owner");
      return;
    }
    if (data.type === "silence") {
      suppressGlobalAudio(data.callId, data.reason || "cross-tab-silence");
      notifyLoss(data, data.reason || "cross-tab-silence");
      return;
    }
    if (data.type === "release") return;
  }

  try {
    channel = typeof root.BroadcastChannel === "function" ? new root.BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener?.("message", handleMessage);
  } catch (_error) {
    channel = null;
  }

  class Participant {
    constructor({ ownerType = "global-runtime", onLost = null } = {}) {
      this.ownerType = priorities[ownerType] ? ownerType : "global-runtime";
      this.onLost = typeof onLost === "function" ? onLost : null;
      this._current = null;
      this._heartbeat = null;
      this._releaseLock = null;
      this._lockRequest = null;
      this._closed = false;
      participants.add(this);
    }

    _record(callId, audioChannel) {
      return {
        tabId,
        ownerType: this.ownerType,
        priority: priority(this.ownerType),
        callId: safeString(callId),
        channel: audioChannel === "ringtone" ? "ringtone" : "ringback",
        expiresAt: now() + LEASE_MS,
      };
    }

    _leaseIsMine(callId, audioChannel) {
      const current = readStorage(ASSISTANT_OWNER_KEY);
      return Boolean(
        active(current)
        && current.tabId === tabId
        && current.ownerType === this.ownerType
        && current.callId === safeString(callId)
        && current.channel === (audioChannel === "ringtone" ? "ringtone" : "ringback")
      );
    }

    owns(callId, audioChannel) {
      if (!this._current) return false;
      return this._current.callId === safeString(callId)
        && this._current.channel === (audioChannel === "ringtone" ? "ringtone" : "ringback")
        && this._leaseIsMine(callId, audioChannel);
    }

    async claim(callId, audioChannel) {
      if (this._closed || !callId) return false;
      const record = this._record(callId, audioChannel);
      const current = readStorage(ASSISTANT_OWNER_KEY);
      if (
        active(current)
        && current.tabId !== tabId
        && priority(current.ownerType) >= record.priority
      ) return false;

      if (this.ownerType === "assistant-v1") {
        broadcast("claim", record);
        suppressGlobalAudio(record.callId, "assistant-claim-local");
      }

      writeStorage(ASSISTANT_OWNER_KEY, record);
      writeStorage(LEASE_KEY, record);

      if (root.navigator?.locks?.request) {
        const granted = await this._acquireLock(record);
        if (!granted) {
          removeStorageIfOwned(ASSISTANT_OWNER_KEY);
          removeStorageIfOwned(LEASE_KEY);
          return false;
        }
      } else {
        const verify = readStorage(ASSISTANT_OWNER_KEY);
        if (!verify || verify.tabId !== tabId) return false;
      }

      this._current = record;
      this._startHeartbeat();
      broadcast("claim", record);
      return true;
    }

    async _acquireLock(record) {
      if (this._releaseLock) return true;
      let resolveGranted;
      const granted = new Promise((resolve) => { resolveGranted = resolve; });
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolveGranted(Boolean(value));
      };

      const attempt = () => root.navigator.locks.request(
        LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock || this._closed) return;
          this._releaseLock = null;
          const hold = new Promise((resolve) => { this._releaseLock = resolve; });
          settle(true);
          await hold;
          this._releaseLock = null;
        },
      );

      this._lockRequest = (async () => {
        for (let index = 0; index < 5 && !settled; index += 1) {
          try {
            const request = attempt();
            await Promise.race([
              granted,
              new Promise((resolve) => root.setTimeout?.(resolve, 35) ?? setTimeout(resolve, 35)),
            ]);
            if (settled) break;
            await request.catch(() => undefined);
          } catch (_error) { /* retry */ }
        }
        if (!settled) settle(false);
      })();

      return granted;
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      const tick = () => {
        if (!this._current || this._closed) return;
        const refreshed = { ...this._current, expiresAt: now() + LEASE_MS };
        this._current = refreshed;
        writeStorage(ASSISTANT_OWNER_KEY, refreshed);
        writeStorage(LEASE_KEY, refreshed);
      };
      this._heartbeat = root.setInterval?.(tick, HEARTBEAT_MS) || null;
    }

    _stopHeartbeat() {
      if (this._heartbeat) root.clearInterval?.(this._heartbeat);
      this._heartbeat = null;
    }

    release(callId = "", audioChannel = "") {
      if (!this._current) return false;
      if (callId && this._current.callId !== safeString(callId)) return false;
      if (audioChannel && this._current.channel !== audioChannel) return false;
      const released = this._current;
      this._current = null;
      this._stopHeartbeat();
      removeStorageIfOwned(ASSISTANT_OWNER_KEY);
      removeStorageIfOwned(LEASE_KEY);
      try { this._releaseLock?.(); } catch (_error) { /* best effort */ }
      this._releaseLock = null;
      broadcast("release", released);
      return true;
    }

    silence(callId, reason = "terminal") {
      const id = safeString(callId);
      if (this._current && (!id || this._current.callId === id)) this.release();
      broadcast("silence", { callId: id, reason: safeString(reason) });
      suppressGlobalAudio(id, reason);
      return true;
    }

    _lose(reason, record = null) {
      if (!this._current) return;
      if (record?.callId && safeString(record.callId) !== this._current.callId) return;
      const lost = this._current;
      removeStorageIfOwned(ASSISTANT_OWNER_KEY);
      removeStorageIfOwned(LEASE_KEY);
      this._current = null;
      this._stopHeartbeat();
      try { this._releaseLock?.(); } catch (_error) { /* best effort */ }
      this._releaseLock = null;
      try { this.onLost?.({ ...lost, reason: safeString(reason) }); } catch (_error) { /* best effort */ }
    }

    close() {
      if (this._closed) return;
      this.release();
      this._closed = true;
      participants.delete(this);
    }
  }

  let assistantParticipant = null;
  let callV1Installed = false;
  let assistantEventsInstalled = false;

  function assistantOwner() {
    if (assistantParticipant) return assistantParticipant;
    assistantParticipant = new Participant({
      ownerType: "assistant-v1",
      onLost: () => {
        const runtime = root.TimeblockCallV1Runtime;
        try { runtime?.ring?.stopAll?.(); } catch (_error) { /* best effort */ }
      },
    });
    return assistantParticipant;
  }

  function installCallV1(namespace = root.TimeblockCallV1) {
    if (callV1Installed || !namespace?.RingAudio || !namespace?.CallV1Runtime) return false;
    callV1Installed = true;
    const owner = assistantOwner();

    const ringPrototype = namespace.RingAudio.prototype;
    const originalPlay = ringPrototype._play;
    ringPrototype._play = async function guardedPlay(audioChannel) {
      const runtime = root.TimeblockCallV1Runtime;
      const callId = runtime?.session?.callId || runtime?.call?.id || "";
      if (!callId) return originalPlay.call(this, audioChannel);
      const granted = await owner.claim(callId, audioChannel);
      if (!granted) {
        this._stop?.(audioChannel);
        return false;
      }
      const playable = await originalPlay.call(this, audioChannel);
      if (!playable || !owner.owns(callId, audioChannel)) {
        this._stop?.(audioChannel);
        if (!playable) owner.release(callId, audioChannel);
        return false;
      }
      return true;
    };

    const runtimePrototype = namespace.CallV1Runtime.prototype;
    runtimePrototype._silenceRing = function hardSilenceRing(reason = "state-change") {
      const generation = this.session?.generation ?? null;
      const duplicateTelemetry = generation !== null && this._ringSilencedGeneration === generation;
      const callId = this.session?.callId || this.call?.id || "";
      try { this.ring?.stopAll?.(); } catch (_error) { /* physical cleanup is repeatable */ }
      owner.silence(callId, reason);
      this._ringSilencedGeneration = generation;
      if (!duplicateTelemetry) {
        this._onRingAudioStateChange?.({ channel: "all", playable: false, reason });
        this._emitTelemetry?.("ring_state", { state: "stopped", reason });
      }
      return true;
    };

    return true;
  }

  function eventIdentity(detail = {}) {
    const event = detail.event || detail.rawEvent || {};
    const payload = event.payload || detail.payload || {};
    const eventType = safeString(
      detail.eventType
      || detail.type
      || event.type
      || event.event_type
      || payload.event_type,
    ).toLowerCase();
    const callId = safeString(
      detail.callId
      || detail.call_id
      || event.resource_id
      || event.call_id
      || payload.call_id
      || payload.id,
    );
    return { eventType, callId };
  }

  function installAssistantEvents() {
    if (assistantEventsInstalled || !root.document?.getElementById) return false;
    const app = root.document.getElementById("assistant-app");
    if (!app?.addEventListener) return false;
    assistantEventsInstalled = true;
    app.addEventListener("timeblock:messaging:call-state", (event) => {
      const runtime = root.TimeblockCallV1Runtime;
      const session = runtime?.session;
      if (!session?.callId) return;
      const identity = eventIdentity(event?.detail || {});
      if (!identity.callId || identity.callId !== safeString(session.callId)) return;
      if (identity.eventType === "call.accepted" && session.role === "caller") {
        runtime.silenceRing?.("realtime-accepted");
      } else if (TERMINAL_EVENTS.has(identity.eventType)) {
        runtime.silenceRing?.("realtime-terminal");
      }
    });
    return true;
  }

  function tryAutoInstall() {
    const installed = installCallV1(root.TimeblockCallV1);
    installAssistantEvents();
    return installed;
  }

  if (root.addEventListener) {
    root.addEventListener("storage", (event) => {
      if (event.key !== ASSISTANT_OWNER_KEY && event.key !== LEASE_KEY) return;
      const current = readStorage(ASSISTANT_OWNER_KEY);
      if (active(current) && current.ownerType === "assistant-v1" && current.tabId !== tabId) {
        suppressGlobalAudio(current.callId, "assistant-storage-owner");
        notifyLoss(current, "higher-priority-owner");
      }
    });
    root.addEventListener("pagehide", () => {
      for (const participant of Array.from(participants)) participant.close();
      try { channel?.close?.(); } catch (_error) { /* best effort */ }
    }, { once: true });
    root.addEventListener("beforeunload", () => {
      for (const participant of Array.from(participants)) participant.close();
    }, { once: true });
  }

  if (root.document) {
    root.setTimeout?.(tryAutoInstall, 0);
    root.document.addEventListener?.("DOMContentLoaded", tryAutoInstall, { once: true });
  }

  root.TimeblockCallAudioOwnership = Object.freeze({
    CHANNEL_NAME,
    LOCK_NAME,
    LEASE_KEY,
    ASSISTANT_OWNER_KEY,
    LEASE_MS,
    HEARTBEAT_MS,
    tabId,
    create: (options) => new Participant(options),
    assistantOwner,
    installCallV1,
    installAssistantEvents,
    suppressGlobalAudio,
    silence(callId, reason) { return assistantOwner().silence(callId, reason); },
    __test: Object.freeze({ active, priority, eventIdentity }),
  });
})();
