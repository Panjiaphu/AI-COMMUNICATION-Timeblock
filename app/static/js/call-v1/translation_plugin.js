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
    } = {}) {
      this.document = document;
      this.app = app;
      this.fetcher = fetcher;
      this.mediaRecorderFactory = mediaRecorderFactory;
      this.audioContextFactory = audioContextFactory;
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
      this.bound = false;
      this._owned = {
        recorders: new Set(),
        abortControllers: new Set(),
        ttsAbortControllers: new Set(),
        ttsSources: new Set(),
        outboundTtsSources: new Set(),
        objectUrls: new Set(),
        audioContexts: new Set(),
        mixedTracks: new Set(),
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
      this._listen(this.ui.record, "click", () => {
        if (this._recording) this.stopRecording();
        else this.startRecording();
      });
      this._listen(this.ui.listen, "click", () => { void this.listenLocally(); });
      this._listen(this.ui.send, "click", () => { void this.sendToOpponent(); });
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
      const { rawResponse = false, controllerSet = null, ...fetchOptions } = options;
      const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
      if (controller) {
        this._owned.abortControllers.add(controller);
        controllerSet?.add?.(controller);
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
        if (controller) controllerSet?.delete?.(controller);
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
        if (this.ui.autoRead?.checked) void this.sendToOpponent();
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
        // This is the canonical Call V1 track in a disposable stream wrapper;
        // it does not request media and never stops the owned canonical track.
        inputStream = new root.MediaStream([track]);
        const mimeType = this._recordingMimeType();
        recorder = mimeType ? new this.mediaRecorderFactory(inputStream, { mimeType }) : new this.mediaRecorderFactory(inputStream);
        this._recording = { recorder, callId, generation, segmentId, requestId, chunks };
        this._owned.recorders.add(recorder);
        recorder.ondataavailable = (event) => {
          if (!this._activeGeneration(callId, generation, segmentId)) return;
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = () => {
          if (this._recording?.recorder === recorder) this._recording = null;
          this._owned.recorders.delete(recorder);
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
            this._setBusy(false);
            this._setStatus(
              this._copy("copyTranslationRecordingEmpty", "No voice segment was captured. Speak longer, then tap stop."),
              true,
            );
            return;
          }
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          void this._translateRecordedAudio(blob, { callId, generation, segmentId, requestId });
        };
        recorder.start(250);
        this._setRecordState(true);
      } catch (error) {
        this._recording = null;
        if (recorder) this._owned.recorders.delete(recorder);
        this._setStatus(error?.message || this._copy("copyTranslationRecordingUnsupported", "This browser cannot record call audio."), true);
      }
    }

    stopRecording() {
      const recording = this._recording;
      if (!recording) return;
      this._recording = null;
      this._setRecordState(false);
      try { recording.recorder.stop(); } catch (_error) { /* terminal cleanup is best effort */ }
    }

    async _translateRecordedAudio(blob, context) {
      const { callId, generation, segmentId, requestId } = context;
      if (!this._activeGeneration(callId, generation, segmentId)) return;
      const payload = this._callPayload({ requestId, segmentId });
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
        if (this.ui.autoRead?.checked) void this.sendToOpponent();
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
          for (const controller of this._owned.ttsAbortControllers) {
            try { controller.abort(); } catch (_error) { /* best effort */ }
          }
        } else {
          if (this.mutedAutoReadSnapshot !== null) this.ui.autoRead.checked = this.mutedAutoReadSnapshot;
          this.mutedAutoReadSnapshot = null;
          this.ui.autoRead.disabled = false;
          this.ui.autoRead.removeAttribute("aria-disabled");
        }
      }
      if (muted) this._stopOutboundTts();
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

    async _speech(text, targetLanguage, sourceLanguage = "", segmentId = this._newSegment(), { remote = false } = {}) {
      const requestId = randomId("request");
      const callId = this.callId;
      const generation = this.pluginGeneration;
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
        controllerSet: remote ? this._owned.ttsAbortControllers : null,
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

    _stopOutboundTts() {
      for (const source of [...this._owned.outboundTtsSources]) {
        if (typeof source.pause === "function") {
          this._releaseAudio(source, source.__timeblockCallTranslationUrl || "");
          continue;
        }
        try { source.disconnect?.(); } catch (_error) { /* best effort */ }
        this._owned.ttsSources.delete(source);
        this._owned.outboundTtsSources.delete(source);
      }
    }

    async listenLocally() {
      if (!this.isConnected() || !this.lastResult?.translation) return;
      let audio = null;
      let url = "";
      try {
        const speech = await this._speech(this.lastResult.translation, this.lastResult.targetLanguage, this.lastResult.sourceLanguage);
        if (!this._activeGeneration(speech.callId, speech.generation)) return;
        const blob = await speech.response.blob();
        url = root.URL?.createObjectURL?.(blob);
        if (!url) throw new Error("call-translation.url-unavailable");
        this._owned.objectUrls.add(url);
        audio = this._audioElement(url);
        audio.onended = () => this._releaseAudio(audio, url);
        await audio.play();
      } catch (error) {
        if (audio || url) this._releaseAudio(audio, url);
        if (error?.name !== "AbortError" && this.isConnected()) this._setStatus(this._copy("copyTranslationSpeechFailed", "Speech playback failed."), true);
      }
    }

    async sendToOpponent() {
      if (!this.isConnected() || !this.lastResult?.translation) return;
      const track = this.runtime?.session?.localStream?.getAudioTracks?.()[0];
      if (!track || track.enabled === false) {
        this._setStatus(this._copy("copyTranslationMuted", "Your microphone is muted; call voice output is blocked."), true);
        return;
      }
      let url = "";
      let audio = null;
      let source = null;
      try {
        const speech = await this._speech(this.lastResult.translation, this.lastResult.targetLanguage, this.lastResult.sourceLanguage, this._newSegment(), { remote: true });
        if (!this._activeGeneration(speech.callId, speech.generation)) return;
        const blob = await speech.response.blob();
        if (this._isMuted()) return;
        url = root.URL?.createObjectURL?.(blob);
        if (!url) throw new Error("call-translation.url-unavailable");
        this._owned.objectUrls.add(url);
        await this._installMixer(track, speech.generation);
        if (!this._activeGeneration(speech.callId, speech.generation)) return;
        if (this._isMuted()) return;
        audio = this._audioElement(url, { outbound: true });
        const context = this._mixer;
        source = context.audioContext.createMediaElementSource(audio);
        source.connect(context.destination);
        this._owned.ttsSources.add(source);
        this._owned.outboundTtsSources.add(source);
        audio.onended = () => {
          try { source.disconnect?.(); } catch (_error) { /* best effort */ }
          this._owned.ttsSources.delete(source);
          this._owned.outboundTtsSources.delete(source);
          this._releaseAudio(audio, url);
        };
        await audio.play();
      } catch (error) {
        if (source) {
          try { source.disconnect?.(); } catch (_sourceError) { /* best effort */ }
          this._owned.ttsSources.delete(source);
          this._owned.outboundTtsSources.delete(source);
        }
        if (audio || url) this._releaseAudio(audio, url);
        if (error?.name !== "AbortError" && this.isConnected()) this._setStatus(this._copy("copyTranslationSpeechFailed", "Speech playback failed."), true);
      }
    }

    async _installMixer(originalTrack, generation) {
      if (this._mixer?.mixedTrack) return this._mixer;
      if (typeof this.audioContextFactory !== "function" || typeof root.MediaStream !== "function") throw new Error("call-translation.audio-mixer-unavailable");
      const audioContext = new this.audioContextFactory();
      let mixedTrack = null;
      let mixer = null;
      try {
        const inputStream = new root.MediaStream([originalTrack]);
        const input = audioContext.createMediaStreamSource(inputStream);
        const destination = audioContext.createMediaStreamDestination();
        input.connect(destination);
        mixedTrack = destination.stream?.getAudioTracks?.()[0];
        if (!mixedTrack) throw new Error("call-translation.mixed-track-unavailable");
        mixer = { audioContext, input, destination, mixedTrack, originalTrack, generation };
        this._owned.audioContexts.add(audioContext);
        this._owned.mixedTracks.add(mixedTrack);
        this._mixer = mixer;
        const contextState = String(audioContext.state || "");
        if (contextState === "closed") throw new Error("call-translation.audio-context-closed");
        if ((contextState === "suspended" || contextState === "interrupted")
          && this._activeGeneration(this.callId, this.pluginGeneration)) {
          await audioContext.resume();
        }
        if (!this._activeGeneration(this.callId, generation)) throw new DOMException("Stale call generation", "AbortError");
        await this.runtime.peer.replaceLocalAudioTrack(mixedTrack, this.callGeneration);
        return mixer;
      } catch (error) {
        if (this._mixer === mixer) this._mixer = null;
        if (mixedTrack) {
          try { mixedTrack.stop?.(); } catch (_trackError) { /* best effort */ }
          this._owned.mixedTracks.delete(mixedTrack);
        }
        this._owned.audioContexts.delete(audioContext);
        try { await audioContext.close?.(); } catch (_closeError) { /* best effort */ }
        throw error;
      }
    }

    async _restoreOriginalAudioTrack() {
      const mixer = this._mixer;
      if (!mixer) return true;
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
      this._stopOutboundTts();
      this._owned.ttsAbortControllers.clear();
      for (const recorder of this._owned.recorders) {
        try { recorder.stop?.(); } catch (_error) { /* discard final data */ }
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
      }
      this._owned.recorders.clear();
      for (const source of this._owned.ttsSources) {
        try { source.pause?.(); } catch (_error) { /* best effort */ }
        try { source.disconnect?.(); } catch (_error) { /* best effort */ }
        try { source.src = ""; } catch (_error) { /* best effort */ }
        try { source.onended = null; source.onerror = null; } catch (_error) { /* best effort */ }
      }
      this._owned.ttsSources.clear();
      this._owned.outboundTtsSources.clear();
      for (const context of this._owned.audioContexts) {
        try { context.close?.(); } catch (_error) { /* best effort */ }
      }
      this._owned.audioContexts.clear();
      for (const track of this._owned.mixedTracks) {
        try { track.stop?.(); } catch (_error) { /* best effort */ }
      }
      this._owned.mixedTracks.clear();
      for (const url of this._owned.objectUrls) {
        try { root.URL?.revokeObjectURL?.(url); } catch (_error) { /* best effort */ }
      }
      this._owned.objectUrls.clear();
      for (const timer of this._owned.timers) root.clearTimeout(timer);
      this._owned.timers.clear();
      this._mixer = null;
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
      this.mutedAutoReadSnapshot = null;
      this._resetResult();
      this._resetQuota();
    }
  }

  namespace.CallTranslationPlugin = CallTranslationPlugin;
  root.TimeblockCallV1 = namespace;
})();
