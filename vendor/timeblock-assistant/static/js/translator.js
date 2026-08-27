(function () {
  "use strict";

  var shell = document.querySelector(".translator-shell");
  if (!shell) return;

  var tabs = Array.from(shell.querySelectorAll("[data-mode]"));
  var panels = Array.from(shell.querySelectorAll("[data-panel]"));
  var recorder = null;
  var chunks = [];

  function activate(mode) {
    tabs.forEach(function (tab) { tab.classList.toggle("is-active", tab.dataset.mode === mode); });
    panels.forEach(function (panel) { panel.classList.toggle("is-active", panel.dataset.panel === mode); });
  }

  function quotaTarget(operation, usage) {
    if (operation === "audio" && usage && usage.media_kind === "video") return "video";
    return operation;
  }

  function updateQuota(operation, usage) {
    if (!usage) return;
    var meterName = quotaTarget(operation, usage);
    var meter = shell.querySelector('[data-quota="' + meterName + '"]');
    if (!meter) return;
    var value = meter.querySelector("[data-quota-value]");
    if (value) value.textContent = usage.remaining + "/" + usage.limit;
    var reset = meter.querySelector("[data-reset-at]");
    if (reset && usage.reset_at) {
      reset.dateTime = usage.reset_at;
      reset.dataset.resetAt = usage.reset_at;
      reset.textContent = formatResetAt(usage.reset_at);
    }
  }

  function formatResetAt(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
      return new Intl.DateTimeFormat(shell.dataset.locale || undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  shell.querySelectorAll("[data-reset-at]").forEach(function (node) {
    node.textContent = formatResetAt(node.dataset.resetAt);
  });

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { activate(tab.dataset.mode); });
  });

  shell.querySelectorAll("[data-swap]").forEach(function (button) {
    button.addEventListener("click", function () {
      var panel = button.closest("form");
      var source = panel.elements.source_language;
      var target = panel.elements.target_language;
      if (source.value === "auto") return;
      var value = source.value;
      source.value = target.value;
      target.value = value;
    });
  });

  panels.forEach(function (panel) {
    panel.addEventListener("submit", async function (event) {
      event.preventDefault();
      var operation = panel.dataset.panel;
      var status = panel.querySelector("[data-status]");
      var resultBox = panel.querySelector("[data-result]");
      var submit = panel.querySelector("[type=submit]");
      status.textContent = "";
      resultBox.hidden = true;
      submit.disabled = true;
      try {
        var response = await fetch("/translator/api/" + operation, {
          method: "POST",
          body: new FormData(panel),
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        var payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || shell.dataset.errorDefault);
        panel.querySelector("[data-translation]").textContent = payload.translation || "";
        panel.querySelector("[data-model]").textContent = payload.model || "";
        var transcriptWrap = panel.querySelector("[data-transcript-wrap]");
        transcriptWrap.hidden = !payload.transcript;
        panel.querySelector("[data-transcript]").textContent = payload.transcript || "";
        resultBox.hidden = false;
        updateQuota(operation, payload.usage);
      } catch (error) {
        status.textContent = error.message || shell.dataset.errorDefault;
      } finally {
        submit.disabled = false;
      }
    });

    var copy = panel.querySelector("[data-copy]");
    copy.addEventListener("click", function () {
      var value = panel.querySelector("[data-translation]").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(value);
    });
  });

  var recordButton = shell.querySelector("[data-record]");
  if (recordButton) {
    recordButton.addEventListener("click", async function () {
      var panel = recordButton.closest("form");
      var status = panel.querySelector("[data-record-status]");
      if (recorder && recorder.state === "recording") {
        recorder.stop();
        recordButton.textContent = shell.dataset.recordStart;
        return;
      }
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        status.textContent = shell.dataset.errorDefault;
        return;
      }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.addEventListener("dataavailable", function (event) { if (event.data.size) chunks.push(event.data); });
        recorder.addEventListener("stop", function () {
          var type = recorder.mimeType || "audio/webm";
          var blob = new Blob(chunks, { type: type });
          var extension = type.indexOf("mp4") >= 0 ? "m4a" : "webm";
          var file = new File([blob], "conversation." + extension, { type: type });
          var transfer = new DataTransfer();
          transfer.items.add(file);
          panel.elements.file.files = transfer.files;
          stream.getTracks().forEach(function (track) { track.stop(); });
          status.textContent = shell.dataset.recordStop;
        });
        recorder.start();
        recordButton.textContent = shell.dataset.recordStop;
        status.textContent = shell.dataset.recording;
      } catch (error) {
        status.textContent = shell.dataset.errorDefault;
      }
    });
  }
}());
