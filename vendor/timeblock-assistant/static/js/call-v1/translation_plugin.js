(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};
  const CONNECTED = "CONNECTED";
  const TERMINAL = new Set(["TERMINATING", "ENDED"]);
  const LANGUAGES = new Set(["vi", "en", "zh-TW", "ja", "ko", "th", "id"]);

  function randomId(prefix = "call") {
    const uuid = root.crypto?.randomUUID?.();
    if (uuid) return `${prefix}-${uuid}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function language(value, fallback) {
    const normalized = String(value || "").trim();
    return LANGUAGES.has(normalized) ? normalized : fallback;
  }

  class CallTranslationPlugin {
    constructor({
      document = root.document,
      app = document?.getElementById?.("assistant-app"),
      fetcher = root.fetch?.bind(root),
      mediaRecorderFactory = root.MediaRecorder,
      audioContextFactory = root.AudioContext || root.webkitAudioContext,
      peerConnectionFactory = root.RTCPeerConnection,
      providerFetcher = root.fetch?.bind(root),
    } = {}) {
      this.document = document;
      this.app = app;
      this.fetcher = fetcher;
      this.mediaRecorderFactory = mediaRecorderFactory;
      this.audioContextFactory = audioContextFactory;
      this.peerConnectionFactory = peerConnectionFactory;
      this.providerFetcher = providerFetcher;
      this.runtime = null;
      this.callId = "";
      this.callGeneration = null;
      this.pluginGeneration = 0;
      this.state = "IDLE";
      this.lastResult = null;
      this.peerPreference = null;
      this.historyBeforeId = null;
      this.historyCallId = "";
      this.preferenceVersion = 0;
      this.peerPreferenceVersion = 0;
      this.syncConnected = false;
      this.mutedAutoReadSnapshot = null;
      this._autoReadReady = null;
      this._autoReadPreparation = null;
      this._mixerPromise = null;
      this.bound = false;
      this._owned = {
        recorders: new Set(),
        abortControllers: new Set(),
        ttsAbortControllers: new Set(),
        autoReadAbortControllers: new Set(),
        ttsSources: new Set(),
        outboundTtsSources: new Set(),
        autoReadTtsSources: new Set(),
        objectUrls: new Set(),
        audioContexts: new Set(),
        mixedTracks: new Set(),
        realtimePeerConnections: new Set(),
        realtimeDataChannels: new Set(),
        realtimeTracks: new Set(),
        timers: new Set(),
        listeners: new Set(),
      };
      this._recording = null;
      this._mixer = null;
      this._seenRequestIds = new Set();
      this._seenEventIds = new Set();
    }

    attachRuntime(runtime) {
      this.runtime = runtime || null;
      this.mount();
      return this;
    }

    mount() {
      if (this.bound || !this.document) return this;
      this.bound = true;
      this.ui = {
        stage: this.document.querySelector("[data-call-stage]"),
        toggle: this.document.querySelector("[data-call-translation-toggle]"),
        panel: this.document.querySelector("[data-call-translation-panel]"),
        close: this.document.querySelector("[data-call-translation-close]"),
        syncStatus: this.document.querySelector("[data-call-translation-sync-status]"),
        realtimeMode: this.document.querySelector("[data-call-translation-realtime-mode]"),
        source: this.document.querySelector("[data-call-translation-source]"),
        target: this.document.querySelector("[data-call-translation-target]"),
        swap: this.document.querySelector("[data-call-translation-swap]"),
        textForm: this.document.querySelector("[data-call-translation-text-form]"),
        text: this.document.querySelector("[data-call-translation-text]"),
        submit: this.document.querySelector("[data-call-translation-submit]"),
        record: this.document.querySelector("[data-call-translation-record]"),
        recordStatus: this.document.querySelector("[data-call-translation-record-status]"),
        autoRead: this.document.querySelector("[data-call-translation-auto-read]"),
        status: this.document.querySelector("[data-call-translation-status]"),
        result: this.document.querySelector("[data-call-translation-result]"),
        empty: this.document.querySelector("[data-call-translation-empty]"),
        values: this.document.querySelector("[data-call-translation-values]"),
        direction: this.document.querySelector("[data-call-translation-direction]"),
        original: this.document.querySelector("[data-call-translation-original]"),
        output: this.document.querySelector("[data-call-translation-output]"),
        listen: this.document.querySelector("[data-call-translation-listen]"),
        send: this.document.querySelector("[data-call-translation-send]"),
        historyRefresh: this.document.querySelector("[data-call-translation-history-refresh]"),
        historyList: this.document.querySelector("[data-call-translation-history-list]"),
        historyMore: this.document.querySelector("[data-call-translation-history-more]"),
        quotaText: this.document.querySelector("[data-call-translation-quota-text]"),
        quotaAudio: this.document.querySelector("[data-call-translation-quota-audio]"),
        quotaSpeech: this.document.querySelector("[data-call-translation-quota-speech]"),
      };
      this._listen(this.ui.toggle, "click", () => this.togglePanel());
      this._listen(this.ui.close, "click", () => { void this.closePanel(); });
      this._listen(this.ui.swap, "click", () => this.swapLanguages());
      this._listen(this.ui.source, "change", () => {
        this._savePreference();
        void this._publishPreference();
      });
      this._listen(this.ui.target, "change", () => {
        this._savePreference();
        void this._publishPreference();
      });
      this._listen(this.ui.textForm, "submit", (event) => {
        event.preventDefault();
        void this.translateText();
      });
      this._listen(this.ui.text, "focus", () => this._scheduleTextEntryVisibility());
      this._listen(this.document?.defaultView?.visualViewport, "resize", () => this._scheduleTextEntryVisibility());
      this._listen(this.document?.defaultView?.visualViewport, "scroll", () => this._scheduleTextEntryVisibility());
      this._listen(this.ui.record, "click", () => {
        if (this._recording) this.stopRecording();
        else this.startRecording();
      });
      this._listen(this.ui.listen, "click", () => { void this.listenLocally(); });
      this._listen(this.ui.send, "click", () => { void this.sendToOpponent(); });
      this._listen(this.ui.autoRead, "change", (event) => this._beginAutoReadChange(event));
      this._listen(this.ui.historyRefresh, "click", () => { void this.loadHistory(true); });
      this._listen(this.ui.historyMore, "click", () => { void this.loadHistory(false); });
      this._listen(this.app, "timeblock:messaging:call-translation", (event) => this.handleRealtimeEvent(event.detail));
      this._listen(this.app, "timeblock:messaging:me", () => this.restorePreference());
      this.restorePreference();
      this._setPanel(false);
    }

    _listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      this._owned.listeners.add(() => target.removeEventListener(type, handler, options));
    }

    _copy(name, fallback) {
      return this.app?.dataset?.[name] || fallback;
    }

    _setStatus(message = "", isError = false) {
      if (!this.ui?.status) return;
      this.ui.status.textContent = message;
      this.ui.status.classList.toggle("is-error", Boolean(isError));
    }

    _stageError(stage, error, code = "") {
      const failure = error instanceof Error ? error : new Error(code || "call-translation.speech-failed");
      if (!failure.callTranslationStage) failure.callTranslationStage = String(stage || "unknown");
      if (code && !failure.code) failure.code = code;
      return failure;
    }

    _reportSpeechFailure(stage, error = null) {
      const safeStage = String(stage || error?.callTranslationStage || "unknown").slice(0, 64);
      const safeName = String(error?.name || "Error").slice(0, 48);
      const status = Number(error?.status || 0);
      // Stage-only diagnostics distinguish browser lifecycle failures without
      // logging provider payloads, translated text, credentials, or secrets.
      root.console?.warn?.("call_translation_speech_failed", {
        stage: safeStage,
        error_name: safeName,
        status: Number.isFinite(status) ? status : 0,
      });
    }

    _setPanel(open) {
      if (!this.ui?.panel) return;
      this.ui.panel.hidden = !open;
      this.ui.panel.setAttribute("aria-hidden", String(!open));
      this.ui.toggle?.setAttribute("aria-expanded", String(Boolean(open)));
      this.ui.stage?.classList.toggle("has-call-translation", Boolean(open));
      this.ui.panel.closest("[data-call-canvas]")?.classList.toggle("has-call-translation", Boolean(open));
      if (!open) this.ui.panel.classList.remove("is-expanded");
      this.panelOpen = Boolean(open);
      if (open) this.ui.source?.focus?.({ preventScroll: true });
    }

    _callViewportContract() {
      const view = this.document?.defaultView || root;
      const style = view.getComputedStyle?.(this.document?.documentElement);
      const read = (name, fallback) => {
        const value = Number.parseFloat(style?.getPropertyValue(name) || "");
        return Number.isFinite(value) ? value : fallback;
      };
      const top = read("--timeblock-call-viewport-top", Number(view.visualViewport?.offsetTop || 0));
      const height = read(
        "--timeblock-call-viewport-height",
        Number(view.visualViewport?.height || view.innerHeight || 0),
      );
      const publishedBottom = read("--timeblock-call-viewport-bottom", Number.NaN);
      return {
        top: Math.max(0, top),
        bottom: Number.isFinite(publishedBottom) ? publishedBottom : Math.max(0, top + height),
      };
    }

    _scheduleTextEntryVisibility() {
      const view = this.document?.defaultView || root;
      const sync = () => this._ensureTextEntryVisibility();
      if (typeof view.requestAnimationFrame === "function") view.requestAnimationFrame(sync);
      else sync();
    }

    _ensureTextEntryVisibility() {
      const panel = this.ui?.panel;
      const text = this.ui?.text;
      if (!this.panelOpen || !panel || !text || typeof panel.scrollTop !== "number") return;
      const viewport = this._callViewportContract();
      const rect = text.getBoundingClientRect?.();
      if (!rect) return;
      const padding = 12;
      const panelRect = panel.getBoundingClientRect?.();
      const visibleTop = Math.max(viewport.top + padding, (panelRect?.top || viewport.top) + padding);
      const visibleBottom = Math.min(viewport.bottom - padding, (panelRect?.bottom || viewport.bottom) - padding);
      if (rect.top < visibleTop) {
        panel.scrollTop = Math.max(0, panel.scrollTop - (visibleTop - rect.top));
      } else if (rect.bottom > visibleBottom) {
        panel.scrollTop += rect.bottom - visibleBottom;
      }
    }

    togglePanel() {
      if (!this.isConnected()) return;
      const open = Boolean(this.ui?.panel && this.ui.panel.hidden);
      if (open) {
        this._openForCurrentCall();
        return;
      }
      void this.closePanel();
    }

    async closePanel() {
      if (!this.callId) {
        this._setPanel(false);
        this.ui?.toggle?.focus?.({ preventScroll: true });
        return;
      }
      const restored = await this._restoreOriginalAudioTrack();
      if (!restored) {
        this._setStatus(this._copy("copyTranslationTrackRestoreFailed", "The call audio could not be restored; keep the panel open and try again."), true);
        return false;
      }
      this._teardown("panel-closed", { terminating: false, preserveCall: true });
      this._setPanel(false);
      if (this.ui?.toggle) this.ui.toggle.hidden = false;
      this.ui?.toggle?.focus?.({ preventScroll: true });
      return true;
    }

    _openForCurrentCall() {
      const callId = String(this.runtime?.session?.callId || "");
      if (!callId || !this.isConnected()) return;
      if (this.callId !== callId) this._startCall(callId);
      this._setPanel(true);
      if (this.historyCallId !== callId) void this.loadHistory(true);
      void this.loadQuota();
      void this._publishPreference();
    }

    handleCallState(event = {}) {
      const status = String(event.status || "").toUpperCase();
      const callId = String(event.callId || this.runtime?.session?.callId || "");
      if (status === CONNECTED && callId) {
        this.ui && (this.ui.toggle.hidden = false);
        if (this.callId !== callId) this._startCall(callId);
        return;
      }
      if (TERMINAL.has(status)) {
        this.ui && (this.ui.toggle.hidden = true);
        this.beforeCallTerminate({ callId, reason: event.reason || status.toLowerCase() });
        this._setPanel(false);
        this._setStatus(this._copy("copyTranslationCallEnded", "The call ended; live translation is closed."));
        return;
      }
      if (this.ui?.toggle) this.ui.toggle.hidden = true;
    }

    beforeCallTerminate({ callId = "", reason = "terminated" } = {}) {
      if (!this.callId || (callId && String(callId) !== this.callId)) return false;
      // Generation invalidation happens before recorder data or TTS callbacks can
      // publish anything. No provider is awaited and no canonical sender is replaced.
      this.state = "TERMINATING";
      this.pluginGeneration += 1;
      this._teardown(reason, { terminating: true });
      return true;
    }

    _startCall(callId) {
      this._teardown("new-call", { terminating: false });
      this.callId = String(callId || "");
      this.callGeneration = this.runtime?.session?.callbackToken?.() ?? null;
      this.pluginGeneration += 1;
      this.state = "CONNECTED";
      this.lastResult = null;
      this.peerPreference = null;
      this.historyBeforeId = null;
      this.historyCallId = "";
      this.preferenceVersion = 0;
      this.peerPreferenceVersion = 0;
      this.syncConnected = false;
      this.mutedAutoReadSnapshot = null;
      this._seenRequestIds.clear();
      this._seenEventIds.clear();
      this._resetResult();
      this._setRecordState(false);
      if (this.ui?.autoRead) {
        this.ui.autoRead.checked = false;
        this.ui.autoRead.disabled = false;
        this.ui.autoRead.removeAttribute("aria-disabled");
      }
      this._setSyncStatus(false);
      this._resetQuota();
      this.syncMuteState();
    }

    isConnected() {
      return this.state === "CONNECTED"
        && Boolean(this.callId)
        && this.runtime?.session?.callId === this.callId
        && this.runtime?.session?.status === CONNECTED;
    }

    _activeGeneration(callId = this.callId, generation = this.pluginGeneration, segmentId = "") {
      if (!callId || callId !== this.callId || generation !== this.pluginGeneration || !this.isConnected()) return false;
      if (segmentId && !String(segmentId)) return false;
      return true;
    }

    _newSegment() {
      return randomId("segment");
    }

    _request(path, options = {}, generation = this.pluginGeneration) {
      if (typeof this.fetcher !== "function") return Promise.reject(new Error("call-translation.fetch-unavailable"));
      const {
        rawResponse = false,
        controllerSet = null,
        controllerSets = [],
        ...fetchOptions
      } = options;
      const ownedControllerSets = [controllerSet, ...controllerSets].filter(Boolean);
      const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
      if (controller) {
        this._owned.abortControllers.add(controller);
        for (const ownedSet of ownedControllerSets) ownedSet?.add?.(controller);
      }
      return this.fetcher(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...fetchOptions,
        signal: controller?.signal || fetchOptions.signal,
        headers: { Accept: rawResponse ? "audio/mpeg" : "application/json", "X-Requested-With": "XMLHttpRequest", ...(fetchOptions.headers || {}) },
      }).then(async (response) => {
        if (rawResponse) {
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const error = new Error(payload.error || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          return response;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error || `HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return payload;
      }).finally(() => {
        if (controller) this._owned.abortControllers.delete(controller);
        if (controller) {
          for (const ownedSet of ownedControllerSets) ownedSet?.delete?.(controller);
        }
      });
    }

    _callPayload({ requestId = randomId("request"), segmentId = this._newSegment(), text = "" } = {}) {
      return {
        request_id: requestId,
        segment_id: segmentId,
        source_language: String(this.ui?.source?.value || "vi"),
        target_language: String(this.ui?.target?.value || "zh-TW"),
        text,
      };
    }


    _realtimeEnabled() {
      return String(this.app?.dataset?.callTranslationRealtimeEnabled || "").toLowerCase() === "true";
    }

    _ownedTimeout(callback, delayMs) {
      const timeout = root.setTimeout(() => {
        this._owned.timers.delete(timeout);
        callback();
      }, Math.max(0, Number(delayMs) || 0));
      this._owned.timers.add(timeout);
      return timeout;
    }

    _clearOwnedTimeout(timeout) {
      if (timeout === null || timeout === undefined) return;
      try { root.clearTimeout(timeout); } catch (_error) { /* best effort */ }
      this._owned.timers.delete(timeout);
    }

    _newRealtimeContext(recording, sourceLanguage, targetLanguage) {
      return {
        state: "STARTING",
        callId: recording.callId,
        generation: recording.generation,
        segmentId: recording.segmentId,
        requestId: recording.requestId,
        sourceLanguage,
        targetLanguage,
        transcript: "",
        translation: "",
        providerSessionId: "",
        providerReady: false,
        providerClosed: false,
        stopRequested: false,
        closeSent: false,
        pc: null,
        dataChannel: null,
        clonedTrack: null,
        providerAbortController: null,
        maxDurationMs: 0,
        maxDurationTimer: null,
        drainTimer: null,
        finalizeAttempt: 0,
      };
    }

    _realtimeCurrent(recording) {
      const realtime = recording?.realtime;
      return Boolean(
        realtime
        && realtime === recording.realtime
        && realtime.callId === recording.callId
        && realtime.generation === recording.generation
        && realtime.segmentId === recording.segmentId
        && this._activeGeneration(recording.callId, recording.generation, recording.segmentId)
      );
    }

    _renderRealtimePartial(recording) {
      if (!this._realtimeCurrent(recording)) return;
      const realtime = recording.realtime;
      if (this.ui?.empty) this.ui.empty.hidden = true;
      if (this.ui?.values) this.ui.values.hidden = false;
      if (this.ui?.direction) this.ui.direction.textContent = `${realtime.sourceLanguage} → ${realtime.targetLanguage}`;
      if (this.ui?.original) this.ui.original.textContent = realtime.transcript || "…";
      if (this.ui?.output) this.ui.output.textContent = realtime.translation || "…";
      if (this.ui?.listen) this.ui.listen.disabled = true;
      if (this.ui?.send) this.ui.send.disabled = true;
      if (this.ui?.realtimeMode) {
        this.ui.realtimeMode.hidden = false;
        this.ui.realtimeMode.textContent = this._copy("copyTranslationRealtimeBadge", "Realtime");
      }
      this._setStatus(this._copy("copyTranslationRealtimeLive", "Live translation is streaming…"));
    }

    _cleanupRealtimeContext(realtime, { abortProvider = true } = {}) {
      if (!realtime) return;
      this._clearOwnedTimeout(realtime.maxDurationTimer);
      realtime.maxDurationTimer = null;
      this._clearOwnedTimeout(realtime.drainTimer);
      realtime.drainTimer = null;
      if (abortProvider && realtime.providerAbortController) {
        try { realtime.providerAbortController.abort(); } catch (_error) { /* best effort */ }
      }
      if (realtime.providerAbortController) this._owned.abortControllers.delete(realtime.providerAbortController);
      realtime.providerAbortController = null;
      const channel = realtime.dataChannel;
      if (channel) {
        try {
          channel.onopen = null;
          channel.onmessage = null;
          channel.onerror = null;
          channel.onclose = null;
          channel.close?.();
        } catch (_error) { /* best effort */ }
        this._owned.realtimeDataChannels.delete(channel);
      }
      realtime.dataChannel = null;
      const pc = realtime.pc;
      if (pc) {
        try { pc.onconnectionstatechange = null; pc.ontrack = null; pc.close?.(); } catch (_error) { /* best effort */ }
        this._owned.realtimePeerConnections.delete(pc);
      }
      realtime.pc = null;
      const clonedTrack = realtime.clonedTrack;
      if (clonedTrack) {
        try { clonedTrack.stop?.(); } catch (_error) { /* sidecar clone only */ }
        this._owned.realtimeTracks.delete(clonedTrack);
      }
      realtime.clonedTrack = null;
    }

    _fallbackRealtime(recording) {
      const realtime = recording?.realtime;
      if (!realtime || ["COMPLETED", "FINALIZING", "RETRY_FINALIZE"].includes(realtime.state)) return;
      realtime.state = "FALLBACK";
      if (this.ui?.realtimeMode) this.ui.realtimeMode.hidden = true;
      this._setStatus(this._copy("copyTranslationRealtimeFallback", "Realtime unavailable; finishing with the recorded fallback…"));
      this._cleanupRealtimeContext(realtime);
      this._completeVoiceRecording(recording);
    }

    _handleRealtimeProviderEvent(recording, rawEvent) {
      if (!this._realtimeCurrent(recording)) return;
      let event;
      try {
        event = typeof rawEvent === "string" ? JSON.parse(rawEvent) : rawEvent;
      } catch (_error) {
        return;
      }
      if (!event || typeof event !== "object") return;
      const realtime = recording.realtime;
      const type = String(event.type || "");
      if (type === "error") {
        this._fallbackRealtime(recording);
        return;
      }
      if (type === "session.created" || type === "session.updated") {
        realtime.providerReady = true;
        if (realtime.state === "STARTING") realtime.state = "STREAMING";
        return;
      }
      if (type === "session.input_transcript.delta") {
        realtime.providerReady = true;
        realtime.transcript += String(event.delta || "");
        this._renderRealtimePartial(recording);
        return;
      }
      if (type === "session.output_transcript.delta") {
        realtime.providerReady = true;
        realtime.translation += String(event.delta || "");
        this._renderRealtimePartial(recording);
        return;
      }
      if (type !== "session.closed") return;
      realtime.providerClosed = true;
      realtime.providerReady = true;
      this._clearOwnedTimeout(realtime.drainTimer);
      realtime.drainTimer = null;
      if (realtime.transcript.trim() && realtime.translation.trim()) {
        realtime.state = "FINALIZING";
        this._cleanupRealtimeContext(realtime, { abortProvider: false });
      } else {
        realtime.state = "FALLBACK";
        this._cleanupRealtimeContext(realtime, { abortProvider: false });
      }
      this._completeVoiceRecording(recording);
    }

    async _startRealtimeFastPath(recording, canonicalTrack) {
      if (!recording?.realtime || !this._realtimeCurrent(recording)) return;
      const realtime = recording.realtime;
      const payload = {
        request_id: recording.requestId,
        segment_id: recording.segmentId,
        source_language: realtime.sourceLanguage,
        target_language: realtime.targetLanguage,
      };
      let session;
      try {
        session = await this._request(
          `/api/messaging/calls/${encodeURIComponent(recording.callId)}/translation/realtime/session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          recording.generation,
        );
      } catch (_error) {
        if (this._realtimeCurrent(recording)) this._fallbackRealtime(recording);
        return;
      }
      if (!this._realtimeCurrent(recording)) return;
      if (this.ui?.realtimeMode) {
        this.ui.realtimeMode.hidden = false;
        this.ui.realtimeMode.textContent = this._copy("copyTranslationRealtimeBadge", "Realtime");
      }
      if (recording.stopRequested) {
        realtime.state = "FALLBACK";
        this._cleanupRealtimeContext(realtime);
        this._completeVoiceRecording(recording);
        return;
      }
      const clientSecret = String(session?.client_secret || "");
      if (session && typeof session === "object") delete session.client_secret;
      if (!clientSecret || typeof this.peerConnectionFactory !== "function" || typeof this.providerFetcher !== "function") {
        this._fallbackRealtime(recording);
        return;
      }
      if (typeof canonicalTrack?.clone !== "function" || typeof root.MediaStream !== "function") {
        this._fallbackRealtime(recording);
        return;
      }
      let pc = null;
      let events = null;
      let clonedTrack = null;
      try {
        clonedTrack = canonicalTrack.clone();
        if (!clonedTrack || clonedTrack === canonicalTrack) throw new Error("call-translation.realtime-clone-failed");
        realtime.clonedTrack = clonedTrack;
        this._owned.realtimeTracks.add(clonedTrack);

        pc = new this.peerConnectionFactory();
        realtime.pc = pc;
        this._owned.realtimePeerConnections.add(pc);
        events = pc.createDataChannel("oai-events");
        realtime.dataChannel = events;
        this._owned.realtimeDataChannels.add(events);
        events.onmessage = ({ data }) => this._handleRealtimeProviderEvent(recording, data);
        events.onerror = () => this._fallbackRealtime(recording);
        events.onclose = () => {
          if (!this._realtimeCurrent(recording)) return;
          if (!realtime.providerClosed && !["FALLBACK", "FINALIZING", "RETRY_FINALIZE", "COMPLETED"].includes(realtime.state)) {
            this._fallbackRealtime(recording);
          }
        };
        events.onopen = () => {
          if (!this._realtimeCurrent(recording)) return;
          realtime.providerReady = true;
          if (realtime.state === "STARTING") realtime.state = "STREAMING";
          if (recording.stopRequested) this._requestRealtimeClose(recording);
        };
        pc.onconnectionstatechange = () => {
          const state = String(pc.connectionState || "");
          if (["failed", "closed"].includes(state) && this._realtimeCurrent(recording) && !realtime.providerClosed) {
            this._fallbackRealtime(recording);
          }
        };
        // The provider's translated remote audio is intentionally NOT attached
        // to any HTMLAudio element or Call V1 sender in V1.1. Text deltas only.
        pc.addTrack(clonedTrack, new root.MediaStream([clonedTrack]));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!this._realtimeCurrent(recording)) return;

        const providerController = typeof root.AbortController === "function" ? new root.AbortController() : null;
        realtime.providerAbortController = providerController;
        if (providerController) this._owned.abortControllers.add(providerController);
        let sdpResponse;
        try {
          sdpResponse = await this.providerFetcher(
            "https://api.openai.com/v1/realtime/translations/calls",
            {
              method: "POST",
              mode: "cors",
              credentials: "omit",
              cache: "no-store",
              headers: {
                Authorization: `Bearer ${clientSecret}`,
                "Content-Type": "application/sdp",
                Accept: "application/sdp",
              },
              body: String(offer?.sdp || ""),
              signal: providerController?.signal,
            },
          );
        } finally {
          if (providerController) this._owned.abortControllers.delete(providerController);
          realtime.providerAbortController = null;
        }
        if (!sdpResponse?.ok) throw new Error("call-translation.realtime-sdp-failed");
        const answerSdp = await sdpResponse.text();
        if (!answerSdp || !this._realtimeCurrent(recording)) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        realtime.providerSessionId = String(session?.session_id || "");
        realtime.providerReady = true;
        if (realtime.state === "STARTING") realtime.state = "STREAMING";
        const maxDurationMs = Number(session?.max_duration_ms || 0);
        if (Number.isFinite(maxDurationMs) && maxDurationMs > 0) {
          realtime.maxDurationMs = Math.floor(maxDurationMs);
          const elapsed = Math.max(0, Date.now() - recording.startedAt);
          const remaining = Math.max(100, realtime.maxDurationMs - elapsed - 250);
          realtime.maxDurationTimer = this._ownedTimeout(() => {
            if (this._recording === recording) this.stopRecording();
          }, remaining);
        }
        if (recording.stopRequested) this._requestRealtimeClose(recording);
      } catch (error) {
        if (error?.name !== "AbortError" && this._realtimeCurrent(recording)) this._fallbackRealtime(recording);
      }
    }

    _requestRealtimeClose(recording) {
      const realtime = recording?.realtime;
      if (!realtime || !this._realtimeCurrent(recording)) return;
      realtime.stopRequested = true;
      this._clearOwnedTimeout(realtime.maxDurationTimer);
      realtime.maxDurationTimer = null;
      const channel = realtime.dataChannel;
      if (channel?.readyState !== "open") {
        if (realtime.state !== "FALLBACK") realtime.state = "CLOSING";
      } else if (!realtime.closeSent) {
        realtime.closeSent = true;
        realtime.state = "CLOSING";
        try {
          channel.send(JSON.stringify({ type: "session.close" }));
        } catch (_error) {
          this._fallbackRealtime(recording);
          return;
        }
      }
      if (!realtime.drainTimer) {
        realtime.drainTimer = this._ownedTimeout(() => {
          if (!this._realtimeCurrent(recording) || realtime.providerClosed) return;
          this._fallbackRealtime(recording);
        }, 3500);
      }
    }

    _completeVoiceRecording(recording) {
      if (!recording?.blob || recording.completionStarted) return;
      if (!this._activeGeneration(recording.callId, recording.generation, recording.segmentId)) return;
      const realtime = recording.realtime;
      if (!realtime) {
        recording.completionStarted = true;
        void this._translateRecordedAudio(recording.blob, recording);
        return;
      }
      if (["STARTING", "STREAMING", "CLOSING"].includes(realtime.state)) return;
      if (realtime.state === "FALLBACK") {
        recording.completionStarted = true;
        this._cleanupRealtimeContext(realtime);
        void this._translateRecordedAudio(recording.blob, recording);
        return;
      }
      if (realtime.state !== "FINALIZING") return;
      recording.completionStarted = true;
      void this._finalizeRealtimeFastPath(recording, 0);
    }

    _finalizeRetryable(error) {
      const status = Number(error?.status || 0);
      return !status || [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
    }

    async _finalizeRealtimeFastPath(recording, attempt) {
      if (!this._realtimeCurrent(recording)) return;
      const realtime = recording.realtime;
      realtime.finalizeAttempt = attempt + 1;
      realtime.state = attempt > 0 ? "RETRY_FINALIZE" : "FINALIZING";
      this._setBusy(true);
      this._setStatus(this._copy("copyTranslationRealtimeFinalizing", "Finalizing the live translation…"));
      const measuredDuration = Math.max(1, Math.round((recording.stoppedAt || Date.now()) - recording.startedAt));
      const durationMs = realtime.maxDurationMs > 0
        ? Math.min(measuredDuration, realtime.maxDurationMs)
        : measuredDuration;
      const body = {
        request_id: recording.requestId,
        segment_id: recording.segmentId,
        source_language: realtime.sourceLanguage,
        target_language: realtime.targetLanguage,
        transcript: realtime.transcript.trim(),
        translation: realtime.translation.trim(),
        duration_ms: durationMs,
      };
      try {
        const result = await this._request(
          `/api/messaging/calls/${encodeURIComponent(recording.callId)}/translation/realtime/finalize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          recording.generation,
        );
        if (!this._realtimeCurrent(recording)) return;
        if (result?.sync_delivered === false && attempt < 2) {
          realtime.state = "RETRY_FINALIZE";
          this._ownedTimeout(() => {
            if (this._realtimeCurrent(recording)) void this._finalizeRealtimeFastPath(recording, attempt + 1);
          }, 250 * (attempt + 1));
          return;
        }
        realtime.state = "COMPLETED";
        this._seenRequestIds.add(recording.requestId);
        this._showResult({
          original: result.transcript || realtime.transcript,
          transcript: result.transcript || realtime.transcript,
          translation: result.translation || realtime.translation,
          sourceLanguage: realtime.sourceLanguage,
          targetLanguage: realtime.targetLanguage,
          requestId: recording.requestId,
          segmentId: recording.segmentId,
          historyId: result.history?.id || result.history_id || 0,
        });
        this._setStatus("");
        this._setBusy(false);
        this._cleanupRealtimeContext(realtime, { abortProvider: false });
        recording.blob = null;
        if (this.ui.autoRead?.checked) void this._sendAutoRead();
        void this.loadQuota();
      } catch (error) {
        if (!this._realtimeCurrent(recording)) return;
        if (this._finalizeRetryable(error) && attempt < 2) {
          realtime.state = "RETRY_FINALIZE";
          this._ownedTimeout(() => {
            if (this._realtimeCurrent(recording)) void this._finalizeRealtimeFastPath(recording, attempt + 1);
          }, 250 * (attempt + 1));
          return;
        }
        // A finalize request may have committed even if the browser did not
        // receive the response. Never switch to slow fallback after finalize
        // has started; retries always reuse the exact same request_id.
        realtime.state = "RETRY_FINALIZE";
        this._setBusy(false);
        if (error?.name !== "AbortError") {
          this._setStatus(this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
        }
      }
    }

    _recordingMimeType() {
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      for (const candidate of candidates) {
        try {
          if (!this.mediaRecorderFactory.isTypeSupported || this.mediaRecorderFactory.isTypeSupported(candidate)) return candidate;
        } catch (_error) {
          // A browser may throw for an unknown MIME string; try the next format.
        }
      }
      return "";
    }

    _recordingFilename(mimeType = "") {
      const normalized = String(mimeType || "").toLowerCase().split(";", 1)[0];
      const extension = normalized === "audio/mp4"
        ? "mp4"
        : (normalized === "audio/ogg" ? "ogg" : "webm");
      return `call-translation.${extension}`;
    }

    _validateLanguages(payload) {
      payload.source_language = language(payload.source_language, "vi");
      payload.target_language = language(payload.target_language, "zh-TW");
      if (payload.source_language === payload.target_language) {
        this._setStatus(this._copy("copyTranslationSameLanguage", "Choose two different languages."), true);
        return false;
      }
      return true;
    }

    async translateText() {
      if (!this.isConnected()) return;
      const text = String(this.ui?.text?.value || "").trim();
      if (!text) {
        this._setStatus(this._copy("copyTranslationTextRequired", "Enter text first."), true);
        return;
      }
      const callId = this.callId;
      const generation = this.pluginGeneration;
      const payload = this._callPayload({ text });
      if (!this._validateLanguages(payload)) return;
      this._setBusy(true);
      try {
        const result = await this._request(`/api/messaging/calls/${encodeURIComponent(callId)}/translation/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, generation);
        if (!this._activeGeneration(callId, generation, payload.segment_id)) return;
        this._seenRequestIds.add(payload.request_id);
        this._showResult({
          original: text,
          transcript: result.transcript || "",
          translation: result.translation || "",
          sourceLanguage: payload.source_language,
          targetLanguage: payload.target_language,
          requestId: payload.request_id,
          segmentId: payload.segment_id,
          historyId: result.history?.id || result.history_id || 0,
        });
        this._setStatus("");
        if (this.ui.text) this.ui.text.value = "";
        if (this.ui.autoRead?.checked) void this._sendAutoRead();
        void this.loadQuota();
      } catch (error) {
        if (error?.name !== "AbortError" && this._activeGeneration(callId, generation)) {
          this._setStatus(error?.status === 409 ? this._copy("copyTranslationProcessing", "A translation is already processing.") : this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
        }
      } finally {
        if (this._activeGeneration(callId, generation)) this._setBusy(false);
      }
    }

    startRecording() {
      if (!this.isConnected() || this._recording) return;
      const track = this.runtime?.session?.localStream?.getAudioTracks?.()[0];
      if (!track || track.readyState === "ended" || track.enabled === false) {
        this._setStatus(this._copy("copyTranslationMicrophoneDenied", "The call microphone cannot be used for recording."), true);
        return;
      }
      if (typeof this.mediaRecorderFactory !== "function" || typeof root.MediaStream !== "function") {
        this._setStatus(this._copy("copyTranslationRecordingUnsupported", "This browser cannot record call audio."), true);
        return;
      }
      const callId = this.callId;
      const generation = this.pluginGeneration;
      const segmentId = this._newSegment();
      const requestId = randomId("request");
      const chunks = [];
      let inputStream;
      let recorder = null;
      try {
        // Mandatory shadow recorder: canonical Call V1 track is only wrapped in
        // a disposable MediaStream. No new media request and no canonical stop.
        inputStream = new root.MediaStream([track]);
        const mimeType = this._recordingMimeType();
        recorder = mimeType ? new this.mediaRecorderFactory(inputStream, { mimeType }) : new this.mediaRecorderFactory(inputStream);
        const sourceLanguage = language(String(this.ui?.source?.value || "vi"), "vi");
        const targetLanguage = language(String(this.ui?.target?.value || "zh-TW"), "zh-TW");
        const recording = {
          recorder,
          callId,
          generation,
          segmentId,
          requestId,
          chunks,
          startedAt: Date.now(),
          stoppedAt: 0,
          stopRequested: false,
          blob: null,
          completionStarted: false,
          sourceLanguage,
          targetLanguage,
          realtime: null,
        };
        if (this._realtimeEnabled() && sourceLanguage !== targetLanguage) {
          recording.realtime = this._newRealtimeContext(recording, sourceLanguage, targetLanguage);
        }
        this._recording = recording;
        this._owned.recorders.add(recorder);
        recorder.ondataavailable = (event) => {
          if (!this._activeGeneration(callId, generation, segmentId)) return;
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = () => {
          if (this._recording?.recorder === recorder) this._recording = null;
          this._owned.recorders.delete(recorder);
          if (recording.realtime) this._cleanupRealtimeContext(recording.realtime);
          if (this._activeGeneration(callId, generation, segmentId)) {
            this._setRecordState(false);
            this._setBusy(false);
            this._setStatus(this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
          }
        };
        recorder.onstop = () => {
          if (this._recording?.recorder === recorder) {
            this._recording = null;
            this._setRecordState(false);
          }
          this._owned.recorders.delete(recorder);
          if (!this._activeGeneration(callId, generation, segmentId)) return;
          if (!chunks.length) {
            if (recording.realtime) this._cleanupRealtimeContext(recording.realtime);
            this._setBusy(false);
            this._setStatus(
              this._copy("copyTranslationRecordingEmpty", "No voice segment was captured. Speak longer, then tap stop."),
              true,
            );
            return;
          }
          recording.blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          this._completeVoiceRecording(recording);
        };
        recorder.start(250);
        this._setRecordState(true);
        if (recording.realtime) void this._startRealtimeFastPath(recording, track);
      } catch (error) {
        this._recording = null;
        if (recorder) this._owned.recorders.delete(recorder);
        this._setStatus(error?.message || this._copy("copyTranslationRecordingUnsupported", "This browser cannot record call audio."), true);
      }
    }

    stopRecording() {
      const recording = this._recording;
      if (!recording) return;
      recording.stopRequested = true;
      recording.stoppedAt = Date.now();
      this._recording = null;
      this._setRecordState(false);
      if (recording.realtime) this._requestRealtimeClose(recording);
      try { recording.recorder.stop(); } catch (_error) { /* terminal cleanup is best effort */ }
    }

    async _translateRecordedAudio(blob, context) {
      const { callId, generation, segmentId, requestId } = context;
      if (!this._activeGeneration(callId, generation, segmentId)) return;
      const payload = this._callPayload({ requestId, segmentId });
      if (context.sourceLanguage) payload.source_language = context.sourceLanguage;
      if (context.targetLanguage) payload.target_language = context.targetLanguage;
      if (!this._validateLanguages(payload)) return;
      const form = new FormData();
      form.append("file", blob, this._recordingFilename(blob.type));
      form.append("request_id", payload.request_id);
      form.append("segment_id", payload.segment_id);
      form.append("source_language", payload.source_language);
      form.append("target_language", payload.target_language);
      this._setBusy(true);
      try {
        const result = await this._request(`/api/messaging/calls/${encodeURIComponent(callId)}/translation/audio`, {
          method: "POST",
          body: form,
        }, generation);
        if (!this._activeGeneration(callId, generation, segmentId)) return;
        this._seenRequestIds.add(requestId);
        this._showResult({
          original: result.transcript || "",
          transcript: result.transcript || "",
          translation: result.translation || "",
          sourceLanguage: payload.source_language,
          targetLanguage: payload.target_language,
          requestId,
          segmentId,
          historyId: result.history?.id || result.history_id || 0,
        });
        this._setStatus("");
        if (this.ui.autoRead?.checked) void this._sendAutoRead();
        void this.loadQuota();
      } catch (error) {
        if (error?.name !== "AbortError" && this._activeGeneration(callId, generation)) this._setStatus(this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
      } finally {
        if (this._activeGeneration(callId, generation)) this._setBusy(false);
      }
    }

    _setRecordState(recording) {
      if (!this.ui?.record) return;
      this.ui.record.setAttribute("aria-pressed", String(Boolean(recording)));
      this.ui.record.textContent = recording
        ? this._copy("copyTranslationStopRecording", "Stop recording")
        : this._copy("copyTranslationStartRecording", "Record voice");
      if (this.ui.recordStatus) this.ui.recordStatus.textContent = recording
        ? this._copy("copyTranslationRecording", "Recording…")
        : this._copy("copyTranslationReady", "Ready");
    }

    _setBusy(busy) {
      if (this.ui?.submit) this.ui.submit.disabled = Boolean(busy);
      if (this.ui?.record) this.ui.record.disabled = Boolean(busy) && !this._recording;
      if (this.ui?.status && busy) this._setStatus(this._copy("copyTranslationProcessing", "Transcribing and translating…"));
    }

    _setSyncStatus(connected) {
      this.syncConnected = Boolean(connected);
      if (!this.ui?.syncStatus) return;
      this.ui.syncStatus.textContent = this._copy(
        connected ? "copyTranslationSyncConnected" : "copyTranslationSyncing",
        connected ? "Two-way translation: Connected" : "Connecting translation sync…",
      );
      this.ui.syncStatus.dataset.state = connected ? "connected" : "syncing";
    }

    _isMuted() {
      return this.runtime?.session?.localStream?.getAudioTracks?.()[0]?.enabled === false;
    }

    _beginAutoReadChange(event = {}) {
      const task = this._handleAutoReadChange(event);
      this._autoReadPreparation = task;
      void task.finally(() => {
        if (this._autoReadPreparation === task) this._autoReadPreparation = null;
      });
    }

    _abortAutoReadWork() {
      for (const controller of this._owned.autoReadAbortControllers) {
        try { controller.abort(); } catch (_error) { /* best effort */ }
      }
      this._owned.autoReadAbortControllers.clear();
      this._stopOutboundTts({ automaticOnly: true });
    }

    async _handleAutoReadChange(event = {}) {
      const control = event.currentTarget || event.target || this.ui?.autoRead;
      if (!control) return false;
      if (!control.checked) {
        this._autoReadReady = null;
        this._abortAutoReadWork();
        this._stopOutboundTts();
        const restored = await this._releaseMixer({ restore: true });
        if (!restored && this.isConnected()) {
          this._setStatus(this._copy("copyTranslationTrackRestoreFailed", "The call audio could not be restored; keep the panel open and try again."), true);
        }
        return restored;
      }
      if (!this.isConnected() || this._isMuted()) {
        control.checked = false;
        this._autoReadReady = null;
        this._reportSpeechFailure(this._isMuted() ? "muted" : "stale-generation");
        this._setStatus(
          this._isMuted()
            ? this._copy("copyTranslationMuted", "Your microphone is muted; call voice output is blocked.")
            : this._copy("copyTranslationSpeechFailed", "Speech playback failed."),
          true,
        );
        return false;
      }
      const track = this.runtime?.session?.localStream?.getAudioTracks?.()[0];
      const callId = this.callId;
      const generation = this.pluginGeneration;
      if (!track || track.readyState === "ended") {
        control.checked = false;
        this._autoReadReady = null;
        this._reportSpeechFailure("muted");
        this._setStatus(this._copy("copyTranslationMuted", "Your microphone is muted; call voice output is blocked."), true);
        return false;
      }
      control.disabled = true;
      control.setAttribute?.("aria-disabled", "true");
      try {
        await this._installMixer(track, generation);
        if (!control.checked || !this._activeGeneration(callId, generation)) {
          throw this._stageError("stale-generation", new DOMException("Stale call generation", "AbortError"));
        }
        this._autoReadReady = { callId, generation };
        this._setStatus("");
        return true;
      } catch (error) {
        this._autoReadReady = null;
        control.checked = false;
        if (error?.name !== "AbortError") {
          this._reportSpeechFailure(error?.callTranslationStage, error);
          this._setStatus(this._copy("copyTranslationSpeechFailed", "Speech playback failed."), true);
        }
        return false;
      } finally {
        if (this._activeGeneration(callId, generation) && !this._isMuted()) {
          control.disabled = false;
          control.removeAttribute?.("aria-disabled");
        }
      }
    }

    async _sendAutoRead() {
      const preparation = this._autoReadPreparation;
      if (preparation) await preparation.catch(() => false);
      const ready = this._autoReadReady;
      if (!this.ui?.autoRead?.checked || !ready) return;
      if (ready.callId !== this.callId || ready.generation !== this.pluginGeneration || !this.isConnected()) {
        this._reportSpeechFailure("stale-generation");
        return;
      }
      // A later segment owns automatic speech. Abort/stop an older automatic
      // segment so repeated translations cannot overlap or replay out of order.
      this._abortAutoReadWork();
      await this.sendToOpponent({ automatic: true });
    }

    swapLanguages() {
      if (!this.ui?.source || !this.ui?.target) return;
      const source = this.ui.source.value;
      this.ui.source.value = this.ui.target.value;
      this.ui.target.value = source;
      this._savePreference();
      void this._publishPreference();
    }

    syncMuteState() {
      const muted = this._isMuted();
      if (this.ui?.send) this.ui.send.disabled = !this.lastResult?.translation || muted;
      if (this.ui?.autoRead) {
        if (muted) {
          if (this.mutedAutoReadSnapshot === null) this.mutedAutoReadSnapshot = Boolean(this.ui.autoRead.checked);
          this.ui.autoRead.checked = false;
          this.ui.autoRead.disabled = true;
          this.ui.autoRead.setAttribute("aria-disabled", "true");
          this._autoReadReady = null;
          this._abortAutoReadWork();
          for (const controller of this._owned.ttsAbortControllers) {
            try { controller.abort(); } catch (_error) { /* best effort */ }
          }
        } else {
          const restoreAutoRead = this.mutedAutoReadSnapshot === true;
          if (this.mutedAutoReadSnapshot !== null) this.ui.autoRead.checked = this.mutedAutoReadSnapshot;
          this.mutedAutoReadSnapshot = null;
          this.ui.autoRead.disabled = false;
          this.ui.autoRead.removeAttribute("aria-disabled");
          if (restoreAutoRead) this._beginAutoReadChange({ currentTarget: this.ui.autoRead });
        }
      }
      if (muted) {
        this._stopOutboundTts();
        void this._releaseMixer({ restore: true });
      }
      if (muted && this.ui?.status && this.lastResult?.translation) this._setStatus(this._copy("copyTranslationMuted", "Your microphone is muted; call voice output is blocked."), true);
    }

    _resetQuota() {
      for (const meter of [this.ui?.quotaText, this.ui?.quotaAudio, this.ui?.quotaSpeech]) {
        if (!meter) continue;
        meter.textContent = "—";
        meter.setAttribute("aria-valuenow", "0");
        meter.style.setProperty("--call-translation-quota-progress", "0%");
      }
    }

    _renderQuota(quota = {}) {
      const meters = {
        text: this.ui?.quotaText,
        audio: this.ui?.quotaAudio,
        speech: this.ui?.quotaSpeech,
      };
      for (const [operation, element] of Object.entries(meters)) {
        if (!element) continue;
        const meter = quota[operation] || {};
        const remaining = Number(meter.remaining);
        const limit = Number(meter.limit);
        const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
        const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 0;
        const progress = safeLimit > 0 ? Math.min(100, (safeRemaining / safeLimit) * 100) : 0;
        element.textContent = `${safeRemaining}/${safeLimit} ${meter.unit || ""}`.trim();
        element.setAttribute("aria-valuenow", String(Math.round(progress)));
        element.setAttribute("aria-valuetext", `${safeRemaining} / ${safeLimit}`);
        element.style.setProperty("--call-translation-quota-progress", `${progress}%`);
      }
    }

    async loadQuota() {
      if (!this.isConnected()) return;
      const callId = this.callId;
      const generation = this.pluginGeneration;
      try {
        const result = await this._request(`/api/messaging/calls/${encodeURIComponent(callId)}/translation/quota`, {}, generation);
        if (this._activeGeneration(callId, generation)) this._renderQuota(result.quota || {});
      } catch (error) {
        if (error?.name !== "AbortError" && this._activeGeneration(callId, generation)) this._resetQuota();
      }
    }

    _showResult(result) {
      this.lastResult = result;
      if (this.ui?.empty) this.ui.empty.hidden = true;
      if (this.ui?.values) this.ui.values.hidden = false;
      if (this.ui?.direction) this.ui.direction.textContent = `${result.sourceLanguage} → ${result.targetLanguage}`;
      if (this.ui?.original) this.ui.original.textContent = result.original || result.transcript || "-";
      if (this.ui?.output) this.ui.output.textContent = result.translation || "-";
      if (this.ui?.listen) this.ui.listen.disabled = !result.translation;
      this.syncMuteState();
      if (result.historyId) this._prependHistory(result);
      const desktopOrTablet = this.document?.defaultView?.matchMedia?.("(min-width: 768px)")?.matches;
      if (desktopOrTablet) this.ui.result?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }

    _resetResult() {
      if (this.ui?.empty) this.ui.empty.hidden = false;
      if (this.ui?.values) this.ui.values.hidden = true;
      if (this.ui?.listen) this.ui.listen.disabled = true;
      if (this.ui?.send) this.ui.send.disabled = true;
      if (this.ui?.original) this.ui.original.textContent = "-";
      if (this.ui?.output) this.ui.output.textContent = "-";
    }

    async _speech(text, targetLanguage, sourceLanguage = "", segmentId = this._newSegment(), { remote = false, automatic = false } = {}) {
      const requestId = randomId("request");
      const callId = this.callId;
      const generation = this.pluginGeneration;
      const controllerSets = remote
        ? [
          this._owned.ttsAbortControllers,
          ...(automatic ? [this._owned.autoReadAbortControllers] : []),
        ]
        : [];
      const response = await this._request(`/api/messaging/calls/${encodeURIComponent(callId)}/translation/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          segment_id: segmentId,
          source_language: language(sourceLanguage, targetLanguage === "en" ? "vi" : "en"),
          target_language: targetLanguage,
          text,
        }),
        rawResponse: true,
        controllerSets,
      }, generation);
      return { response, requestId, segmentId, callId, generation };
    }

    _audioElement(url, { outbound = false } = {}) {
      const audio = typeof root.Audio === "function" ? new root.Audio() : this.document?.createElement?.("audio");
      if (!audio) throw new Error("call-translation.audio-unavailable");
      audio.src = url;
      audio.preload = "auto";
      audio.__timeblockCallTranslationUrl = url;
      this._owned.ttsSources.add(audio);
      if (outbound) this._owned.outboundTtsSources.add(audio);
      return audio;
    }

    _stopOutboundTts({ automaticOnly = false } = {}) {
      const sources = automaticOnly ? this._owned.autoReadTtsSources : this._owned.outboundTtsSources;
      for (const source of [...sources]) {
        if (typeof source.pause === "function") {
          this._releaseAudio(source, source.__timeblockCallTranslationUrl || "");
          continue;
        }
        try { source.stop?.(); } catch (_error) { /* source may already be stopped */ }
        try { source.disconnect?.(); } catch (_error) { /* best effort */ }
        try { source.onended = null; } catch (_error) { /* best effort */ }
        this._owned.ttsSources.delete(source);
        this._owned.outboundTtsSources.delete(source);
        this._owned.autoReadTtsSources.delete(source);
      }
    }

    async listenLocally() {
      if (!this.isConnected() || !this.lastResult?.translation) return;
      let audio = null;
      let url = "";
      let stage = "speech-http-api";
      try {
        const speech = await this._speech(this.lastResult.translation, this.lastResult.targetLanguage, this.lastResult.sourceLanguage);
        if (!this._activeGeneration(speech.callId, speech.generation)) {
          stage = "stale-generation";
          return;
        }
        const blob = await speech.response.blob();
        stage = "audio-playback-autoplay";
        url = root.URL?.createObjectURL?.(blob);
        if (!url) throw new Error("call-translation.url-unavailable");
        this._owned.objectUrls.add(url);
        audio = this._audioElement(url);
        audio.onended = () => this._releaseAudio(audio, url);
        await audio.play();
      } catch (error) {
        if (audio || url) this._releaseAudio(audio, url);
        if (error?.name !== "AbortError" && this.isConnected()) {
          this._reportSpeechFailure(stage, error);
          this._setStatus(this._copy("copyTranslationSpeechFailed", "Speech playback failed."), true);
        }
      }
    }

    async sendToOpponent({ automatic = false } = {}) {
      if (!this.isConnected() || !this.lastResult?.translation) return;
      const track = this.runtime?.session?.localStream?.getAudioTracks?.()[0];
      if (!track || track.enabled === false) {
        this._reportSpeechFailure("muted");
        this._setStatus(this._copy("copyTranslationMuted", "Your microphone is muted; call voice output is blocked."), true);
        return;
      }
      let source = null;
      let stage = "audio-context-unavailable";
      try {
        // Manual sends enter here from a real click. Auto Read can enter only
        // after the checkbox gesture has already unlocked this exact mixer.
        const mixer = await this._prepareOutboundMixer(track, this.pluginGeneration, { automatic });
        stage = "speech-http-api";
        const speech = await this._speech(
          this.lastResult.translation,
          this.lastResult.targetLanguage,
          this.lastResult.sourceLanguage,
          this._newSegment(),
          { remote: true, automatic },
        );
        if (!this._activeGeneration(speech.callId, speech.generation)) {
          stage = "stale-generation";
          return;
        }
        const encodedAudio = await speech.response.arrayBuffer();
        if (this._isMuted()) {
          stage = "muted";
          return;
        }
        stage = "decode-audio-data";
        const audioBuffer = await this._decodeSpeechAudio(mixer.audioContext, encodedAudio);
        if (!this._activeGeneration(speech.callId, speech.generation)) {
          stage = "stale-generation";
          return;
        }
        if (this._isMuted()) {
          stage = "muted";
          return;
        }
        stage = "audio-playback-autoplay";
        source = mixer.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(mixer.destination);
        this._owned.ttsSources.add(source);
        this._owned.outboundTtsSources.add(source);
        if (automatic) this._owned.autoReadTtsSources.add(source);
        source.onended = () => {
          try { source.disconnect?.(); } catch (_error) { /* best effort */ }
          this._owned.ttsSources.delete(source);
          this._owned.outboundTtsSources.delete(source);
          this._owned.autoReadTtsSources.delete(source);
          source.onended = null;
        };
        source.start(0);
      } catch (error) {
        if (source) {
          try { source.stop?.(); } catch (_sourceError) { /* best effort */ }
          try { source.disconnect?.(); } catch (_sourceError) { /* best effort */ }
          this._owned.ttsSources.delete(source);
          this._owned.outboundTtsSources.delete(source);
          this._owned.autoReadTtsSources.delete(source);
        }
        if (error?.name !== "AbortError" && this.isConnected()) {
          this._reportSpeechFailure(error?.callTranslationStage || stage, error);
          this._setStatus(this._copy("copyTranslationSpeechFailed", "Speech playback failed."), true);
        }
      }
    }

    async _prepareOutboundMixer(originalTrack, generation, { automatic = false } = {}) {
      if (automatic) {
        const ready = this._autoReadReady;
        const mixer = this._mixer;
        if (!ready
          || ready.callId !== this.callId
          || ready.generation !== generation
          || !mixer?.ready
          || mixer.generation !== generation) {
          throw this._stageError("audio-context-unavailable", new Error("call-translation.auto-read-not-prepared"));
        }
        const contextState = String(mixer.audioContext?.state || "");
        if (contextState === "closed") {
          throw this._stageError("audio-context-unavailable", new Error("call-translation.audio-context-closed"));
        }
        if (contextState === "suspended" || contextState === "interrupted") {
          try { await mixer.audioContext.resume(); }
          catch (error) { throw this._stageError("audio-context-resume-unlock", error); }
        }
        return mixer;
      }
      return this._installMixer(originalTrack, generation);
    }

    async _decodeSpeechAudio(audioContext, arrayBuffer) {
      if (!audioContext?.decodeAudioData || !(arrayBuffer instanceof ArrayBuffer)) {
        throw this._stageError("decode-audio-data", new Error("call-translation.audio-decode-unavailable"));
      }
      try {
        return await new Promise((resolve, reject) => {
          let settled = false;
          const succeed = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          const result = audioContext.decodeAudioData(arrayBuffer.slice(0), succeed, fail);
          if (result?.then) result.then(succeed, fail);
        });
      } catch (error) {
        throw this._stageError("decode-audio-data", error);
      }
    }

    async _installMixer(originalTrack, generation) {
      if (this._mixer?.ready && this._mixer.generation === generation) return this._mixer;
      if (this._mixerPromise) return this._mixerPromise;
      if (typeof this.audioContextFactory !== "function" || typeof root.MediaStream !== "function") {
        throw this._stageError("audio-context-unavailable", new Error("call-translation.audio-mixer-unavailable"));
      }
      const install = (async () => {
        let audioContext = null;
        let mixedTrack = null;
        let mixer = null;
        let input = null;
        try {
          try { audioContext = new this.audioContextFactory(); }
          catch (error) { throw this._stageError("audio-context-unavailable", error); }
          const inputStream = new root.MediaStream([originalTrack]);
          let destination;
          try {
            input = audioContext.createMediaStreamSource(inputStream);
            destination = audioContext.createMediaStreamDestination();
            input.connect(destination);
            mixedTrack = destination.stream?.getAudioTracks?.()[0];
            if (!mixedTrack) throw new Error("call-translation.mixed-track-unavailable");
          } catch (error) {
            throw this._stageError("media-stream-destination", error);
          }
          mixer = {
            audioContext,
            input,
            destination,
            mixedTrack,
            originalTrack,
            generation,
            ready: false,
            disposed: false,
          };
          this._owned.audioContexts.add(audioContext);
          this._owned.mixedTracks.add(mixedTrack);
          this._mixer = mixer;
          const contextState = String(audioContext.state || "");
          if (contextState === "closed") {
            throw this._stageError("audio-context-unavailable", new Error("call-translation.audio-context-closed"));
          }
          if (contextState === "suspended" || contextState === "interrupted") {
            try { await audioContext.resume(); }
            catch (error) { throw this._stageError("audio-context-resume-unlock", error); }
          }
          if (!this._activeGeneration(this.callId, generation)) {
            throw this._stageError("stale-generation", new DOMException("Stale call generation", "AbortError"));
          }
          try { await this.runtime.peer.replaceLocalAudioTrack(mixedTrack, this.callGeneration); }
          catch (error) { throw this._stageError("replace-track", error); }
          mixer.ready = true;
          return mixer;
        } catch (error) {
          if (this._mixer === mixer) this._mixer = null;
          if (mixer) {
            mixer.disposed = true;
            mixer.ready = false;
          }
          try { input?.disconnect?.(); } catch (_disconnectError) { /* best effort */ }
          if (mixedTrack) {
            try { mixedTrack.stop?.(); } catch (_trackError) { /* best effort */ }
            this._owned.mixedTracks.delete(mixedTrack);
          }
          if (audioContext) {
            this._owned.audioContexts.delete(audioContext);
            try { await audioContext.close?.(); } catch (_closeError) { /* best effort */ }
          }
          throw error;
        }
      })();
      this._mixerPromise = install;
      try { return await install; }
      finally {
        if (this._mixerPromise === install) this._mixerPromise = null;
      }
    }

    _disposeMixer(mixer) {
      if (!mixer || mixer.disposed) return;
      mixer.disposed = true;
      mixer.ready = false;
      try { mixer.input?.disconnect?.(); } catch (_error) { /* best effort */ }
      try { mixer.mixedTrack?.stop?.(); } catch (_error) { /* plugin-owned track only */ }
      this._owned.mixedTracks.delete(mixer.mixedTrack);
      this._owned.audioContexts.delete(mixer.audioContext);
      try {
        const closing = mixer.audioContext?.close?.();
        closing?.catch?.(() => {});
      } catch (_error) { /* best effort */ }
      if (this._mixer === mixer) this._mixer = null;
    }

    async _releaseMixer({ restore = true } = {}) {
      let mixer = this._mixer;
      if (!mixer && this._mixerPromise) {
        try { mixer = await this._mixerPromise; }
        catch (_error) { return true; }
      }
      if (!mixer) return true;
      if (restore) {
        const restored = await this._restoreOriginalAudioTrack(mixer);
        if (!restored) return false;
      }
      this._disposeMixer(mixer);
      return true;
    }

    async _restoreOriginalAudioTrack(mixer = this._mixer) {
      if (!mixer) return true;
      if (mixer.disposed) return true;
      if (!this.runtime?.peer || !this.runtime?.session?.isCurrent?.(this.callGeneration)) return false;
      try {
        await this.runtime.peer.restoreLocalAudioTrack(mixer.originalTrack, this.callGeneration);
        return true;
      } catch (_error) {
        return false;
      }
    }

    _releaseAudio(audio, url) {
      try { audio.pause?.(); } catch (_error) { /* best effort */ }
      audio.src = "";
      this._owned.ttsSources.delete(audio);
      this._owned.outboundTtsSources.delete(audio);
      this._owned.autoReadTtsSources.delete(audio);
      if (url) {
        try { root.URL?.revokeObjectURL?.(url); } catch (_error) { /* best effort */ }
        this._owned.objectUrls.delete(url);
      }
    }

    _savePreference() {
      try {
        root.localStorage?.setItem("timeblock.call-translation.preference", JSON.stringify({
          source: this.ui?.source?.value || "vi",
          target: this.ui?.target?.value || "zh-TW",
        }));
      } catch (_error) { /* storage is optional */ }
    }

    restorePreference() {
      try {
        const saved = JSON.parse(root.localStorage?.getItem("timeblock.call-translation.preference") || "null");
        if (saved?.source && this.ui?.source) this.ui.source.value = language(saved.source, "vi");
        if (saved?.target && this.ui?.target) this.ui.target.value = language(saved.target, "zh-TW");
      } catch (_error) { /* storage is optional */ }
    }

    async _publishPreference() {
      if (!this.isConnected() || !this._validateLanguages({ source_language: this.ui.source.value, target_language: this.ui.target.value })) return;
      const generation = this.pluginGeneration;
      const version = ++this.preferenceVersion;
      try {
        const result = await this._request(`/api/messaging/calls/${encodeURIComponent(this.callId)}/translation/preferences`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_id: randomId("preference"),
            segment_id: this._newSegment(),
            source_language: this.ui.source.value,
            target_language: this.ui.target.value,
            version,
          }),
        }, generation);
        if (this._activeGeneration(this.callId, generation)) {
          this._setSyncStatus(result.sync_delivered !== false);
          this._setStatus("");
        }
      } catch (error) {
        if (error?.name !== "AbortError" && this._activeGeneration(this.callId, generation)) this._setStatus(this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
      }
    }

    _prependHistory(item) {
      if (!this.ui?.historyList || !item) return;
      const li = this.document.createElement("li");
      const strong = this.document.createElement("strong");
      const source = this.document.createElement("span");
      const translation = this.document.createElement("span");
      strong.textContent = item.targetLanguage ? `${item.sourceLanguage} → ${item.targetLanguage}` : "Translation";
      source.textContent = item.original || item.transcript || "";
      translation.textContent = item.translation || "";
      li.append(strong, source, translation);
      this.ui.historyList.prepend(li);
    }

    async loadHistory(reset = false) {
      if (!this.isConnected()) return;
      if (reset) {
        this.historyBeforeId = null;
        this.historyCallId = this.callId;
        if (this.ui.historyList) this.ui.historyList.replaceChildren();
      }
      const callId = this.callId;
      const generation = this.pluginGeneration;
      const params = new URLSearchParams({ limit: "5" });
      if (this.historyBeforeId) params.set("before_id", String(this.historyBeforeId));
      try {
        const result = await this._request(`/api/messaging/calls/${encodeURIComponent(callId)}/translation/history?${params}`, {}, generation);
        if (!this._activeGeneration(callId, generation)) return;
        (result.items || []).forEach((item) => this._prependHistory({
          original: item.source || item.transcript,
          transcript: item.transcript,
          translation: item.translation,
          sourceLanguage: item.source_language,
          targetLanguage: item.target_language,
        }));
        this.historyBeforeId = result.next_before_id || null;
        if (this.ui.historyMore) this.ui.historyMore.hidden = !result.has_more;
      } catch (error) {
        if (error?.name !== "AbortError" && this._activeGeneration(callId, generation)) this._setStatus(this._copy("copyTranslationFailed", "Translation failed. Try again."), true);
      }
    }

    handleRealtimeEvent(detail = {}) {
      const envelope = detail.event || detail;
      const eventType = String(detail.eventType || envelope.event_type || "");
      if (eventType === "translation.preference") {
        const payload = envelope.payload || {};
        const version = Number(payload.version || 0);
        const source = language(payload.source_language, "");
        const target = language(payload.target_language, "");
        if (String(payload.call_id || "") === this.callId
          && this._isPeerActor(envelope.actor)
          && source && target && source !== target
          && version > this.peerPreferenceVersion) {
          this.peerPreference = { ...payload, source_language: source, target_language: target };
          this.peerPreferenceVersion = version;
          this._setSyncStatus(true);
        }
        return;
      }
      if (eventType !== "translation.result") return;
      const payload = envelope.payload || {};
      const requestId = String(payload.request_id || "");
      const eventId = String(envelope.event_id || "");
      if (!this.isConnected() || String(payload.call_id || "") !== this.callId || !this._isPeerActor(envelope.actor)) return;
      if (eventId && this._seenEventIds.has(eventId)) return;
      if (requestId && this._seenRequestIds.has(requestId)) return;
      if (eventId) this._seenEventIds.add(eventId);
      if (requestId) this._seenRequestIds.add(requestId);
      this._showResult({
        original: payload.transcript || "",
        transcript: payload.transcript || "",
        translation: payload.translation || "",
        sourceLanguage: payload.source_language,
        targetLanguage: payload.target_language,
        requestId,
        segmentId: payload.segment_id,
        historyId: payload.history_id,
      });
      this._setPanel(true);
      this._setStatus(this._copy("copyTranslationRemoteReceived", "Translation received from the other person."));
    }

    _isPeerActor(actor = {}) {
      const ownType = String(this.app?.dataset?.actorType || "");
      const ownId = String(this.app?.dataset?.actorId || "");
      return !(String(actor.type || "") === ownType && String(actor.id || "") === ownId);
    }

    _teardown(reason = "closed", { terminating = false, preserveCall = false } = {}) {
      this.pluginGeneration += 1;
      this.state = terminating ? "TERMINATING" : "CLOSED";
      this._recording = null;
      for (const controller of this._owned.abortControllers) {
        try { controller.abort(); } catch (_error) { /* best effort */ }
      }
      this._owned.abortControllers.clear();
      for (const controller of this._owned.ttsAbortControllers) {
        try { controller.abort(); } catch (_error) { /* best effort */ }
      }
      for (const controller of this._owned.autoReadAbortControllers) {
        try { controller.abort(); } catch (_error) { /* best effort */ }
      }
      this._stopOutboundTts();
      this._owned.ttsAbortControllers.clear();
      this._owned.autoReadAbortControllers.clear();
      for (const recorder of this._owned.recorders) {
        try { recorder.stop?.(); } catch (_error) { /* discard final data */ }
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
      }
      this._owned.recorders.clear();
      for (const source of this._owned.ttsSources) {
        try { source.pause?.(); } catch (_error) { /* best effort */ }
        try { source.stop?.(); } catch (_error) { /* source may already be stopped */ }
        try { source.disconnect?.(); } catch (_error) { /* best effort */ }
        try { source.src = ""; } catch (_error) { /* best effort */ }
        try { source.onended = null; source.onerror = null; } catch (_error) { /* best effort */ }
      }
      this._owned.ttsSources.clear();
      this._owned.outboundTtsSources.clear();
      this._owned.autoReadTtsSources.clear();
      this._disposeMixer(this._mixer);
      for (const context of this._owned.audioContexts) {
        try {
          const closing = context.close?.();
          closing?.catch?.(() => {});
        } catch (_error) { /* best effort */ }
      }
      this._owned.audioContexts.clear();
      for (const track of this._owned.mixedTracks) {
        try { track.stop?.(); } catch (_error) { /* best effort */ }
      }
      this._owned.mixedTracks.clear();
      for (const channel of this._owned.realtimeDataChannels) {
        try { channel.onopen = null; channel.onmessage = null; channel.onerror = null; channel.onclose = null; channel.close?.(); } catch (_error) { /* best effort */ }
      }
      this._owned.realtimeDataChannels.clear();
      for (const pc of this._owned.realtimePeerConnections) {
        try { pc.onconnectionstatechange = null; pc.ontrack = null; pc.close?.(); } catch (_error) { /* best effort */ }
      }
      this._owned.realtimePeerConnections.clear();
      for (const track of this._owned.realtimeTracks) {
        try { track.stop?.(); } catch (_error) { /* sidecar clone only */ }
      }
      this._owned.realtimeTracks.clear();
      for (const url of this._owned.objectUrls) {
        try { root.URL?.revokeObjectURL?.(url); } catch (_error) { /* best effort */ }
      }
      this._owned.objectUrls.clear();
      for (const timer of this._owned.timers) root.clearTimeout(timer);
      this._owned.timers.clear();
      this._mixer = null;
      this._mixerPromise = null;
      this._autoReadReady = null;
      this._autoReadPreparation = null;
      this.lastResult = null;
      this.historyBeforeId = null;
      this.historyCallId = "";
      this.ui?.historyList?.replaceChildren?.();
      if (this.ui?.historyMore) this.ui.historyMore.hidden = true;
      if (!preserveCall) {
        this.callId = "";
        this.callGeneration = null;
        this.preferenceVersion = 0;
        this.peerPreferenceVersion = 0;
        this.syncConnected = false;
      } else {
        this.state = "CONNECTED";
        this._setSyncStatus(false);
      }
      this._setRecordState(false);
      if (this.ui?.realtimeMode) this.ui.realtimeMode.hidden = true;
      this.mutedAutoReadSnapshot = null;
      if (this.ui?.autoRead) {
        this.ui.autoRead.checked = false;
        this.ui.autoRead.disabled = false;
        this.ui.autoRead.removeAttribute?.("aria-disabled");
      }
      this._resetResult();
      this._resetQuota();
    }
  }

  namespace.CallTranslationPlugin = CallTranslationPlugin;
  root.TimeblockCallV1 = namespace;
})();
