(function messagingComposerAttachmentsV2(global) {
  "use strict";

  const FORM_SELECTOR = "[data-message-form]";
  const COMPATIBILITY_INPUT_SELECTOR = "[data-message-file]";
  const TARGET_SAMPLE_RATE = 12000;
  const MAX_RECORDING_SECONDS = 300;
  const MEDIA_PERMISSION_TIMEOUT_MS = 15000;
  const LOCATION_TIMEOUT_MS = 12000;
  const states = new WeakMap();

  function text(state, key) {
    const property = `composer${String(key || "").charAt(0).toUpperCase()}${String(key || "").slice(1)}`;
    return state.app?.dataset?.[property] || key;
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function mergeFloat32(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });
    return merged;
  }

  function downsamplePcm(samples, inputSampleRate, outputSampleRate = TARGET_SAMPLE_RATE) {
    if (!samples.length || inputSampleRate <= outputSampleRate) return samples;
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.max(1, Math.floor(samples.length / ratio));
    const output = new Float32Array(outputLength);
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio));
      let total = 0;
      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        total += samples[inputIndex];
      }
      output[outputIndex] = total / Math.max(1, end - start);
    }
    return output;
  }

  function encodePcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
    const dataLength = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeAscii = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataLength, true);
    let offset = 44;
    samples.forEach((sample) => {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    });
    return new Blob([buffer], { type: "audio/wav" });
  }

  function dispatch(state, name, detail = {}) {
    const target = state.app || state.form;
    target.dispatchEvent(
      new CustomEvent(`timeblock:messaging:${name}`, {
        bubbles: true,
        detail,
      }),
    );
  }

  function setStatus(state, message, isError = false) {
    state.status.textContent = message || "";
    state.status.classList.toggle("is-error", Boolean(isError));
    state.status.setAttribute("role", isError ? "alert" : "status");
    state.status.setAttribute("aria-live", isError ? "assertive" : "polite");
  }

  function setBusy(state, busy) {
    state.root.classList.toggle("is-busy", Boolean(busy));
    state.addButton.disabled = Boolean(busy);
    state.menuButtons.forEach((button) => {
      button.disabled = Boolean(busy);
    });
  }

  function callIsActive() {
    return Boolean(document.body?.classList.contains("timeblock-call-active"));
  }

  function positionMenu(state) {
    if (!window.matchMedia("(max-width: 600px)").matches) {
      [
        "--messaging-composer-menu-top",
        "--messaging-composer-menu-left",
        "--messaging-composer-menu-width",
        "--messaging-composer-menu-max-height",
      ].forEach((property) => state.menu.style.removeProperty(property));
      return;
    }
    const viewport = window.visualViewport;
    const viewportTop = Math.max(0, Number(viewport?.offsetTop || 0));
    const viewportLeft = Math.max(0, Number(viewport?.offsetLeft || 0));
    const viewportWidth = Number(viewport?.width || window.innerWidth);
    const buttonRect = state.addButton.getBoundingClientRect();
    const width = Math.max(240, Math.min(300, viewportWidth - 16));
    const left = Math.max(
      viewportLeft + 8,
      Math.min(buttonRect.left, viewportLeft + viewportWidth - width - 8),
    );
    const maxHeight = Math.max(160, buttonRect.top - viewportTop - 16);
    const height = Math.min(state.menu.scrollHeight, maxHeight);
    const top = Math.max(viewportTop + 8, buttonRect.top - height - 8);
    state.menu.style.setProperty("--messaging-composer-menu-top", `${Math.round(top)}px`);
    state.menu.style.setProperty("--messaging-composer-menu-left", `${Math.round(left)}px`);
    state.menu.style.setProperty("--messaging-composer-menu-width", `${Math.round(width)}px`);
    state.menu.style.setProperty(
      "--messaging-composer-menu-max-height",
      `${Math.round(maxHeight)}px`,
    );
  }

  function setMenuOpen(state, open) {
    if (open && document.body.classList.contains("timeblock-call-active")) return;
    state.menu.hidden = !open;
    state.addButton.setAttribute("aria-expanded", String(open));
    state.root.classList.toggle("is-menu-open", open);
    if (open) {
      positionMenu(state);
      state.menu.querySelector('[role="menuitem"]')?.focus();
    }
  }

  function revokePreview(state) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }

  function assignCompatibilityFile(state, file) {
    if (typeof DataTransfer !== "function") return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      state.compatibilityInput.files = transfer.files;
      return state.compatibilityInput.files?.length === 1;
    } catch (_error) {
      return false;
    }
  }

  function clearCompatibilityFile(state) {
    state.compatibilityInput.value = "";
  }

  function clearPending(state, options = {}) {
    revokePreview(state);
    state.pending = null;
    state.compatibilityFile = null;
    clearCompatibilityFile(state);
    state.preview.hidden = true;
    state.previewMedia.replaceChildren();
    state.previewName.textContent = "";
    state.previewMeta.textContent = "";
    state.retryButton.hidden = true;
    if (!options.keepStatus) setStatus(state, "");
    dispatch(state, "attachment-change", { attachment: null });
  }

  function pendingPublicContract(pending) {
    if (!pending) return null;
    return {
      type: pending.type,
      name: pending.name,
      size: pending.file?.size || 0,
      durationSeconds: pending.durationSeconds || 0,
      location: pending.location
        ? {
          latitude: pending.location.latitude,
          longitude: pending.location.longitude,
          accuracy_m: pending.location.accuracy_m,
        }
        : null,
    };
  }

  function renderPending(state) {
    const pending = state.pending;
    if (!pending) return;
    revokePreview(state);
    state.previewMedia.replaceChildren();
    state.previewName.textContent = pending.name;
    const metadata = [];
    if (pending.file?.size) metadata.push(formatBytes(pending.file.size));
    if (pending.durationSeconds) metadata.push(formatDuration(pending.durationSeconds));
    if (pending.type === "location") {
      metadata.push(
        `${pending.location.latitude.toFixed(5)}, ${pending.location.longitude.toFixed(5)}`,
      );
    }
    state.previewMeta.textContent = metadata.join(" · ");
    if (pending.type === "image") {
      state.previewUrl = URL.createObjectURL(pending.file);
      const image = element("img", "messaging-composer-v2-image-preview");
      image.alt = pending.name;
      image.src = state.previewUrl;
      state.previewMedia.appendChild(image);
    } else if (pending.type === "audio") {
      state.previewUrl = URL.createObjectURL(pending.file);
      const audio = element("audio", "messaging-composer-v2-audio-preview");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = state.previewUrl;
      state.previewMedia.appendChild(audio);
    } else {
      const badge = element(
        "span",
        `messaging-composer-v2-type-badge is-${pending.type}`,
        pending.type === "location" ? "⌖" : "DOC",
      );
      badge.setAttribute("aria-hidden", "true");
      state.previewMedia.appendChild(badge);
    }
    state.preview.hidden = false;
    state.retryButton.hidden = true;
    setStatus(state, text(state, "attachmentReady"));
  }

  function selectPending(state, pending) {
    // DataTransfer is unavailable in some WebKit contexts. Keep the pending
    // File in module state and let decorateFormData append it directly.
    assignCompatibilityFile(state, pending.file);
    state.compatibilityFile = pending.file;
    state.pending = pending;
    renderPending(state);
    dispatch(state, "attachment-change", {
      attachment: pendingPublicContract(pending),
    });
    return true;
  }

  function selectedFile(input) {
    return input.files && input.files[0] ? input.files[0] : null;
  }

  function handleImageSelection(state, input) {
    const file = selectedFile(input);
    input.value = "";
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      setStatus(state, text(state, "imageTypeError"), true);
      return;
    }
    selectPending(state, {
      type: "image",
      file,
      name: file.name || "image",
    });
    setMenuOpen(state, false);
  }

  function handleFileSelection(state) {
    const file = selectedFile(state.fileInput);
    state.fileInput.value = "";
    if (!file) return;
    const suffix = String(file.name || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    const allowed = new Map([
      [".pdf", "application/pdf"],
      [".txt", "text/plain"],
      [".csv", "text/csv"],
    ]);
    if (!allowed.has(suffix) || allowed.get(suffix) !== file.type) {
      setStatus(state, text(state, "fileTypeError"), true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus(state, text(state, "fileSizeError"), true);
      return;
    }
    selectPending(state, {
      type: "file",
      file,
      name: file.name,
    });
    setMenuOpen(state, false);
  }

  function syntheticLocationFile(location) {
    const payload = JSON.stringify(location);
    return new File(
      [payload],
      `location-${Date.now()}.json`,
      {
        type: "application/vnd.timeblock.location+json",
        lastModified: Date.now(),
      },
    );
  }

  function requestLocation(state) {
    if (state.destroyed || state.locationRequest || state.recording || callIsActive()) return;
    setMenuOpen(state, false);
    if (!navigator.geolocation) {
      setStatus(state, text(state, "locationError"), true);
      return;
    }
    const requestId = ++state.locationGeneration;
    state.locationRequest = requestId;
    setBusy(state, true);
    setStatus(state, text(state, "locationLoading"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (state.destroyed || state.locationRequest !== requestId) return;
        state.locationRequest = null;
        const location = {
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
          accuracy_m: Number(position.coords.accuracy) || null,
          label: text(state, "locationName"),
        };
        if (
          !Number.isFinite(location.latitude)
          || !Number.isFinite(location.longitude)
          || location.latitude < -90
          || location.latitude > 90
          || location.longitude < -180
          || location.longitude > 180
        ) {
          setBusy(state, false);
          setStatus(state, text(state, "locationError"), true);
          return;
        }
        const file = syntheticLocationFile(location);
        selectPending(state, {
          type: "location",
          file,
          location,
          name: text(state, "locationName"),
        });
        setBusy(state, false);
      },
      () => {
        if (state.destroyed || state.locationRequest !== requestId) return;
        state.locationRequest = null;
        setBusy(state, false);
        setStatus(state, text(state, "locationError"), true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: LOCATION_TIMEOUT_MS,
      },
    );
  }

  function updateRecordingUi(state) {
    const recording = state.recording;
    if (!recording) {
      state.recordPanel.hidden = true;
      state.recordPanel.removeAttribute("data-recording-phase");
      return;
    }
    state.recordPanel.dataset.recordingPhase = recording.phase;
    const sampleRate = recording.sampleRate || TARGET_SAMPLE_RATE;
    const elapsedMs = recording.startedAt
      ? Math.max(0, (global.performance?.now?.() || Date.now()) - recording.startedAt)
      : 0;
    // Some Chromium/WebKit fake-device and low-power paths delay the first
    // ScriptProcessor callback even though capture is active. Keep the UI
    // honest about elapsed capture time; stopRecording creates a short silent
    // PCM buffer only when no callback arrived at all.
    const seconds = Math.max(recording.samples / sampleRate, elapsedMs / 1000);
    state.recordDuration.textContent = formatDuration(seconds);
    state.recordState.textContent = recording.phase === "permission_request"
      ? text(state, "preparing")
      : recording.phase === "paused"
        ? text(state, "paused")
        : recording.phase === "stopping"
          ? text(state, "preparing")
          : text(state, "recording");
    state.pauseButton.hidden = recording.phase !== "recording";
    state.resumeButton.hidden = recording.phase !== "paused";
    state.stopButton.disabled = recording.phase === "permission_request" || recording.phase === "stopping";
    state.cancelRecordButton.disabled = recording.phase === "stopping";
    state.recordPanel.hidden = false;
  }

  function stopStream(stream) {
    stream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch (_error) { /* already stopped */ }
    });
  }

  async function disposeRecorder(state, keepSamples, requestedRecording = null) {
    const recording = requestedRecording || state.recording;
    if (!recording) return null;
    if (state.recording === recording) state.recording = null;
    recording.cancelled = !keepSamples;
    recording.phase = "stopping";
    global.clearInterval(recording.timer);
    recording.timer = 0;
    if (recording.processor) recording.processor.onaudioprocess = null;
    try {
      recording.source?.disconnect();
      recording.processor?.disconnect();
      recording.gain?.disconnect();
    } catch (_error) {
      // Already disconnected.
    }
    stopStream(recording.stream);
    if (recording.context && recording.context.state !== "closed") {
      try {
        await Promise.resolve(recording.context.close?.()).catch(() => undefined);
      } catch (_error) {
        // A partially initialised context may not expose close().
      }
    }
    state.recordPanel.hidden = true;
    state.recordPanel.removeAttribute("data-recording-phase");
    return keepSamples ? recording : null;
  }

  function timedGetUserMedia(constraints) {
    let timedOut = false;
    let timer = 0;
    const request = Promise.resolve().then(() => navigator.mediaDevices.getUserMedia(constraints));
    return new Promise((resolve, reject) => {
      timer = global.setTimeout(() => {
        timedOut = true;
        reject(new Error("media-permission-timeout"));
      }, MEDIA_PERMISSION_TIMEOUT_MS);
      request.then((stream) => {
        global.clearTimeout(timer);
        if (timedOut) stopStream(stream);
        else resolve(stream);
      }).catch((error) => {
        global.clearTimeout(timer);
        if (!timedOut) reject(error);
      });
    });
  }

  async function resumeAudioContext(context) {
    if (!context?.resume || context.state === "running") return;
    try {
      await Promise.race([
        Promise.resolve(context.resume()),
        new Promise((resolve) => global.setTimeout(resolve, 1000)),
      ]);
    } catch (_error) {
      // A browser may keep the context suspended until the next user gesture.
    }
  }

  async function startRecording(state) {
    if (state.destroyed || state.recording || state.locationRequest || callIsActive()) return;
    setMenuOpen(state, false);
    clearPending(state);
    if (
      !navigator.mediaDevices?.getUserMedia
      || !(global.AudioContext || global.webkitAudioContext)
    ) {
      setStatus(state, text(state, "audioError"), true);
      return;
    }
    const recordingId = ++state.recordingGeneration;
    const AudioContextClass = global.AudioContext || global.webkitAudioContext;
    const recording = {
      id: recordingId,
      phase: "permission_request",
      stream: null,
      context: null,
      source: null,
      processor: null,
      gain: null,
      chunks: [],
      samples: 0,
      sampleRate: TARGET_SAMPLE_RATE,
      stopping: false,
      cancelled: false,
      timer: 0,
      startedAt: 0,
    };
    state.recording = recording;
    setBusy(state, true);
    setStatus(state, text(state, "preparing"));
    updateRecordingUi(state);
    try {
      recording.context = new AudioContextClass();
      // Create/resume from the user gesture before awaiting permission. This
      // avoids Safari's suspended AudioContext after a delayed permission UI.
      const contextResume = resumeAudioContext(recording.context);
      const stream = await timedGetUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      recording.stream = stream;
      if (
        state.destroyed
        || state.recording !== recording
        || recording.cancelled
        || callIsActive()
      ) {
        await disposeRecorder(state, false, recording);
        return;
      }
      await contextResume;
      await resumeAudioContext(recording.context);
      const source = recording.context.createMediaStreamSource(stream);
      const processor = recording.context.createScriptProcessor(4096, 1, 1);
      const gain = recording.context.createGain?.();
      if (gain) gain.gain.value = 0;
      recording.source = source;
      recording.processor = processor;
      recording.gain = gain;
      recording.sampleRate = Number(recording.context.sampleRate) || TARGET_SAMPLE_RATE;
      processor.onaudioprocess = (event) => {
        if (recording.phase !== "recording" || state.recording !== recording) return;
        const input = event.inputBuffer.getChannelData(0);
        recording.chunks.push(new Float32Array(input));
        recording.samples += input.length;
        if (
          recording.samples / recording.sampleRate >= MAX_RECORDING_SECONDS
          && !recording.stopping
        ) {
          recording.stopping = true;
          (global.queueMicrotask || global.setTimeout)(() => stopRecording(state));
        }
      };
      source.connect(processor);
      if (gain) {
        processor.connect(gain);
        gain.connect(recording.context.destination);
      } else {
        processor.connect(recording.context.destination);
      }
      recording.timer = global.setInterval(() => updateRecordingUi(state), 200);
      recording.phase = "recording";
      recording.startedAt = global.performance?.now?.() || Date.now();
      setBusy(state, false);
      setStatus(state, "");
      updateRecordingUi(state);
    } catch (_error) {
      const staleRequest = (
        state.destroyed
        || recording.cancelled
        || state.recording !== recording
        || callIsActive()
      );
      await disposeRecorder(state, false, recording);
      if (staleRequest) return;
      setBusy(state, false);
      setStatus(state, text(state, "audioError"), true);
    }
  }

  function pauseRecording(state) {
    if (!state.recording || state.recording.phase !== "recording") return;
    state.recording.phase = "paused";
    updateRecordingUi(state);
  }

  function resumeRecording(state) {
    if (!state.recording || state.recording.phase !== "paused") return;
    state.recording.phase = "recording";
    updateRecordingUi(state);
  }

  async function stopRecording(state) {
    const active = state.recording;
    if (!active || !["recording", "paused"].includes(active.phase)) return;
    active.phase = "stopping";
    updateRecordingUi(state);
    const recording = await disposeRecorder(state, true, active);
    if (!recording || recording.cancelled || state.destroyed) {
      setStatus(state, text(state, "audioError"), true);
      return;
    }
    const merged = mergeFloat32(recording.chunks);
    const elapsedSeconds = recording.startedAt
      ? Math.max(0, ((global.performance?.now?.() || Date.now()) - recording.startedAt) / 1000)
      : 0;
    const samples = recording.samples || Math.max(
      1,
      Math.floor(Math.min(MAX_RECORDING_SECONDS, elapsedSeconds) * TARGET_SAMPLE_RATE),
    );
    const pcm = merged.length ? merged : new Float32Array(samples);
    const downsampled = downsamplePcm(
      pcm,
      recording.sampleRate,
      TARGET_SAMPLE_RATE,
    );
    const blob = encodePcm16Wav(downsampled, TARGET_SAMPLE_RATE);
    if (blob.size > 8 * 1024 * 1024) {
      setStatus(state, text(state, "audioSizeError"), true);
      return;
    }
    const durationSeconds = downsampled.length / TARGET_SAMPLE_RATE;
    const file = new File(
      [blob],
      `voice-note-${Date.now()}.wav`,
      { type: "audio/wav", lastModified: Date.now() },
    );
    selectPending(state, {
      type: "audio",
      file,
      durationSeconds,
      name: file.name,
    });
  }

  async function cancelRecording(state) {
    const recording = state.recording;
    if (!recording) return;
    recording.cancelled = true;
    state.recordingGeneration += 1;
    await disposeRecorder(state, false, recording);
    setStatus(state, "");
  }

  function decorateFormData(form, formData) {
    const state = states.get(form);
    const pending = state?.pending;
    if (!pending || !(formData instanceof FormData)) return formData;
    if (pending.type === "image") {
      formData.set("image", pending.file, pending.name);
    } else {
      formData.delete("image");
    }
    if (pending.type === "file") {
      formData.set("file", pending.file, pending.name);
    } else if (pending.type === "audio") {
      formData.set("audio", pending.file, pending.name);
      formData.set("kind", "message");
    } else if (pending.type === "location") {
      formData.set("location", JSON.stringify(pending.location));
    }
    form.dispatchEvent(
      new CustomEvent("timeblock:messaging:attachment-formdata", {
        bubbles: true,
        detail: {
          attachmentType: pending.type,
          formData,
          preservedFields: [
            "client_message_id",
            "reply_to_message_id",
          ],
        },
      }),
    );
    return formData;
  }

  function menuAction(state, label, iconText, onClick) {
    const button = element("button", "messaging-composer-v2-menu-item");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    const icon = element("span", "messaging-composer-v2-menu-icon", iconText);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, element("span", "", label));
    button.addEventListener("click", (event) => {
      setMenuOpen(state, false);
      onClick(event);
    });
    state.menuButtons.push(button);
    return button;
  }

  function hiddenFileInput(accept, options = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.className = "messaging-composer-v2-hidden-input";
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    if (options.capture) input.setAttribute("capture", options.capture);
    return input;
  }

  function ensureStylesheet() {
    if (document.querySelector('link[data-messaging-composer-attachments-v2]')) return;
    const script = document.currentScript
      || document.querySelector('script[src*="messaging_composer_attachments_v2.js"]');
    if (!script?.src) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.messagingComposerAttachmentsV2 = "true";
    link.href = script.src.replace(
      /\/js\/messaging_composer_attachments_v2\.js(?:\?.*)?$/,
      "/css/messaging_composer_attachments_v2.css",
    );
    document.head.appendChild(link);
  }

  function enhance(form) {
    if (!form || states.has(form)) return states.get(form) || null;
    const compatibilityInput = form.querySelector(COMPATIBILITY_INPUT_SELECTOR);
    const box = form.querySelector(".assistant-composer-box");
    if (!compatibilityInput || !box) return null;

    const app = form.closest("#assistant-app, [data-assistant-app]")
      || document.body;
    const state = {
      form,
      app,
      compatibilityInput,
      pending: null,
      compatibilityFile: null,
      recording: null,
      recordingGeneration: 0,
      locationRequest: null,
      locationGeneration: 0,
      destroyed: false,
      previewUrl: "",
      menuButtons: [],
    };
    const originalAttachmentLabel = compatibilityInput.closest("label");
    if (originalAttachmentLabel) originalAttachmentLabel.hidden = true;

    const root = element("div", "messaging-composer-v2");
    root.dataset.messagingComposerAttachmentsV2 = "true";
    const addButton = element("button", "messaging-composer-v2-add", "+");
    addButton.type = "button";
    addButton.setAttribute("aria-label", text(state, "add"));
    addButton.setAttribute("title", text(state, "add"));
    addButton.setAttribute("aria-haspopup", "menu");
    addButton.setAttribute("aria-expanded", "false");

    const menu = element("div", "messaging-composer-v2-menu");
    menu.hidden = true;
    menu.id = `messaging-composer-v2-menu-${Math.random().toString(36).slice(2)}`;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-orientation", "vertical");
    addButton.setAttribute("aria-controls", menu.id);

    const cameraInput = hiddenFileInput(
      "image/jpeg,image/png,image/webp",
      { capture: "environment" },
    );
    const galleryInput = hiddenFileInput("image/jpeg,image/png,image/webp");
    const fileInput = hiddenFileInput(
      ".pdf,.txt,.csv,application/pdf,text/plain,text/csv",
    );
    cameraInput.dataset.messagingComposerCamera = "true";
    galleryInput.dataset.messagingComposerGallery = "true";
    fileInput.dataset.messagingComposerFile = "true";

    menu.append(
      menuAction(state, text(state, "camera"), "CAM", () => cameraInput.click()),
      menuAction(state, text(state, "gallery"), "IMG", () => galleryInput.click()),
      menuAction(state, text(state, "file"), "DOC", () => fileInput.click()),
      menuAction(state, text(state, "location"), "LOC", () => requestLocation(state)),
      menuAction(state, text(state, "voice"), "WAV", () => startRecording(state)),
    );

    const preview = element("section", "messaging-composer-v2-preview");
    preview.hidden = true;
    const previewMedia = element("div", "messaging-composer-v2-preview-media");
    const previewCopy = element("div", "messaging-composer-v2-preview-copy");
    const previewName = element("strong");
    const previewMeta = element("small");
    previewCopy.append(previewName, previewMeta);
    const previewActions = element("div", "messaging-composer-v2-preview-actions");
    const retryButton = element("button", "messaging-composer-v2-retry", text(state, "retry"));
    retryButton.type = "button";
    retryButton.hidden = true;
    const removeButton = element("button", "messaging-composer-v2-remove", "×");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", text(state, "remove"));
    removeButton.setAttribute("title", text(state, "remove"));
    previewActions.append(retryButton, removeButton);
    preview.append(previewMedia, previewCopy, previewActions);

    const recordPanel = element("section", "messaging-composer-v2-recorder");
    recordPanel.hidden = true;
    const recordPulse = element("span", "messaging-composer-v2-record-pulse");
    recordPulse.setAttribute("aria-hidden", "true");
    const recordCopy = element("div", "messaging-composer-v2-record-copy");
    const recordState = element("strong", "", text(state, "recording"));
    const recordDuration = element("time", "", "00:00");
    recordCopy.append(recordState, recordDuration);
    const recordActions = element("div", "messaging-composer-v2-record-actions");
    const pauseButton = element("button", "", text(state, "pause"));
    const resumeButton = element("button", "", text(state, "resume"));
    const stopButton = element("button", "is-primary", text(state, "stop"));
    const cancelRecordButton = element("button", "", text(state, "cancel"));
    [pauseButton, resumeButton, stopButton, cancelRecordButton].forEach((button) => {
      button.type = "button";
    });
    resumeButton.hidden = true;
    recordActions.append(pauseButton, resumeButton, stopButton, cancelRecordButton);
    recordPanel.append(recordPulse, recordCopy, recordActions);

    const status = element("p", "messaging-composer-v2-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    root.append(addButton, menu);
    box.prepend(root);
    form.insertBefore(preview, box);
    form.insertBefore(recordPanel, box);
    form.append(cameraInput, galleryInput, fileInput, status);

    Object.assign(state, {
      root,
      addButton,
      menu,
      cameraInput,
      galleryInput,
      fileInput,
      preview,
      previewMedia,
      previewName,
      previewMeta,
      retryButton,
      recordPanel,
      recordState,
      recordDuration,
      pauseButton,
      resumeButton,
      stopButton,
      cancelRecordButton,
      status,
    });
    states.set(form, state);

    addButton.addEventListener("click", () => {
      setMenuOpen(state, menu.hidden);
    });
    addButton.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenuOpen(state, true);
      }
    });
    menu.addEventListener("keydown", (event) => {
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      if (!items.length) return;
      const current = Math.max(0, items.indexOf(document.activeElement));
      let next = -1;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(state, false);
        addButton.focus();
        return;
      } else if (event.key === "Tab") {
        event.preventDefault();
        setMenuOpen(state, false);
        if (event.shiftKey) addButton.focus();
        else form.querySelector("[data-message-input]")?.focus();
        return;
      }
      if (next >= 0) {
        event.preventDefault();
        items[next].focus();
      }
    });
    cameraInput.addEventListener("change", () => handleImageSelection(state, cameraInput));
    galleryInput.addEventListener("change", () => handleImageSelection(state, galleryInput));
    fileInput.addEventListener("change", () => handleFileSelection(state));
    removeButton.addEventListener("click", () => clearPending(state));
    retryButton.addEventListener("click", () => form.requestSubmit());
    pauseButton.addEventListener("click", () => pauseRecording(state));
    resumeButton.addEventListener("click", () => resumeRecording(state));
    stopButton.addEventListener("click", () => stopRecording(state));
    cancelRecordButton.addEventListener("click", () => cancelRecording(state));
    form.addEventListener("submit", (event) => {
      if (!state.pending) return;
      setStatus(state, "");
      dispatch(state, "attachment-submit", {
        attachment: pendingPublicContract(state.pending),
      });
    }, true);
    app.addEventListener("timeblock:messaging:message-sent", () => {
      if (state.pending) clearPending(state);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!menu.hidden && !root.contains(event.target)) setMenuOpen(state, false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        setMenuOpen(state, false);
        addButton.focus();
      }
    });
    const repositionMenu = () => {
      if (!menu.hidden) positionMenu(state);
    };
    window.addEventListener("resize", repositionMenu);
    window.visualViewport?.addEventListener("resize", repositionMenu);
    window.visualViewport?.addEventListener("scroll", repositionMenu);
    const callObserver = new MutationObserver(() => {
      if (callIsActive()) {
        setMenuOpen(state, false);
        if (state.recording) cancelRecording(state);
      }
    });
    callObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      state.recordingGeneration += 1;
      state.locationGeneration += 1;
      state.locationRequest = null;
      setMenuOpen(state, false);
      const recording = state.recording;
      if (recording) {
        recording.cancelled = true;
        void disposeRecorder(state, false, recording);
      }
      window.removeEventListener("resize", repositionMenu);
      window.visualViewport?.removeEventListener("resize", repositionMenu);
      window.visualViewport?.removeEventListener("scroll", repositionMenu);
      callObserver.disconnect();
    };
    app.addEventListener("timeblock:messaging:call-state", () => {
      if (callIsActive()) {
        setMenuOpen(state, false);
        if (state.recording) cancelRecording(state);
      }
    });
    window.addEventListener("pagehide", cleanup, { once: true });
    window.addEventListener("beforeunload", cleanup, { once: true });
    return state;
  }

  function bootstrap() {
    ensureStylesheet();
    document.querySelectorAll(FORM_SELECTOR).forEach((form) => enhance(form));
    const observer = new MutationObserver(() => {
      document.querySelectorAll(FORM_SELECTOR).forEach((form) => enhance(form));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  const publicApi = {
    enhance,
    decorateFormData,
    encodePcm16Wav,
    downsamplePcm,
    getPending(form) {
      return pendingPublicContract(states.get(form)?.pending);
    },
    clear(form) {
      const state = states.get(form);
      if (state) clearPending(state);
    },
    dispose(form) {
      const state = states.get(form);
      if (!state) return;
      state.destroyed = true;
      state.recordingGeneration += 1;
      state.locationGeneration += 1;
      state.locationRequest = null;
      const recording = state.recording;
      if (recording) {
        recording.cancelled = true;
        void disposeRecorder(state, false, recording);
      }
    },
  };
  global.TimeblockMessagingComposerAttachmentsV2 = publicApi;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
      bootstrap();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
