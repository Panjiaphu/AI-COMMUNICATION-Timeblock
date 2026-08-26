(function (root) {
  "use strict";

  const kit = root.TimeblockLiveTranslateHotfixKit || {};
  const MIME_CANDIDATES = Object.freeze([
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]);
  const ACCEPTED_AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg"]);

  function normalizeMime(value) {
    return String(value || "").toLowerCase().split(";", 1)[0].trim();
  }

  function audioFilename(mimeType) {
    const normalized = normalizeMime(mimeType);
    if (normalized === "audio/mp4") return "live-translate.m4a";
    if (normalized === "audio/ogg") return "live-translate.ogg";
    return "live-translate.webm";
  }

  function recorderCandidates(MediaRecorderCtor) {
    if (!MediaRecorderCtor) return [];
    const supports = typeof MediaRecorderCtor.isTypeSupported === "function"
      ? (value) => {
        try { return Boolean(MediaRecorderCtor.isTypeSupported(value)); }
        catch (_error) { return false; }
      }
      : null;
    const candidates = supports ? MIME_CANDIDATES.filter(supports) : [];
    // Browser-default recording is a final deterministic fallback. Never retry it twice.
    candidates.push("");
    return Array.from(new Set(candidates));
  }

  function createRecorder(MediaRecorderCtor, stream) {
    if (!MediaRecorderCtor) {
      const error = new Error("media-recorder-unavailable");
      error.liveTranslateCode = "MEDIARECORDER_UNSUPPORTED";
      throw error;
    }
    let lastError = null;
    for (const candidate of recorderCandidates(MediaRecorderCtor)) {
      try {
        const recorder = candidate
          ? new MediaRecorderCtor(stream, { mimeType: candidate })
          : new MediaRecorderCtor(stream);
        return { recorder, requestedMimeType: candidate };
      } catch (error) {
        lastError = error;
      }
    }
    const error = lastError || new Error("media-recorder-init-failed");
    error.liveTranslateCode = "MEDIARECORDER_FAILED";
    throw error;
  }

  function validateTrack(stream) {
    const tracks = Array.from(stream?.getAudioTracks?.() || []);
    if (!tracks.length) {
      const error = new Error("audio-track-missing");
      error.liveTranslateCode = "MIC_DEVICE_MISSING";
      throw error;
    }
    const track = tracks[0];
    if (track.kind && track.kind !== "audio") {
      const error = new Error("audio-track-invalid-kind");
      error.liveTranslateCode = "MIC_DEVICE_MISSING";
      throw error;
    }
    if (track.readyState && track.readyState !== "live") {
      const error = new Error("audio-track-not-live");
      error.liveTranslateCode = "MIC_TRACK_ENDED";
      throw error;
    }
    if (track.enabled === false) {
      const error = new Error("audio-track-disabled");
      error.liveTranslateCode = "MIC_DEVICE_MISSING";
      throw error;
    }
    return track;
  }

  function diagnosticFromError(error) {
    if (error?.liveTranslateCode) return error.liveTranslateCode;
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "MIC_PERMISSION_DENIED";
    if (["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error?.name)) return "MIC_DEVICE_MISSING";
    const backend = String(error?.payload?.error_code || "");
    const mapping = {
      "translator.error.audio_required": "AUDIO_EMPTY",
      "translator.error.audio_type": "AUDIO_TYPE_INVALID",
      "translator.error.audio_duration": "AUDIO_DURATION_INVALID",
      "translator.error.audio_too_large": "AUDIO_UPLOAD_FAILED",
      "translator.error.transcription_failed": "TRANSCRIPTION_FAILED",
      "translator.error.translation_failed": "TRANSLATION_FAILED",
      "translator.error.provider": "PROVIDER_UNAVAILABLE",
    };
    if (mapping[backend]) return mapping[backend];
    if (Number(error?.status || 0) >= 500) return "PROVIDER_UNAVAILABLE";
    if (error?.name === "TypeError" || !error?.status) return "AUDIO_UPLOAD_FAILED";
    return "TRANSLATION_FAILED";
  }

  function setDiagnostic(controller, code) {
    const value = String(code || "");
    if (controller?.elements?.panel) controller.elements.panel.dataset.liveTranslateDiagnostic = value;
    controller.state.hotfixDiagnostic = value;
    return value;
  }

  function localizedMicMessage(controller, code) {
    if (code === "MIC_PERMISSION_DENIED") {
      return controller.copy("translationMicrophoneDenied", "Microphone permission was denied.");
    }
    if (code === "MIC_TRACK_ENDED" || code === "MIC_DEVICE_MISSING" || code.startsWith("MEDIARECORDER")) {
      return controller.copy("translationRecordingUnsupported", "Audio recording is not supported on this browser.");
    }
    return controller.copy("translationFailed", "Translation failed.");
  }

  function ensureDeviceUi(controller) {
    if (!controller?.elements?.form || controller.elements.hotfixDeviceSelect) return;
    const documentObject = controller.environment?.document || root.document;
    if (!documentObject?.createElement) return;
    const actions = controller.elements.form.querySelector?.(".assistant-live-actions") || controller.elements.voice?.parentElement;
    if (!actions?.parentNode) return;

    const row = documentObject.createElement("div");
    row.className = "assistant-live-microphone-row";
    row.dataset.liveTranslateMicrophone = "";

    const label = documentObject.createElement("label");
    label.className = "assistant-live-device-field";
    const labelText = documentObject.createElement("span");
    labelText.textContent = controller.copy(
      "translationStartRecording",
      controller.elements.voiceLabel?.textContent || "Microphone",
    );
    const select = documentObject.createElement("select");
    select.dataset.liveTranslateDevice = "";
    select.setAttribute("aria-label", labelText.textContent);
    const option = documentObject.createElement("option");
    option.value = "";
    option.textContent = labelText.textContent;
    select.appendChild(option);
    label.append(labelText, select);

    const status = documentObject.createElement("p");
    status.className = "assistant-live-microphone-status";
    status.dataset.liveTranslateMicrophoneStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = labelText.textContent;

    row.append(label, status);
    actions.parentNode.insertBefore(row, actions);
    controller.elements.hotfixDeviceSelect = select;
    controller.elements.hotfixMicStatus = status;
    select.addEventListener?.("change", () => {
      if (controller.state.phase === "RECORDING") controller.cleanupMicrophone();
    });
  }

  function setMicStatus(controller, message, isError = false) {
    const status = controller?.elements?.hotfixMicStatus;
    if (!status) return;
    status.textContent = String(message || "");
    status.classList?.toggle?.("is-error", Boolean(isError));
    status.setAttribute?.("role", isError ? "alert" : "status");
    status.setAttribute?.("aria-live", isError ? "assertive" : "polite");
  }

  async function refreshDevices(controller) {
    ensureDeviceUi(controller);
    const select = controller?.elements?.hotfixDeviceSelect;
    const mediaDevices = controller?.environment?.navigator?.mediaDevices;
    if (!select || typeof mediaDevices?.enumerateDevices !== "function") return [];
    let devices = [];
    try {
      devices = (await mediaDevices.enumerateDevices()).filter((device) => device?.kind === "audioinput");
    } catch (_error) {
      return [];
    }
    const previous = select.value || "";
    const fallbackLabel = controller.copy("translationStartRecording", "Microphone");
    while (select.firstChild) select.removeChild(select.firstChild);
    const defaultOption = (controller.environment?.document || root.document).createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = fallbackLabel;
    select.appendChild(defaultOption);
    devices.forEach((device, index) => {
      const option = (controller.environment?.document || root.document).createElement("option");
      option.value = String(device.deviceId || "");
      option.textContent = String(device.label || `${fallbackLabel} ${index + 1}`);
      select.appendChild(option);
    });
    if (previous && devices.some((device) => device.deviceId === previous)) select.value = previous;
    return devices;
  }

  function selectedAudioConstraint(controller) {
    const deviceId = String(controller?.elements?.hotfixDeviceSelect?.value || "");
    return deviceId ? { deviceId: { exact: deviceId } } : true;
  }

  Object.assign(kit, {
    MIME_CANDIDATES,
    ACCEPTED_AUDIO_TYPES,
    normalizeMime,
    audioFilename,
    recorderCandidates,
    createRecorder,
    validateTrack,
    diagnosticFromError,
    setDiagnostic,
    localizedMicMessage,
    ensureDeviceUi,
    setMicStatus,
    refreshDevices,
    selectedAudioConstraint,
  });

  root.TimeblockLiveTranslateHotfixKit = kit;
  if (typeof module !== "undefined" && module.exports) module.exports = kit;
}(typeof window !== "undefined" ? window : globalThis));
