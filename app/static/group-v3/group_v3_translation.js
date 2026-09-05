(function installGroupTranslationController(window, document) {
  "use strict";

  var mounted = new WeakMap();
  var activeStates = new Set();
  var autoplaySeen = window.__groupV3AutoplaySeen || (window.__groupV3AutoplaySeen = new Set());
  var initializedRuntimes = window.__groupV3TranslationHistoryBootstrapped || (window.__groupV3TranslationHistoryBootstrapped = new Set());
  var tts = window.speechSynthesis || null;
  var activePlayback = null;

  function runtime() {
    return window.GroupV3Runtime && window.GroupV3Runtime.snapshot ? window.GroupV3Runtime.snapshot() : null;
  }

  function translate(key) {
    try {
      var snapshot = runtime() || {};
      return window.GroupV3I18n.translator(snapshot.locale || "vi")(key);
    } catch (_error) {
      return key;
    }
  }

  function runtimeKey(snapshot) {
    snapshot = snapshot || {};
    var kind = String(snapshot.runtime_kind || "group");
    var id = String(snapshot.runtime_id || snapshot.space_id || "none");
    return kind + ":" + id;
  }

  function uuid() {
    return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() :
      "segment-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function labels() {
    return {
      vi: translate("vietnamese"),
      en: translate("english"),
      "zh-TW": translate("traditionalChinese"),
      author: translate("translationAuthor"),
      received: translate("translationReceived"),
      original: translate("translationOriginal"),
      distributed: translate("translationDistributed"),
      showOriginal: translate("translationShowOriginal"),
      pending: translate("translationPending"),
      recipients: translate("recipients"),
      play: translate("translationPlay"),
      retry: translate("translationRetry")
    };
  }

  function stateFor(panel, snapshot) {
    var current = mounted.get(panel);
    var key = runtimeKey(snapshot);
    if (current && current.runtimeKey !== key) {
      disposeState(current);
      current = null;
    }
    if (!current) {
      current = {
        panel: panel,
        runtimeKey: key,
        generation: 0,
        historyLoaded: false,
        submitting: false,
        recording: null,
        requests: new Set(),
        ttsText: "",
        ttsKey: "",
        ttsPlaying: false,
        disposed: false
      };
      mounted.set(panel, current);
      activeStates.add(current);
    }
    current.panel = panel;
    return current;
  }

  function isCurrent(panel, state, generation) {
    var snapshot = runtime();
    return Boolean(snapshot && mounted.get(panel) === state && !state.disposed &&
      state.runtimeKey === runtimeKey(snapshot) && state.generation === generation);
  }

  function statusText(status) {
    var key = {
      READY: "translationReadyState",
      RECORDING: "translationRecording",
      STOPPING: "translationStopping",
      PROCESSING: "translationProcessing",
      RESULT_READY: "translationResultReady",
      ERROR: "translationError"
    }[status];
    return translate(key || status);
  }

  function setStatus(panel, status) {
    panel.dataset.translationState = status;
    var node = panel.querySelector("[data-v2-status]");
    if (node) node.textContent = statusText(status);
  }

  function setError(panel, message) {
    var node = panel.querySelector("[data-v2-error]");
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
  }

  function errorText(error, fallbackKey) {
    if (error && error.name === "AbortError") return "";
    var code = String(error && (error.code || error.message) || "").toLowerCase();
    var known = {
      translation_request_failed: "translationError",
      group_translation_history_failed: "translationHistoryError",
      group_translation_profile_failed: "translationProfileError",
      group_translation_runtime_not_active: "translationUnavailable",
      group_translation_participant_required: "translationUnavailable",
      group_translation_voice_consent_required: "translationConsentRequired",
      group_translation_provider_not_configured: "translationProviderUnavailable"
    };
    var key = known[code] || fallbackKey || "translationError";
    var value = translate(key);
    return value === key ? translate("translationError") : value;
  }

  function api(path, options, state) {
    options = options || {};
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var init = Object.assign({}, options, { credentials: "same-origin", cache: "no-store" });
    init.headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (controller) {
      init.signal = controller.signal;
      if (state) state.requests.add(controller);
    }
    return fetch(path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(String(payload.detail || payload.error || "translation_request_failed"));
          error.code = String(payload.detail || payload.error || "translation_request_failed");
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    }).finally(function () {
      if (controller && state) state.requests.delete(controller);
    });
  }

  function endpoint(snapshot, suffix) {
    return "/api/group/spaces/" + encodeURIComponent(snapshot.space_id) + "/translation/" + suffix;
  }

  function translationAvailable(panel, snapshot) {
    if (!snapshot || !snapshot.space_id || !snapshot.runtime_id) return false;
    if (document.querySelector(".prejoin-backdrop")) return false;
    var content = panel.closest(".chat-content, .radio-content");
    if (!content) return true;
    var classes = String(content.className || "");
    return !/(state-ringing|state-connecting|state-prejoin|state-answering)/i.test(classes) &&
      !content.querySelector(".incoming-stage, .decision-stage");
  }

  function setAvailability(panel, available) {
    var message = panel.querySelector("[data-v2-availability]");
    var controls = panel.querySelectorAll("textarea, select, input, button[data-v2-action]");
    controls.forEach(function (control) { control.disabled = !available; });
    if (!message) return;
    message.hidden = available;
    message.textContent = available ? "" : translate("translationUnavailable");
  }

  function renderHistory(panel, segments) {
    var host = panel.querySelector("[data-v2-history]");
    if (!host) return;
    if (!segments || !segments.length) {
      host.innerHTML = '<p class="group-translation-v2__empty">' +
        String(translate("historyEmpty")).replaceAll("<", "&lt;") + "</p>";
      return;
    }
    host.innerHTML = segments.map(function (item) {
      return window.GroupV3TranslationView.historyItem(item, labels());
    }).join("");
  }

  function playbackKey(snapshot, item) {
    return runtimeKey(snapshot) + ":" + String(item && item.id || "") + ":" +
      String(item && (item.display_language || item.target_language) || "") + ":" + String(item && item.state || "FINAL");
  }

  function setButtonPlayback(panel, text, playing) {
    panel.querySelectorAll("[data-v2-play]").forEach(function (button) {
      if (button.dataset.v2Play === text) button.setAttribute("aria-pressed", String(playing));
    });
  }

  function stopPlayback() {
    if (tts) tts.cancel();
    if (activePlayback && activePlayback.panel) {
      activePlayback.state.ttsPlaying = false;
      activePlayback.state.ttsText = "";
      activePlayback.state.ttsKey = "";
      setButtonPlayback(activePlayback.panel, activePlayback.text, false);
    }
    activePlayback = null;
  }

  function play(text, language, panel, automatic, key) {
    var state = mounted.get(panel);
    if (!text || !state || state.disposed) return false;
    if (!tts || typeof window.SpeechSynthesisUtterance !== "function") {
      setError(panel, translate("translationTtsUnavailable"));
      return false;
    }
    if (state.ttsPlaying && state.ttsText === text) {
      stopPlayback();
      return true;
    }
    stopPlayback();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "zh-TW" ? "zh-TW" : language || "en";
    state.ttsPlaying = true;
    state.ttsText = text;
    state.ttsKey = key || "";
    activePlayback = { panel: panel, state: state, text: text, key: key || "" };
    setButtonPlayback(panel, text, true);
    utterance.onend = utterance.onerror = function () {
      if (activePlayback && activePlayback.state === state && activePlayback.text === text) stopPlayback();
    };
    tts.speak(utterance);
    if (!automatic) setError(panel, "");
    return true;
  }

  function maybeAutoRead(segments, panel, snapshot) {
    if (!snapshot || !snapshot.auto_read) return;
    var key = runtimeKey(snapshot);
    var bootstrap = !initializedRuntimes.has(key);
    var candidate = null;
    (segments || []).forEach(function (item) {
      if (!item || item.state !== "FINAL" || item.author_view || !item.translated_text ||
        String(item.speaker_membership_id || "") === String(snapshot.membership_id || "")) return;
      var playback = playbackKey(snapshot, item);
      if (bootstrap) {
        autoplaySeen.add(playback);
      } else if (!autoplaySeen.has(playback)) {
        autoplaySeen.add(playback);
        if (!candidate) candidate = item;
      }
    });
    initializedRuntimes.add(key);
    if (candidate) {
      play(candidate.translated_text, candidate.display_language || candidate.target_language, panel, true, playbackKey(snapshot, candidate));
    }
  }

  function loadHistory(panel) {
    var snapshot = runtime();
    var state = stateFor(panel, snapshot);
    if (!translationAvailable(panel, snapshot)) {
      setAvailability(panel, false);
      return Promise.resolve([]);
    }
    setAvailability(panel, true);
    var generation = state.generation;
    var query = "v2-history?runtime_kind=" + encodeURIComponent(snapshot.runtime_kind) +
      "&runtime_id=" + encodeURIComponent(snapshot.runtime_id) + "&limit=50";
    return api(endpoint(snapshot, query), {}, state).then(function (payload) {
      if (!isCurrent(panel, state, generation)) return [];
      var segments = payload.segments || [];
      renderHistory(panel, segments);
      maybeAutoRead(segments, panel, snapshot);
      state.historyLoaded = true;
      setError(panel, "");
      return segments;
    }).catch(function (error) {
      if (!isCurrent(panel, state, generation) || error.name === "AbortError") return [];
      setError(panel, errorText(error, "translationHistoryError"));
      return [];
    });
  }

  function syncSharedProfile(profile) {
    if (!profile) return;
    if (window.GroupV3Runtime && typeof window.GroupV3Runtime.updateProfile === "function") {
      window.GroupV3Runtime.updateProfile(profile);
    }
    window.dispatchEvent(new CustomEvent("group-v3:profile-updated", { detail: profile }));
  }

  function saveProfile(panel) {
    var snapshot = runtime();
    var state = mounted.get(panel);
    if (!snapshot || !state || !snapshot.space_id) return Promise.reject(new Error("translationUnavailable"));
    var source = panel.querySelector("[data-v2-source]");
    var target = panel.querySelector("[data-v2-target]");
    var autoRead = panel.querySelector("[data-v2-auto-read]");
    return api(endpoint(snapshot, "profile"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spoken_language: source && source.value || snapshot.spoken_language || "vi",
        preferred_output_language: target && target.value || snapshot.target_language || "vi",
        auto_translate_enabled: Boolean(snapshot.auto_translate),
        auto_read_enabled: Boolean(autoRead && autoRead.checked),
        show_original_enabled: true
      })
    }, state).then(function (payload) {
      syncSharedProfile(payload.profile);
      setError(panel, "");
      return payload.profile;
    });
  }

  function mergeSegment(panel, item) {
    if (!item) return;
    var host = panel.querySelector("[data-v2-history]");
    if (!host) return;
    var existing = Array.from(host.querySelectorAll("[data-segment-id]")).find(function (node) {
      return node.dataset.segmentId === String(item.id || "");
    });
    var html = window.GroupV3TranslationView.historyItem(item, labels());
    if (existing) existing.outerHTML = html;
    else host.insertAdjacentHTML("afterbegin", html);
  }

  function submitText(panel) {
    var snapshot = runtime();
    var state = mounted.get(panel);
    var text = panel.querySelector("[data-v2-text]");
    var source = panel.querySelector("[data-v2-source]");
    var sourceText = text && String(text.value || "").trim();
    if (!translationAvailable(panel, snapshot)) {
      setError(panel, translate("translationUnavailable"));
      return Promise.reject(new Error("translationUnavailable"));
    }
    if (!snapshot || !state || !snapshot.space_id || !snapshot.runtime_id || !sourceText || state.submitting) return Promise.resolve(null);
    state.submitting = true;
    var clientSegmentId = uuid();
    setError(panel, "");
    setStatus(panel, "PROCESSING");
    return api(endpoint(snapshot, "segments/text"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": clientSegmentId },
      body: JSON.stringify({
        runtime_kind: snapshot.runtime_kind,
        runtime_id: snapshot.runtime_id,
        client_segment_id: clientSegmentId,
        source_language: source && source.value || snapshot.spoken_language || "vi",
        source_text: sourceText
      })
    }, state).then(function (payload) {
      if (text) text.value = "";
      var item = payload.segment;
      mergeSegment(panel, item);
      setStatus(panel, item && item.state === "FINAL" ? "RESULT_READY" : "PROCESSING");
      return loadHistory(panel).then(function () { return item; });
    }).catch(function (error) {
      if (error.name !== "AbortError") {
        setStatus(panel, "ERROR");
        setError(panel, errorText(error));
      }
      throw error;
    }).finally(function () {
      state.submitting = false;
    });
  }

  function stopRecording(panel) {
    var state = mounted.get(panel);
    var recording = state && state.recording;
    if (!recording || !recording.recorder) return;
    setStatus(panel, "STOPPING");
    try {
      if (recording.recorder.state !== "inactive") recording.recorder.stop();
    } catch (error) {
      state.recording = null;
      setStatus(panel, "ERROR");
      setError(panel, errorText(error));
    }
  }

  function startRecording(panel) {
    var snapshot = runtime();
    var state = mounted.get(panel);
    var track = window.GroupV3Runtime && window.GroupV3Runtime.getLocalAudioTrack && window.GroupV3Runtime.getLocalAudioTrack();
    if (!translationAvailable(panel, snapshot) || !snapshot || !state || !track || track.readyState === "ended" || !window.MediaRecorder || typeof window.MediaStream !== "function") {
      setError(panel, translate("translationMicUnavailable"));
      return;
    }
    if (state.recording) return;
    var mediaStream;
    var recorder;
    try {
      mediaStream = new MediaStream([track]);
      recorder = new MediaRecorder(mediaStream);
    } catch (error) {
      setError(panel, errorText(error));
      return;
    }
    var generation = ++state.generation;
    var chunks = [];
    var segmentId = uuid();
    var source = panel.querySelector("[data-v2-source]");
    var recording = { recorder: recorder, generation: generation, snapshot: snapshot, segmentId: segmentId, chunks: chunks };
    state.recording = recording;
    recorder.addEventListener("dataavailable", function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", function () {
      if (state.recording === recording) state.recording = null;
      if (!isCurrent(panel, state, generation) || !chunks.length) {
        if (isCurrent(panel, state, generation)) setStatus(panel, "READY");
        return;
      }
      var form = new FormData();
      form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "group-translation.webm");
      form.append("runtime_kind", snapshot.runtime_kind);
      form.append("runtime_id", snapshot.runtime_id);
      form.append("client_segment_id", segmentId);
      form.append("source_language", source && source.value || snapshot.spoken_language || "vi");
      setStatus(panel, "PROCESSING");
      api(endpoint(snapshot, "segments/voice"), {
        method: "POST",
        headers: { "Idempotency-Key": segmentId },
        body: form
      }, state).then(function (payload) {
        if (!isCurrent(panel, state, generation)) return null;
        mergeSegment(panel, payload.segment);
        return loadHistory(panel).then(function () { return payload.segment; });
      }).then(function () {
        if (isCurrent(panel, state, generation)) setStatus(panel, "RESULT_READY");
      }).catch(function (error) {
        if (isCurrent(panel, state, generation) && error.name !== "AbortError") {
          setStatus(panel, "ERROR");
          setError(panel, errorText(error));
        }
      });
      // The temporary MediaStream wraps the active Group track. Its recorder
      // is disposable; the Group runtime remains the sole track owner.
    }, { once: true });
    setError(panel, "");
    setStatus(panel, "RECORDING");
    try {
      recorder.start();
    } catch (error) {
      state.recording = null;
      setStatus(panel, "ERROR");
      setError(panel, errorText(error));
    }
  }

  function handleFailure(panel, error) {
    if (!error || error.name === "AbortError") return;
    setError(panel, errorText(error));
    if (panel.dataset.translationState !== "RECORDING" && panel.dataset.translationState !== "STOPPING") setStatus(panel, "ERROR");
  }

  function bind(panel) {
    var snapshot = runtime();
    if (!snapshot) return;
    var existing = mounted.get(panel);
    if (existing && existing.runtimeKey === runtimeKey(snapshot) && !existing.disposed) return;
    if (existing) disposeState(existing);
    var state = stateFor(panel, snapshot);
    panel.dataset.translationRuntime = state.runtimeKey;
    panel.innerHTML = window.GroupV3TranslationView.panel({
      title: translate("translationPlugin"),
      subtitle: translate("translationTextFirst"),
      readyLabel: statusText("READY"),
      source: snapshot.spoken_language || "vi",
      target: snapshot.target_language || "vi",
      autoRead: Boolean(snapshot.auto_read),
      labels: labels(),
      sourceLabel: translate("spokenLanguageLabel"),
      targetLabel: translate("preferredOutputLabel"),
      placeholder: translate("translationTextPlaceholder"),
      sendLabel: translate("translationSend"),
      recordLabel: translate("translationRecord"),
      autoReadLabel: translate("autoReadRecipient"),
      emptyLabel: translate("historyEmpty")
    });
    setAvailability(panel, translationAvailable(panel, snapshot));
    panel.querySelector('[data-v2-action="send"]').addEventListener("click", function () {
      saveProfile(panel).then(function () { return submitText(panel); }).catch(function (error) { handleFailure(panel, error); });
    });
    panel.querySelector('[data-v2-action="record"]').addEventListener("click", function (event) {
      var current = mounted.get(panel);
      if (current && current.recording) stopRecording(panel);
      else saveProfile(panel).then(function () { startRecording(panel); }).catch(function (error) { handleFailure(panel, error); });
      event.currentTarget.setAttribute("aria-pressed", String(Boolean(current && !current.recording)));
    });
    ["[data-v2-target]", "[data-v2-source]", "[data-v2-auto-read]"].forEach(function (selector) {
      var control = panel.querySelector(selector);
      if (control) control.addEventListener("change", function () {
        saveProfile(panel).catch(function (error) { handleFailure(panel, error); });
      });
    });
    panel.addEventListener("click", function (event) {
      var playButton = event.target.closest && event.target.closest("[data-v2-play]");
      if (playButton) {
        play(playButton.dataset.v2Play, playButton.dataset.v2Language, panel, false, "manual");
        return;
      }
      var retry = event.target.closest && event.target.closest("[data-v2-retry]");
      if (!retry) return;
      var currentSnapshot = runtime();
      var currentState = mounted.get(panel);
      if (!currentSnapshot || !currentState) return;
      setStatus(panel, "PROCESSING");
      api(endpoint(currentSnapshot, "segments/" + encodeURIComponent(retry.dataset.v2Retry) + "/variants/" + encodeURIComponent(retry.dataset.v2TargetLanguage) + "/retry"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_language: retry.dataset.v2TargetLanguage })
      }, currentState).then(function (payload) {
        mergeSegment(panel, payload.segment);
        return loadHistory(panel);
      }).then(function () { setStatus(panel, "RESULT_READY"); }).catch(function (error) { handleFailure(panel, error); });
    });
    loadHistory(panel);
  }

  function disposeState(state) {
    if (!state || state.disposed) return;
    state.disposed = true;
    state.generation += 1;
    state.requests.forEach(function (controller) { try { controller.abort(); } catch (_error) {} });
    state.requests.clear();
    if (state.recording && state.recording.recorder) {
      try {
        if (state.recording.recorder.state !== "inactive") state.recording.recorder.stop();
      } catch (_error) {}
    }
    state.recording = null;
    if (activePlayback && activePlayback.state === state) stopPlayback();
    activeStates.delete(state);
  }

  function cleanupDetached() {
    activeStates.forEach(function (state) {
      if (!state.panel || !document.documentElement.contains(state.panel)) disposeState(state);
    });
  }

  function mountAll() {
    cleanupDetached();
    document.querySelectorAll("[data-group-translation-v2]").forEach(bind);
  }

  function cleanup() {
    activeStates.forEach(disposeState);
    stopPlayback();
  }

  window.addEventListener("group-v3:rendered", mountAll);
  window.addEventListener("group-video-layout:change", mountAll);
  window.addEventListener("group-v3:media-disconnected", cleanup);
  window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("beforeunload", cleanup, { once: true });
  new MutationObserver(mountAll).observe(document.documentElement, { childList: true, subtree: true });
  window.GroupV3TranslationController = Object.freeze({ mountAll: mountAll, loadHistory: loadHistory, cleanup: cleanup, play: play, stopPlayback: stopPlayback });
  mountAll();
}(window, document));
