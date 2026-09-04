(function installGroupTranslationController(window, document) {
  "use strict";

  var mounted = new WeakMap();
  var recorders = new WeakMap();
  var activeRecorders = new Set();
  var tts = window.speechSynthesis || null;
  var autoplaySeen = window.__groupV3AutoplaySeen || (window.__groupV3AutoplaySeen = new Set());

  function runtime() {
    return window.GroupV3Runtime && window.GroupV3Runtime.snapshot ? window.GroupV3Runtime.snapshot() : null;
  }

  function translate(key) {
    try {
      var snapshot = runtime() || {};
      return window.GroupV3I18n.translator(snapshot.locale || "vi")(key);
    } catch (_error) { return key; }
  }

  function api(path, options) {
    options = options || {};
    return fetch(path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options, {
      headers: Object.assign({ Accept: "application/json" }, options.headers || {})
    })).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(String(payload.detail || payload.error || "translation_request_failed"));
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    });
  }

  function endpoint(snapshot, suffix) {
    return "/api/group/spaces/" + encodeURIComponent(snapshot.space_id) + "/translation/" + suffix;
  }

  function uuid() {
    return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() :
      "segment-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function labels() {
    return { vi: translate("vietnamese"), en: translate("english"), "zh-TW": translate("traditionalChinese") };
  }

  function stateFor(panel) {
    var value = mounted.get(panel);
    if (!value) {
      value = { generation: 0, historyLoaded: false, ttsText: "", ttsPlaying: false };
      mounted.set(panel, value);
    }
    return value;
  }

  function statusText(status) {
    var key = { READY: "translationReadyState", RECORDING: "translationRecording", STOPPING: "translationStopping", PROCESSING: "translationProcessing", RESULT_READY: "translationResultReady", ERROR: "translationError" }[status];
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

  function escapeHtml(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function renderHistory(panel, segments) {
    var host = panel.querySelector("[data-v2-history]");
    if (!host) return;
    if (!segments || !segments.length) {
      host.innerHTML = '<p class="group-translation-v2__empty">' + escapeHtml(translate("historyEmpty")) + "</p>";
      return;
    }
    host.innerHTML = segments.map(function (item) {
      return window.GroupV3TranslationView.historyItem(item, {
        pending: translate("translationPending"), recipients: translate("recipients"),
        play: translate("translationPlay"), retry: translate("translationRetry")
      });
    }).join("");
  }

  function playable(item, snapshot) {
    return item && item.state === "FINAL" && item.translated_text && item.speaker_membership_id &&
      String(item.speaker_membership_id) !== String(snapshot.membership_id || "") && Boolean(snapshot.auto_read);
  }

  function maybeAutoRead(segments, panel, initial) {
    var snapshot = runtime() || {};
    if (initial || !snapshot.auto_read) {
      (segments || []).forEach(function (item) {
        if (item && item.id) autoplaySeen.add(String(item.id) + ":" + String(item.target_language || ""));
      });
      return;
    }
    (segments || []).forEach(function (item) {
      var key = item && item.id ? String(item.id) + ":" + String(item.target_language || "") : "";
      if (!key || autoplaySeen.has(key) || !playable(item, snapshot)) return;
      autoplaySeen.add(key);
      play(item.translated_text, item.target_language, panel, true);
    });
  }

  function loadHistory(panel) {
    var snapshot = runtime();
    if (!snapshot || !snapshot.space_id || !snapshot.runtime_id) return Promise.resolve([]);
    var state = stateFor(panel);
    var query = "v2-history?runtime_kind=" + encodeURIComponent(snapshot.runtime_kind) + "&runtime_id=" + encodeURIComponent(snapshot.runtime_id) + "&limit=30";
    return api(endpoint(snapshot, query)).then(function (payload) {
      var segments = payload.segments || [];
      renderHistory(panel, segments);
      maybeAutoRead(segments, panel, !state.historyLoaded);
      state.historyLoaded = true;
      setError(panel, "");
      return segments;
    }).catch(function (error) {
      setError(panel, String(error.message || translate("statusError")));
      return [];
    });
  }

  function saveProfile(panel) {
    var snapshot = runtime();
    if (!snapshot || !snapshot.space_id) return Promise.resolve();
    var source = panel.querySelector("[data-v2-source]");
    var target = panel.querySelector("[data-v2-target]");
    var autoRead = panel.querySelector("[data-v2-auto-read]");
    return api(endpoint(snapshot, "profile"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      spoken_language: source && source.value || snapshot.spoken_language || "vi",
      preferred_output_language: target && target.value || snapshot.target_language || "en",
      auto_translate_enabled: Boolean(snapshot.auto_translate), auto_read_enabled: Boolean(autoRead && autoRead.checked), show_original_enabled: true
    }) });
  }

  function mergeSegment(panel, item) {
    var host = panel.querySelector("[data-v2-history]");
    if (!host || !item) return;
    var existing = host.querySelector('[data-segment-id="' + CSS.escape(String(item.id || "")) + '"]');
    var html = window.GroupV3TranslationView.historyItem(item, { pending: translate("translationPending"), recipients: translate("recipients"), play: translate("translationPlay"), retry: translate("translationRetry") });
    if (existing) existing.outerHTML = html;
    else host.insertAdjacentHTML("afterbegin", html);
  }

  function submitText(panel) {
    var snapshot = runtime();
    var text = panel.querySelector("[data-v2-text]");
    var source = panel.querySelector("[data-v2-source]");
    var sourceText = text && text.value.trim();
    if (!snapshot || !snapshot.space_id || !snapshot.runtime_id || !sourceText) return Promise.resolve();
    var clientSegmentId = uuid();
    setError(panel, ""); setStatus(panel, "PROCESSING");
    return api(endpoint(snapshot, "segments/text"), { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": clientSegmentId }, body: JSON.stringify({
      runtime_kind: snapshot.runtime_kind, runtime_id: snapshot.runtime_id, client_segment_id: clientSegmentId,
      source_language: source && source.value || snapshot.spoken_language || "vi", source_text: sourceText
    }) }).then(function (payload) {
      if (text) text.value = "";
      var item = payload.segment;
      mergeSegment(panel, item);
      setStatus(panel, item && item.state === "FINAL" ? "RESULT_READY" : "PROCESSING");
      return loadHistory(panel).then(function () { return item; });
    }).catch(function (error) {
      setStatus(panel, "ERROR"); setError(panel, String(error.message || translate("statusError"))); throw error;
    });
  }

  function stopRecording(panel) {
    var recorder = recorders.get(panel);
    if (!recorder) return;
    setStatus(panel, "STOPPING");
    try { recorder.stop(); } catch (_error) { recorders.delete(panel); }
  }

  function startRecording(panel) {
    var snapshot = runtime();
    var track = window.GroupV3Runtime && window.GroupV3Runtime.getLocalAudioTrack && window.GroupV3Runtime.getLocalAudioTrack();
    if (!snapshot || !snapshot.space_id || !snapshot.runtime_id || !track || !window.MediaRecorder) { setError(panel, translate("translationMicUnavailable")); return; }
    if (recorders.has(panel)) return;
    var mediaStream, recorder;
    try { mediaStream = new MediaStream([track]); recorder = new MediaRecorder(mediaStream); }
    catch (error) { setError(panel, String(error.message || translate("translationMicUnavailable"))); return; }
    var state = stateFor(panel), generation = ++state.generation, chunks = [], segmentId = uuid();
    recorders.set(panel, recorder);
    activeRecorders.add(recorder);
    recorder.addEventListener("dataavailable", function (event) { if (event.data && event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", function () {
      if (recorders.get(panel) === recorder) recorders.delete(panel);
      activeRecorders.delete(recorder);
      if (generation !== state.generation || !chunks.length) { setStatus(panel, "READY"); return; }
      var form = new FormData();
      form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "group-translation.webm");
      form.append("runtime_kind", snapshot.runtime_kind); form.append("runtime_id", snapshot.runtime_id);
      form.append("client_segment_id", segmentId); form.append("source_language", panel.querySelector("[data-v2-source]").value);
      setStatus(panel, "PROCESSING");
      api(endpoint(snapshot, "segments/voice"), { method: "POST", body: form }).then(function (payload) {
        if (generation !== state.generation) return;
        mergeSegment(panel, payload.segment);
        return loadHistory(panel);
      }).then(function () { if (generation === state.generation) setStatus(panel, "RESULT_READY"); }).catch(function (error) {
        if (generation === state.generation) { setStatus(panel, "ERROR"); setError(panel, String(error.message || translate("statusError"))); }
      });
      // The temporary MediaStream wraps the active Call track. Never stop it here.
    }, { once: true });
    setError(panel, ""); setStatus(panel, "RECORDING"); recorder.start();
  }

  function play(text, language, panel, automatic) {
    if (!tts || !text) return;
    var state = stateFor(panel);
    if (state.ttsPlaying && state.ttsText === text) { tts.cancel(); state.ttsPlaying = false; state.ttsText = ""; return; }
    tts.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "zh-TW" ? "zh-TW" : language || "en";
    state.ttsPlaying = true; state.ttsText = text;
    utterance.onend = utterance.onerror = function () { state.ttsPlaying = false; state.ttsText = ""; };
    tts.speak(utterance);
    if (!automatic) setError(panel, "");
  }

  function bind(panel) {
    if (mounted.has(panel)) return;
    var snapshot = runtime() || {};
    mounted.set(panel, { generation: 0, historyLoaded: false, ttsText: "", ttsPlaying: false });
    panel.innerHTML = window.GroupV3TranslationView.panel({
      title: translate("translationPlugin"), subtitle: translate("translationTextFirst"), readyLabel: statusText("READY"),
      source: snapshot.spoken_language || "vi", target: snapshot.target_language || "en", autoRead: Boolean(snapshot.auto_read), labels: labels(),
      sourceLabel: translate("sourceLanguage"), targetLabel: translate("targetLanguage"), placeholder: translate("translationTextPlaceholder"),
      sendLabel: translate("translationSend"), recordLabel: translate("translationRecord"), autoReadLabel: translate("autoReadRecipient"), emptyLabel: translate("historyEmpty")
    });
    panel.querySelector('[data-v2-action="send"]').addEventListener("click", function () { saveProfile(panel).then(function () { return submitText(panel); }).catch(function () {}); });
    panel.querySelector('[data-v2-action="record"]').addEventListener("click", function (event) {
      var recorder = recorders.get(panel);
      if (recorder) stopRecording(panel); else saveProfile(panel).then(function () { startRecording(panel); }).catch(function (error) { setError(panel, error.message); });
      event.currentTarget.setAttribute("aria-pressed", String(Boolean(!recorder)));
    });
    panel.querySelector("[data-v2-target]").addEventListener("change", function () { saveProfile(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.querySelector("[data-v2-source]").addEventListener("change", function () { saveProfile(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.querySelector("[data-v2-auto-read]").addEventListener("change", function () { saveProfile(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.addEventListener("click", function (event) {
      var playButton = event.target.closest("[data-v2-play]");
      if (playButton) play(playButton.dataset.v2Play, playButton.dataset.v2Language, panel, false);
      var retry = event.target.closest("[data-v2-retry]");
      if (!retry) return;
      var current = runtime(); if (!current) return;
      setStatus(panel, "PROCESSING");
      api(endpoint(current, "segments/" + encodeURIComponent(retry.dataset.v2Retry) + "/variants/" + encodeURIComponent(retry.dataset.v2TargetLanguage) + "/retry"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_language: retry.dataset.v2TargetLanguage }) }).then(function (payload) {
        mergeSegment(panel, payload.segment); return loadHistory(panel);
      }).then(function () { setStatus(panel, "RESULT_READY"); }).catch(function (error) { setStatus(panel, "ERROR"); setError(panel, error.message); });
    });
    loadHistory(panel);
  }

  function mountAll() { document.querySelectorAll("[data-group-translation-v2]").forEach(bind); }
  function cleanup() {
    activeRecorders.forEach(function (recorder) { try { recorder.stop(); } catch (_error) {} });
    activeRecorders.clear();
    recorders = new WeakMap();
    mounted = new WeakMap();
    if (tts) tts.cancel();
  }

  window.addEventListener("group-v3:rendered", mountAll);
  window.addEventListener("group-video-layout:change", mountAll);
  window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("beforeunload", cleanup, { once: true });
  new MutationObserver(mountAll).observe(document.documentElement, { childList: true, subtree: true });
  window.GroupV3TranslationController = Object.freeze({ mountAll: mountAll, loadHistory: loadHistory, cleanup: cleanup, play: play });
  mountAll();
}(window, document));
