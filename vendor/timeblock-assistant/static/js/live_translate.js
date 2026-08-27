(function (root) {
  "use strict";

  const PHASES = Object.freeze({
    IDLE: "IDLE",
    RECORDING: "RECORDING",
    PROCESSING: "PROCESSING",
    RESULT_READY: "RESULT_READY",
    TTS_LOADING: "TTS_LOADING",
    TTS_PLAYING: "TTS_PLAYING",
    ERROR: "ERROR",
  });
  const PHASE_VALUES = new Set(Object.values(PHASES));
  const AUDIO_MIME_TYPES = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  class LiveTranslateController {
    constructor(app, environment = root) {
      this.app = app;
      this.environment = environment;
      this.elements = {};
      this.state = {
        initialized: false,
        active: false,
        sourceLanguage: "vi",
        targetLanguage: "zh-TW",
        phase: PHASES.IDLE,
        stream: null,
        recorder: null,
        chunks: [],
        translationAbort: null,
        ttsAbort: null,
        ttsAudio: null,
        ttsObjectUrl: "",
        generation: 0,
        translation: "",
        targetForTranslation: "",
        lastIntent: "",
      };
      this.handlePageHide = () => this.releaseForExit();
    }

    query(selector) {
      return this.app?.querySelector?.(selector) || null;
    }

    copy(name, fallback = "") {
      const normalized = String(name || "");
      const copyKey = normalized
        ? `copy${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
        : "";
      return (copyKey && this.app?.dataset?.[copyKey]) || fallback;
    }

    initialize() {
      if (this.state.initialized) return true;
      const panel = this.query('[data-live-translate]');
      if (!panel) return false;
      this.elements = {
        panel,
        form: this.query('[data-live-translate-form]'),
        source: this.query('[data-live-translate-source]'),
        target: this.query('[data-live-translate-target]'),
        swap: this.query('[data-live-translate-swap]'),
        text: this.query('[data-live-translate-text]'),
        submit: this.query('[data-live-translate-submit]'),
        voice: this.query('[data-live-translate-voice]'),
        voiceLabel: this.query('[data-live-translate-voice-label]'),
        reset: this.query('[data-live-translate-reset]'),
        retry: this.query('[data-live-translate-retry]'),
        status: this.query('[data-live-translate-status]'),
        transcriptWrap: this.query('[data-live-translate-transcript]'),
        transcript: this.query('[data-live-translate-transcript-value]'),
        output: this.query('[data-live-translate-output]'),
        tts: this.query('[data-live-translate-tts]'),
        ttsLabel: this.query('[data-live-translate-tts-label]'),
      };
      if (!this.elements.form || !this.elements.source || !this.elements.target) return false;

      this.state.sourceLanguage = this.elements.source.value || "vi";
      this.state.targetLanguage = this.elements.target.value || "zh-TW";

      this.elements.form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.translateText();
      });
      this.elements.voice?.addEventListener("click", () => this.toggleVoice());
      this.elements.tts?.addEventListener("click", () => this.toggleTts());
      this.elements.reset?.addEventListener("click", () => this.reset());
      this.elements.retry?.addEventListener("click", () => this.retry());
      this.elements.source.addEventListener("change", () => this.handleLanguageChange());
      this.elements.target.addEventListener("change", () => this.handleLanguageChange());
      this.elements.swap?.addEventListener("click", () => this.swapLanguages());
      this.environment.addEventListener?.("pagehide", this.handlePageHide);

      this.state.initialized = true;
      this.setPhase(PHASES.IDLE);
      this.renderEmptyResult();
      return true;
    }

    setActive(active) {
      if (!this.initialize()) return;
      const next = Boolean(active);
      if (this.state.active && !next) this.cancelSupersededIntent({ preserveResult: true });
      this.state.active = next;
    }

    setFeedback(message, isError = false) {
      const element = this.elements.status;
      if (!element) return;
      element.textContent = message || "";
      element.classList.toggle("is-error", Boolean(isError));
      element.setAttribute("role", isError ? "alert" : "status");
      element.setAttribute("aria-live", isError ? "assertive" : "polite");
    }

    setPhase(phase, statusMessage = "", isError = false) {
      const next = PHASE_VALUES.has(phase) ? phase : PHASES.ERROR;
      this.state.phase = next;
      if (this.elements.panel) this.elements.panel.dataset.liveTranslatePhase = next;
      const recording = next === PHASES.RECORDING;
      const busy = next === PHASES.PROCESSING || next === PHASES.TTS_LOADING;
      this.elements.form?.setAttribute("aria-busy", String(busy));
      if (this.elements.voice) {
        this.elements.voice.classList.toggle("is-recording", recording);
        this.elements.voice.setAttribute("aria-pressed", String(recording));
      }
      if (this.elements.voiceLabel) {
        this.elements.voiceLabel.textContent = recording
          ? this.copy("translationStopRecording", "Stop recording")
          : this.copy("translationStartRecording", "Start recording");
        this.elements.voice?.setAttribute("aria-label", this.elements.voiceLabel.textContent);
      }
      if (this.elements.tts) {
        const speaking = next === PHASES.TTS_LOADING || next === PHASES.TTS_PLAYING;
        this.elements.tts.setAttribute("aria-pressed", String(speaking));
        this.elements.tts.disabled = !this.state.translation;
      }
      if (this.elements.ttsLabel) {
        this.elements.ttsLabel.textContent = (
          next === PHASES.TTS_LOADING || next === PHASES.TTS_PLAYING
        )
          ? this.copy("translationStopListening", "Stop listening")
          : this.copy("translationTapListen", "Tap to listen");
      }
      if (this.elements.retry) this.elements.retry.hidden = !isError;
      if (statusMessage || isError) this.setFeedback(statusMessage, isError);
    }

    isCurrent(generation) {
      return generation === this.state.generation;
    }

    nextGeneration() {
      this.state.generation += 1;
      return this.state.generation;
    }

    abortTranslationRequest() {
      const controller = this.state.translationAbort;
      this.state.translationAbort = null;
      if (!controller) return;
      try { controller.abort(); } catch (_error) { /* idempotent cleanup */ }
    }

    stopTts(options = {}) {
      const controller = this.state.ttsAbort;
      const audio = this.state.ttsAudio;
      const objectUrl = this.state.ttsObjectUrl;
      this.state.ttsAbort = null;
      this.state.ttsAudio = null;
      this.state.ttsObjectUrl = "";

      if (controller) {
        try { controller.abort(); } catch (_error) { /* idempotent cleanup */ }
      }
      if (audio) {
        try { audio.pause(); } catch (_error) { /* best effort */ }
        try { audio.onended = null; } catch (_error) { /* best effort */ }
        try { audio.onerror = null; } catch (_error) { /* best effort */ }
        try { audio.removeAttribute?.("src"); } catch (_error) { /* best effort */ }
        try { audio.src = ""; } catch (_error) { /* best effort */ }
        try { audio.load?.(); } catch (_error) { /* best effort */ }
      }
      if (objectUrl) {
        try { this.environment.URL?.revokeObjectURL?.(objectUrl); } catch (_error) { /* best effort */ }
      }
      this.elements.tts?.setAttribute("aria-pressed", "false");
      if (this.elements.ttsLabel) {
        this.elements.ttsLabel.textContent = this.copy("translationTapListen", "Tap to listen");
      }
      if (!options.keepPhase && [PHASES.TTS_LOADING, PHASES.TTS_PLAYING].includes(this.state.phase)) {
        this.setPhase(this.state.translation ? PHASES.RESULT_READY : PHASES.IDLE);
      }
    }

    cleanupMicrophone(options = {}) {
      const stopRecorder = options.stopRecorder !== false;
      const recorder = this.state.recorder;
      const stream = this.state.stream;
      this.state.recorder = null;
      this.state.stream = null;
      this.state.chunks = [];

      if (stopRecorder && recorder?.state === "recording") {
        try { recorder.stop(); } catch (_error) { /* best effort */ }
      }
      stream?.getTracks?.().forEach((track) => {
        try { track.stop(); } catch (_error) { /* best effort */ }
      });
      this.elements.voice?.classList.remove("is-recording");
      this.elements.voice?.setAttribute("aria-pressed", "false");
    }

    cancelSupersededIntent(options = {}) {
      this.nextGeneration();
      this.abortTranslationRequest();
      this.cleanupMicrophone();
      this.stopTts({ keepPhase: true });
      if (!options.preserveResult) this.clearResult();
      this.setPhase(this.state.translation && options.preserveResult ? PHASES.RESULT_READY : PHASES.IDLE);
      return this.state.generation;
    }

    languagePairValid(showError = true) {
      const source = this.elements.source?.value || "";
      const target = this.elements.target?.value || "";
      if (source && target && source !== target) return true;
      if (showError) {
        this.setPhase(
          PHASES.ERROR,
          this.copy("translationSameLanguage", "Choose two different languages."),
          true,
        );
      }
      return false;
    }

    handleLanguageChange() {
      this.cancelSupersededIntent();
      this.state.sourceLanguage = this.elements.source?.value || "vi";
      this.state.targetLanguage = this.elements.target?.value || "zh-TW";
      this.languagePairValid(true);
    }

    swapLanguages() {
      if (!this.elements.source || !this.elements.target) return;
      const previous = this.elements.source.value;
      this.elements.source.value = this.elements.target.value;
      this.elements.target.value = previous;
      this.handleLanguageChange();
      this.elements.source.focus?.();
    }

    clearResult() {
      this.state.translation = "";
      this.state.targetForTranslation = "";
      if (this.elements.transcriptWrap) this.elements.transcriptWrap.hidden = true;
      if (this.elements.transcript) this.elements.transcript.textContent = "";
      this.renderEmptyResult();
      if (this.elements.tts) this.elements.tts.disabled = true;
    }

    renderEmptyResult() {
      if (this.elements.output) {
        this.elements.output.textContent = this.copy("translationEmpty", "Translation will appear here.");
      }
    }

    renderResult(payload, generation, targetLanguage, options = {}) {
      if (!this.isCurrent(generation)) return false;
      const translation = String(payload?.translation || "").trim();
      const transcript = String(payload?.transcript || "").trim();
      if (!translation) throw new Error(this.copy("translationFailed", "Translation failed."));
      this.state.translation = translation;
      this.state.targetForTranslation = targetLanguage;
      if (this.elements.output) this.elements.output.textContent = translation;
      if (this.elements.transcriptWrap) this.elements.transcriptWrap.hidden = !options.showTranscript || !transcript;
      if (this.elements.transcript) this.elements.transcript.textContent = options.showTranscript ? transcript : "";
      this.setFeedback("", false);
      this.setPhase(PHASES.RESULT_READY);
      return true;
    }

    beginUserIntent() {
      const generation = this.nextGeneration();
      this.abortTranslationRequest();
      this.cleanupMicrophone();
      this.stopTts({ keepPhase: true });
      return generation;
    }

    async requestJson(url, options, generation) {
      const AbortControllerCtor = this.environment.AbortController || AbortController;
      const controller = new AbortControllerCtor();
      this.state.translationAbort = controller;
      try {
        const response = await this.environment.fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          const error = new Error(payload.error || this.copy("translationFailed", "Translation failed."));
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        if (!this.isCurrent(generation)) return null;
        return payload;
      } finally {
        if (this.state.translationAbort === controller) this.state.translationAbort = null;
      }
    }

    formData(sourceLanguage, targetLanguage, text = "") {
      const FormDataCtor = this.environment.FormData || FormData;
      const data = new FormDataCtor();
      data.append("source_language", sourceLanguage);
      data.append("target_language", targetLanguage);
      data.append("lang", this.app?.dataset?.locale || "vi");
      if (text) data.append("text", text);
      return data;
    }

    async translateText() {
      if (!this.languagePairValid(true)) return;
      const value = String(this.elements.text?.value || "").trim();
      if (!value) {
        this.setPhase(PHASES.ERROR, this.copy("translationTextRequired", "Enter text to translate."), true);
        return;
      }
      const sourceLanguage = this.elements.source.value;
      const targetLanguage = this.elements.target.value;
      const generation = this.beginUserIntent();
      this.state.lastIntent = "text";
      this.state.sourceLanguage = sourceLanguage;
      this.state.targetLanguage = targetLanguage;
      this.setPhase(PHASES.PROCESSING, this.copy("translationProcessing", "Processing…"));
      try {
        const payload = await this.requestJson(
          "/translator/api/text",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
            body: this.formData(sourceLanguage, targetLanguage, value),
          },
          generation,
        );
        if (!payload || !this.isCurrent(generation)) return;
        this.renderResult(payload, generation, targetLanguage, { showTranscript: false });
      } catch (error) {
        if (error?.name === "AbortError" || !this.isCurrent(generation)) return;
        this.setPhase(
          PHASES.ERROR,
          error?.message || this.copy("translationFailed", "Translation failed."),
          true,
        );
      }
    }

    supportedAudioMimeType() {
      const MediaRecorderCtor = this.environment.MediaRecorder;
      if (!MediaRecorderCtor) return "";
      if (typeof MediaRecorderCtor.isTypeSupported !== "function") return "";
      return AUDIO_MIME_TYPES.find((type) => MediaRecorderCtor.isTypeSupported(type)) || "";
    }

    audioFilename(mimeType) {
      if (String(mimeType).includes("mp4")) return "live-translate.m4a";
      if (String(mimeType).includes("ogg")) return "live-translate.ogg";
      return "live-translate.webm";
    }

    async toggleVoice() {
      if (this.state.phase === PHASES.RECORDING) {
        const recorder = this.state.recorder;
        if (recorder?.state === "recording") {
          this.setPhase(PHASES.PROCESSING, this.copy("translationProcessing", "Processing…"));
          try { recorder.stop(); } catch (error) { this.failRecording(error, this.state.generation); }
        }
        return;
      }
      await this.startRecording();
    }

    async startRecording() {
      if (!this.languagePairValid(true)) return;
      const MediaRecorderCtor = this.environment.MediaRecorder;
      const mediaDevices = this.environment.navigator?.mediaDevices;
      if (!MediaRecorderCtor || !mediaDevices?.getUserMedia) {
        this.setPhase(
          PHASES.ERROR,
          this.copy("translationRecordingUnsupported", "Audio recording is not supported on this browser."),
          true,
        );
        return;
      }

      const sourceLanguage = this.elements.source.value;
      const targetLanguage = this.elements.target.value;
      const generation = this.beginUserIntent();
      this.state.lastIntent = "voice";
      this.state.sourceLanguage = sourceLanguage;
      this.state.targetLanguage = targetLanguage;
      this.setFeedback("", false);

      let stream;
      try {
        stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        this.cleanupMicrophone();
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        this.setPhase(
          PHASES.ERROR,
          denied
            ? this.copy("translationMicrophoneDenied", "Microphone permission was denied.")
            : this.copy("translationRecordingUnsupported", "Audio recording is not supported on this browser."),
          true,
        );
        return;
      }

      if (!this.isCurrent(generation)) {
        stream?.getTracks?.().forEach((track) => {
          try { track.stop(); } catch (_error) { /* stale capture cleanup */ }
        });
        return;
      }

      const mimeType = this.supportedAudioMimeType();
      let recorder;
      try {
        recorder = mimeType
          ? new MediaRecorderCtor(stream, { mimeType })
          : new MediaRecorderCtor(stream);
      } catch (error) {
        stream?.getTracks?.().forEach((track) => {
          try { track.stop(); } catch (_error) { /* constructor failure cleanup */ }
        });
        if (this.isCurrent(generation)) {
          this.setPhase(
            PHASES.ERROR,
            this.copy("translationRecordingUnsupported", "Audio recording is not supported on this browser."),
            true,
          );
        }
        return;
      }

      const chunks = [];
      this.state.stream = stream;
      this.state.recorder = recorder;
      this.state.chunks = chunks;

      recorder.addEventListener("dataavailable", (event) => {
        if (!this.isCurrent(generation)) return;
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        this.failRecording(event?.error || new Error("recording-error"), generation);
      });
      recorder.addEventListener("stop", () => {
        this.completeRecording(recorder, chunks, mimeType, generation, sourceLanguage, targetLanguage)
          .catch((error) => {
            if (!this.isCurrent(generation)) return;
            this.setPhase(
              PHASES.ERROR,
              error?.message || this.copy("translationFailed", "Translation failed."),
              true,
            );
          });
      }, { once: true });

      try {
        recorder.start(250);
        this.setPhase(PHASES.RECORDING, this.copy("translationRecording", "Recording…"));
      } catch (error) {
        this.failRecording(error, generation);
      }
    }

    failRecording(error, generation) {
      if (!this.isCurrent(generation)) {
        this.cleanupMicrophone();
        return;
      }
      this.nextGeneration();
      this.abortTranslationRequest();
      this.cleanupMicrophone();
      this.setPhase(
        PHASES.ERROR,
        error?.name === "NotAllowedError"
          ? this.copy("translationMicrophoneDenied", "Microphone permission was denied.")
          : this.copy("translationRecordingUnsupported", "Audio recording failed."),
        true,
      );
    }

    async completeRecording(recorder, chunks, mimeType, generation, sourceLanguage, targetLanguage) {
      const BlobCtor = this.environment.Blob || Blob;
      const outputType = recorder?.mimeType || mimeType || "audio/webm";
      const blob = new BlobCtor(chunks, { type: outputType });

      // Final dataavailable has already fired before this stop event. Release the
      // microphone completely before any provider/network wait begins.
      this.cleanupMicrophone({ stopRecorder: false });
      if (!this.isCurrent(generation)) return;
      if (!blob.size) {
        this.setPhase(
          PHASES.ERROR,
          this.copy("translationRecordingUnsupported", "The recording did not contain audio."),
          true,
        );
        return;
      }

      this.setPhase(PHASES.PROCESSING, this.copy("translationProcessing", "Processing…"));
      const data = this.formData(sourceLanguage, targetLanguage);
      data.append("file", blob, this.audioFilename(outputType));
      try {
        const payload = await this.requestJson(
          "/translator/api/audio",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
            body: data,
          },
          generation,
        );
        if (!payload || !this.isCurrent(generation)) return;
        this.renderResult(payload, generation, targetLanguage, { showTranscript: true });
      } catch (error) {
        if (error?.name === "AbortError" || !this.isCurrent(generation)) return;
        this.setPhase(
          PHASES.ERROR,
          error?.message || this.copy("translationFailed", "Translation failed."),
          true,
        );
      }
    }

    async toggleTts() {
      if (
        this.state.ttsAbort
        || this.state.ttsAudio
        || this.state.phase === PHASES.TTS_LOADING
        || this.state.phase === PHASES.TTS_PLAYING
      ) {
        this.stopTts();
        return;
      }
      await this.startTts();
    }

    async startTts() {
      const text = String(this.state.translation || "").trim();
      if (!text) return;
      const generation = this.state.generation;
      this.stopTts({ keepPhase: true });
      const AbortControllerCtor = this.environment.AbortController || AbortController;
      const controller = new AbortControllerCtor();
      this.state.ttsAbort = controller;
      this.setPhase(PHASES.TTS_LOADING, this.copy("translationSpeechLoading", "Preparing audio…"));
      try {
        const response = await this.environment.fetch("/translator/api/speech", {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({
            text,
            target_language: this.state.targetForTranslation || this.state.targetLanguage,
            lang: this.app?.dataset?.locale || "vi",
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || this.copy("translationSpeechFailed", "Speech playback failed."));
        }
        const blob = await response.blob();
        if (!this.isCurrent(generation) || this.state.ttsAbort !== controller) return;
        const objectUrl = this.environment.URL.createObjectURL(blob);
        const AudioCtor = this.environment.Audio;
        const audio = new AudioCtor();
        this.state.ttsObjectUrl = objectUrl;
        this.state.ttsAudio = audio;
        audio.src = objectUrl;
        audio.preload = "auto";
        audio.onended = () => {
          if (!this.isCurrent(generation) || this.state.ttsAudio !== audio) return;
          this.stopTts();
        };
        audio.onerror = () => {
          if (!this.isCurrent(generation) || this.state.ttsAudio !== audio) return;
          this.stopTts({ keepPhase: true });
          this.setPhase(
            PHASES.ERROR,
            this.copy("translationSpeechFailed", "Speech playback failed."),
            true,
          );
        };
        await audio.play();
        if (!this.isCurrent(generation) || this.state.ttsAudio !== audio) {
          this.stopTts();
          return;
        }
        this.setFeedback("", false);
        this.setPhase(PHASES.TTS_PLAYING);
      } catch (error) {
        if (error?.name === "AbortError" || !this.isCurrent(generation)) return;
        this.stopTts({ keepPhase: true });
        this.setPhase(
          PHASES.ERROR,
          error?.message || this.copy("translationSpeechFailed", "Speech playback failed."),
          true,
        );
      } finally {
        if (this.state.ttsAbort === controller && !this.state.ttsAudio) this.state.ttsAbort = null;
      }
    }

    retry() {
      if (this.state.lastIntent === "voice") {
        this.startRecording();
        return;
      }
      this.translateText();
    }

    reset() {
      this.cancelSupersededIntent();
      if (this.elements.text) this.elements.text.value = "";
      this.setFeedback("", false);
      this.clearResult();
      this.setPhase(PHASES.IDLE);
      this.elements.text?.focus?.();
    }

    releaseForExit() {
      this.nextGeneration();
      this.abortTranslationRequest();
      this.cleanupMicrophone();
      this.stopTts({ keepPhase: true });
      this.setPhase(this.state.translation ? PHASES.RESULT_READY : PHASES.IDLE);
    }

  }

  function bootstrap() {
    const documentObject = root.document;
    if (!documentObject?.getElementById) return null;
    const app = documentObject.getElementById("assistant-app");
    if (!app || root.TimeblockLiveTranslate instanceof LiveTranslateController) {
      return root.TimeblockLiveTranslate || null;
    }
    const controller = new LiveTranslateController(app, root);
    controller.initialize();
    root.TimeblockLiveTranslate = controller;
    return controller;
  }

  root.TimeblockLiveTranslateController = LiveTranslateController;
  root.TimeblockLiveTranslatePhases = PHASES;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { LiveTranslateController, PHASES, AUDIO_MIME_TYPES };
  }

  bootstrap();
}(typeof window !== "undefined" ? window : globalThis));
