(function (root) {
  "use strict";
  const kit = root.TimeblockLiveTranslateHotfixKit;
  if (!kit) return;

  function installMedia(controller) {
    if (!controller || controller.__timeblockLiveTranslateHotfixInstalled) return controller;
    controller.__timeblockLiveTranslateHotfixInstalled = true;
    kit.ensureDeviceUi(controller);

    const baseCleanupMicrophone = controller.cleanupMicrophone.bind(controller);
    controller.cleanupMicrophone = function cleanupMicrophoneHotfix(options = {}) {
      const detach = this.state.hotfixTrackDetach;
      this.state.hotfixTrackDetach = null;
      if (typeof detach === "function") {
        try { detach(); } catch (_error) { /* best effort */ }
      }
      const result = baseCleanupMicrophone(options);
      if (this.elements.hotfixMicStatus && this.state.phase !== "ERROR") {
        kit.setMicStatus(this, this.copy("translationStartRecording", "Microphone"), false);
      }
      return result;
    };

    controller.startRecording = async function startRecordingHotfix() {
      if (!this.languagePairValid(true)) return;
      const MediaRecorderCtor = this.environment.MediaRecorder;
      const mediaDevices = this.environment.navigator?.mediaDevices;
      if (!MediaRecorderCtor || !mediaDevices?.getUserMedia) {
        const code = kit.setDiagnostic(this, "MEDIARECORDER_UNSUPPORTED");
        const message = kit.localizedMicMessage(this, code);
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      const sourceLanguage = this.elements.source.value;
      const targetLanguage = this.elements.target.value;
      const generation = this.beginUserIntent();
      this.state.lastIntent = "voice";
      this.state.sourceLanguage = sourceLanguage;
      this.state.targetLanguage = targetLanguage;
      this.setFeedback("", false);
      kit.ensureDeviceUi(this);

      let stream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: kit.selectedAudioConstraint(this),
          video: false,
        });
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        this.cleanupMicrophone();
        const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
        const message = kit.localizedMicMessage(this, code);
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      if (!this.isCurrent(generation)) {
        stream?.getTracks?.().forEach((track) => {
          try { track.stop(); } catch (_error) { /* stale capture cleanup */ }
        });
        return;
      }

      let track;
      try {
        track = kit.validateTrack(stream);
      } catch (error) {
        stream?.getTracks?.().forEach((item) => {
          try { item.stop(); } catch (_error) { /* invalid stream cleanup */ }
        });
        const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
        const message = kit.localizedMicMessage(this, code);
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      let recorderRecord;
      try {
        recorderRecord = kit.createRecorder(MediaRecorderCtor, stream);
      } catch (error) {
        stream?.getTracks?.().forEach((item) => {
          try { item.stop(); } catch (_error) { /* constructor failure cleanup */ }
        });
        const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
        const message = kit.localizedMicMessage(this, code);
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      const { recorder, requestedMimeType } = recorderRecord;
      const chunks = [];
      this.state.stream = stream;
      this.state.recorder = recorder;
      this.state.chunks = chunks;
      this.state.hotfixTrackSettings = typeof track.getSettings === "function" ? track.getSettings() : {};

      const onTrackEnded = () => {
        if (!this.isCurrent(generation) || this.state.stream !== stream) return;
        const code = kit.setDiagnostic(this, "MIC_TRACK_ENDED");
        const message = kit.localizedMicMessage(this, code);
        this.cleanupMicrophone();
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
      };
      track.addEventListener?.("ended", onTrackEnded, { once: true });
      this.state.hotfixTrackDetach = () => track.removeEventListener?.("ended", onTrackEnded);

      recorder.addEventListener("dataavailable", (event) => {
        if (!this.isCurrent(generation)) return;
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        if (!this.isCurrent(generation)) return;
        const error = event?.error || new Error("recording-error");
        error.liveTranslateCode = "MEDIARECORDER_FAILED";
        this.failRecording(error, generation);
      });
      recorder.addEventListener("stop", () => {
        this.completeRecording(recorder, chunks, requestedMimeType, generation, sourceLanguage, targetLanguage)
          .catch((error) => {
            if (!this.isCurrent(generation)) return;
            const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
            const message = error?.message || kit.localizedMicMessage(this, code);
            kit.setMicStatus(this, message, true);
            this.setPhase("ERROR", message, true);
          });
      }, { once: true });

      try {
        recorder.start(250);
        kit.setDiagnostic(this, "RECORDING");
        kit.setMicStatus(this, this.copy("translationRecording", "Recording…"), false);
        this.setPhase("RECORDING", this.copy("translationRecording", "Recording…"));
        // Enumeration is privacy-gated; refresh only after permission was granted.
        kit.refreshDevices(this).catch(() => []);
      } catch (error) {
        error.liveTranslateCode = "MEDIARECORDER_FAILED";
        this.failRecording(error, generation);
      }
    };

    const baseFailRecording = controller.failRecording.bind(controller);
    controller.failRecording = function failRecordingHotfix(error, generation) {
      const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
      const message = kit.localizedMicMessage(this, code);
      const result = baseFailRecording(error, generation);
      kit.setMicStatus(this, message, true);
      return result;
    };

    controller.completeRecording = async function completeRecordingHotfix(
      recorder,
      chunks,
      requestedMimeType,
      generation,
      sourceLanguage,
      targetLanguage,
    ) {
      const BlobCtor = this.environment.Blob || Blob;
      const outputType = String(recorder?.mimeType || requestedMimeType || "audio/webm");
      const blob = new BlobCtor(chunks, { type: outputType });

      // The stop event runs after final dataavailable. Detach ended handlers and
      // physically stop every track before any network/provider wait begins.
      this.cleanupMicrophone({ stopRecorder: false });
      if (!this.isCurrent(generation)) return;

      if (!blob || !blob.size) {
        const code = kit.setDiagnostic(this, "AUDIO_EMPTY");
        const message = this.copy("translationRecordingUnsupported", "The recording did not contain audio.");
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      const normalizedType = kit.normalizeMime(blob.type || outputType);
      if (!kit.ACCEPTED_AUDIO_TYPES.has(normalizedType)) {
        const code = kit.setDiagnostic(this, "AUDIO_TYPE_INVALID");
        const message = this.copy("translationRecordingUnsupported", "Audio recording failed.");
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
        return;
      }

      this.setPhase("PROCESSING", this.copy("translationProcessing", "Processing…"));
      const data = this.formData(sourceLanguage, targetLanguage);
      data.append("file", blob, kit.audioFilename(normalizedType));
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
        kit.setDiagnostic(this, "RESULT_READY");
        kit.setMicStatus(this, this.copy("translationStartRecording", "Microphone"), false);
        this.renderResult(payload, generation, targetLanguage, { showTranscript: true });
      } catch (error) {
        if (error?.name === "AbortError" || !this.isCurrent(generation)) return;
        const code = kit.setDiagnostic(this, kit.diagnosticFromError(error));
        const message = error?.message || kit.localizedMicMessage(this, code);
        kit.setMicStatus(this, message, true);
        this.setPhase("ERROR", message, true);
      }
    };

    kit.refreshDevices(controller).catch(() => []);
    return controller;
  }

  kit.installMedia = installMedia;
  if (typeof module !== "undefined" && module.exports) module.exports = { installMedia };
}(typeof window !== "undefined" ? window : globalThis));
