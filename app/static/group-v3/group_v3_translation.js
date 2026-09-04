(function installGroupTranslationV2(window, document) {
  "use strict";

  var LANGUAGES = ["vi", "en", "zh-TW"];
  var mounted = new WeakMap();
  var recorder = null;
  var recorderGeneration = 0;
  var tts = window.speechSynthesis || null;

  function translate(key) {
    try {
      var runtime = window.GroupV3Runtime;
      var locale = runtime && runtime.snapshot ? runtime.snapshot().locale : "vi";
      return window.GroupV3I18n.translator(locale)(key);
    } catch (_error) { return key; }
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function snapshot() {
    return window.GroupV3Runtime && window.GroupV3Runtime.snapshot ? window.GroupV3Runtime.snapshot() : null;
  }
  function api(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin", headers: { "Accept": "application/json" } }, options || {}))
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error(payload.detail || "translation_request_failed"); return payload;
      }); });
  }
  function endpoint(runtime, suffix) {
    return "/api/group/spaces/" + encodeURIComponent(runtime.space_id) + "/translation/" + suffix;
  }
  function clientId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "segment-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  function languageOptions(selected) {
    var labels = { vi: translate("vietnamese"), en: translate("english"), "zh-TW": translate("traditionalChinese") };
    return LANGUAGES.map(function (language) {
      return '<option value="' + language + '" ' + (language === selected ? "selected" : "") + ">" + escapeHtml(labels[language]) + "</option>";
    }).join("");
  }
  function statusText(status) {
    var map = { READY: "translationReadyState", RECORDING: "translationRecording", STOPPING: "translationStopping",
      PROCESSING: "translationProcessing", RESULT_READY: "translationResultReady", ERROR: "translationError" };
    return translate(map[status] || status);
  }
  function panelTemplate() {
    var runtime = snapshot() || {}, source = runtime.spoken_language || "vi", target = runtime.target_language || "en";
    return '<section class="group-translation-v2" aria-labelledby="group-translation-v2-title"><div class="group-translation-v2__header"><div><span class="group-translation-v2__eyebrow">' +
      escapeHtml(translate("translationPlugin")) + '</span><h2 id="group-translation-v2-title">' + escapeHtml(translate("translationTextFirst")) +
      '</h2></div><span data-v2-status class="group-translation-v2__status">' + escapeHtml(statusText("READY")) + '</span></div><div class="group-translation-v2__languages"><label><span>' +
      escapeHtml(translate("sourceLanguage")) + '</span><select data-v2-source>' + languageOptions(source) + '</select></label><label><span>' + escapeHtml(translate("targetLanguage")) +
      '</span><select data-v2-target>' + languageOptions(target) + '</select></label></div><div class="group-translation-v2__composer"><textarea data-v2-text rows="2" maxlength="12000" placeholder="' +
      escapeHtml(translate("translationTextPlaceholder")) + '"></textarea><div class="group-translation-v2__actions"><button type="button" class="action-button action-primary" data-v2-action="send">' +
      escapeHtml(translate("translationSend")) + '</button><button type="button" class="action-button action-secondary" data-v2-action="record">' + escapeHtml(translate("translationRecord")) +
      '</button></div></div><label class="group-translation-v2__auto-read"><input type="checkbox" data-v2-auto-read ' + ((snapshot() || {}).auto_read ? "checked" : "") + '> ' + escapeHtml(translate("autoRead")) +
      '</label><div data-v2-error class="group-translation-v2__error" role="alert" hidden></div><div class="group-translation-v2__history" data-v2-history><p class="group-translation-v2__empty">' +
      escapeHtml(translate("historyEmpty")) + '</p></div></section>';
  }
  function setStatus(panel, status) { var node = panel.querySelector("[data-v2-status]"); if (node) node.textContent = statusText(status); panel.dataset.translationState = status; }
  function setError(panel, error) { var node = panel.querySelector("[data-v2-error]"); if (!node) return; node.hidden = !error; node.textContent = error || ""; }
  function renderHistory(panel, segments) {
    var host = panel.querySelector("[data-v2-history]"); if (!host) return;
    if (!segments || !segments.length) { host.innerHTML = '<p class="group-translation-v2__empty">' + escapeHtml(translate("historyEmpty")) + "</p>"; return; }
    host.innerHTML = segments.map(function (item) {
      var translated = item.translated_text == null ? translate("translationPending") : item.translated_text;
      var failed = item.state === "FAILED";
      var retry = failed ? '<button type="button" class="group-translation-v2__retry" data-v2-retry="' + escapeHtml(item.id) + '" data-v2-target-language="' + escapeHtml(item.target_language) + '">' + escapeHtml(translate("translationRetry")) + "</button>" : "";
      return '<article class="group-translation-v2__item ' + (failed ? "is-failed" : "") + '"><div class="group-translation-v2__item-meta"><span>' + escapeHtml(item.source_language) + " → " + escapeHtml(item.target_language) + '</span><span>' + escapeHtml(item.state) +
        '</span></div><p class="group-translation-v2__source">' + escapeHtml(item.source_text) + '</p><p class="group-translation-v2__result">' + escapeHtml(translated) + '</p><div class="group-translation-v2__item-actions"><button type="button" class="group-translation-v2__play" data-v2-play="' + escapeHtml(item.translated_text || "") + '" data-v2-language="' + escapeHtml(item.target_language) + '">' + escapeHtml(translate("translationPlay")) + '</button>' + retry + "</div></article>";
    }).join("");
  }
  function loadHistory(panel) {
    var runtime = snapshot(); if (!runtime || !runtime.space_id || !runtime.runtime_id) return Promise.resolve();
    var query = "v2-history?runtime_kind=" + encodeURIComponent(runtime.runtime_kind) + "&runtime_id=" + encodeURIComponent(runtime.runtime_id) + "&limit=30";
    return api(endpoint(runtime, query)).then(function (payload) { renderHistory(panel, payload.segments || []); }).catch(function () {});
  }
  function saveTarget(panel) {
    var runtime = snapshot(); if (!runtime || !runtime.space_id) return Promise.resolve();
    var source = panel.querySelector("[data-v2-source]").value, target = panel.querySelector("[data-v2-target]").value;
    return api(endpoint(runtime, "profile"), { method: "GET" }).then(function (payload) { var profile = payload.profile || {};
      return api(endpoint(runtime, "profile"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        spoken_language: source, preferred_output_language: target, auto_translate_enabled: Boolean(profile.auto_translate_enabled),
        auto_read_enabled: Boolean(panel.querySelector("[data-v2-auto-read]").checked), show_original_enabled: profile.show_original_enabled !== false }) });
    });
  }
  function submitText(panel) {
    var runtime = snapshot(), control = panel.querySelector("[data-v2-text]"), sourceText = control && control.value.trim();
    if (!runtime || !runtime.space_id || !runtime.runtime_id || !sourceText) return;
    setError(panel, ""); setStatus(panel, "PROCESSING");
    api(endpoint(runtime, "segments/text"), { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": clientId() }, body: JSON.stringify({
      runtime_kind: runtime.runtime_kind, runtime_id: runtime.runtime_id, client_segment_id: clientId(), source_language: panel.querySelector("[data-v2-source]").value, source_text: sourceText })
    }).then(function (payload) { control.value = ""; setStatus(panel, payload.segment && payload.segment.state === "FINAL" ? "RESULT_READY" : "PROCESSING"); if (payload.segment && payload.segment.translated_text && panel.querySelector("[data-v2-auto-read]").checked) play(payload.segment.translated_text, payload.segment.target_language); return loadHistory(panel); })
      .catch(function (error) { setStatus(panel, "ERROR"); setError(panel, error.message); });
  }
  function stopRecording(panel) { if (!recorder) return; setStatus(panel, "STOPPING"); recorder.stop(); }
  function startRecording(panel) {
    var runtime = snapshot(), track = window.GroupV3Runtime && window.GroupV3Runtime.getLocalAudioTrack && window.GroupV3Runtime.getLocalAudioTrack();
    if (!runtime || !runtime.space_id || !runtime.runtime_id || !track || !window.MediaRecorder) { setError(panel, translate("translationMicUnavailable")); return; }
    if (recorder) return;
    var stream; try { stream = new MediaStream([track]); recorder = new MediaRecorder(stream); } catch (error) { setError(panel, error.message); return; }
    var generation = ++recorderGeneration, chunks = [], segmentId = clientId();
    recorder.addEventListener("dataavailable", function (event) { if (event.data && event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", function () {
      var current = recorder; recorder = null;
      if (generation !== recorderGeneration || !chunks.length) { setStatus(panel, "READY"); return; }
      var form = new FormData(); form.append("audio", new Blob(chunks, { type: current.mimeType || "audio/webm" }), "group-translation.webm");
      form.append("runtime_kind", runtime.runtime_kind); form.append("runtime_id", runtime.runtime_id); form.append("client_segment_id", segmentId); form.append("source_language", panel.querySelector("[data-v2-source]").value);
      setStatus(panel, "PROCESSING"); api(endpoint(runtime, "segments/voice"), { method: "POST", body: form }).then(function () { return loadHistory(panel); }).then(function () { setStatus(panel, "RESULT_READY"); }).catch(function (error) { setStatus(panel, "ERROR"); setError(panel, error.message); });
    }, { once: true });
    setError(panel, ""); setStatus(panel, "RECORDING"); recorder.start();
  }
  function play(text, language) { if (!tts || !text) return; if (tts.speaking) { tts.cancel(); return; } var utterance = new SpeechSynthesisUtterance(text); utterance.lang = language === "zh-TW" ? "zh-TW" : language; tts.speak(utterance); }
  function bind(panel) {
    if (mounted.has(panel)) return; mounted.set(panel, true); panel.innerHTML = panelTemplate();
    panel.querySelector('[data-v2-action="send"]').addEventListener("click", function () { saveTarget(panel).then(function () { submitText(panel); }); });
    panel.querySelector('[data-v2-action="record"]').addEventListener("click", function () { if (recorder) stopRecording(panel); else saveTarget(panel).then(function () { startRecording(panel); }); });
    panel.querySelector("[data-v2-target]").addEventListener("change", function () { saveTarget(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.querySelector("[data-v2-source]").addEventListener("change", function () { saveTarget(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.querySelector("[data-v2-auto-read]").addEventListener("change", function () { saveTarget(panel).catch(function (error) { setError(panel, error.message); }); });
    panel.addEventListener("click", function (event) {
      var playButton = event.target.closest("[data-v2-play]"); if (playButton) play(playButton.dataset.v2Play, playButton.dataset.v2Language);
      var retry = event.target.closest("[data-v2-retry]"); if (!retry) return; var runtime = snapshot(); if (!runtime) return;
      setStatus(panel, "PROCESSING"); api(endpoint(runtime, "segments/" + encodeURIComponent(retry.dataset.v2Retry) + "/variants/" + encodeURIComponent(retry.dataset.v2TargetLanguage) + "/retry"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_language: retry.dataset.v2TargetLanguage }) }).then(function () { return loadHistory(panel); }).then(function () { setStatus(panel, "RESULT_READY"); }).catch(function (error) { setStatus(panel, "ERROR"); setError(panel, error.message); });
    });
    loadHistory(panel);
  }
  function mountAll() { document.querySelectorAll("[data-group-translation-v2]").forEach(bind); }
  new MutationObserver(mountAll).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("group-v3:rendered", mountAll);
  function cleanup() { ++recorderGeneration; if (recorder) { try { recorder.stop(); } catch (_error) {} recorder = null; } if (tts) tts.cancel(); }
  window.addEventListener("pagehide", cleanup, { once: true }); window.addEventListener("beforeunload", cleanup, { once: true });
  mountAll();
}(window, document));
