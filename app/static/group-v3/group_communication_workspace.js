(function installGroupCommunicationWorkspace(window, document) {
  "use strict";

  var VIDEO_MODES = ["COMPACT", "BALANCED", "FULL"];
  var TRANSLATION_MODES = ["COLLAPSED", "HALF", "FULL"];
  var state = {
    videoMode: "BALANCED",
    translationMode: "COLLAPSED",
    radioTranslationMode: "COLLAPSED",
    orientation: "portrait",
    keyboardOpen: false,
    active: false,
    surface: ""
  };

  function clampIndex(list, value) {
    var index = list.indexOf(String(value || "").toUpperCase());
    return index < 0 ? 0 : index;
  }

  function emit() {
    apply();
    window.dispatchEvent(new CustomEvent("group-workspace:change", {
      detail: snapshot()
    }));
  }

  function snapshot() {
    return Object.assign({}, state);
  }

  function setVideoMode(next) {
    var mode = VIDEO_MODES[clampIndex(VIDEO_MODES, next)];
    state.videoMode = mode;
    if (mode === "FULL") state.translationMode = "COLLAPSED";
    emit();
    return snapshot();
  }

  function setTranslationMode(next, radio) {
    var mode = TRANSLATION_MODES[clampIndex(TRANSLATION_MODES, next)];
    if (radio) state.radioTranslationMode = mode;
    else state.translationMode = mode;
    if (!radio && mode === "FULL") state.videoMode = "COMPACT";
    emit();
    return snapshot();
  }

  function stepVideo(delta) {
    var index = clampIndex(VIDEO_MODES, state.videoMode) + Number(delta || 0);
    index = Math.max(0, Math.min(VIDEO_MODES.length - 1, index));
    return setVideoMode(VIDEO_MODES[index]);
  }

  function stepTranslation(delta, radio) {
    var current = radio ? state.radioTranslationMode : state.translationMode;
    var index = clampIndex(TRANSLATION_MODES, current) + Number(delta || 0);
    index = Math.max(0, Math.min(TRANSLATION_MODES.length - 1, index));
    return setTranslationMode(TRANSLATION_MODES[index], radio);
  }

  function apply(target) {
    target = target || document.getElementById("group-native-app");
    if (!target) return snapshot();
    var native = target.querySelector(".native-app");
    var surface = native && native.dataset.state || "";
    var media = Boolean(native && native.querySelector(".video-call-layout, .radio-content.state-ready, .radio-content.state-talking, .radio-content.state-floor_busy, .radio-content.state-finalizing_burst"));
    state.active = media && (surface === "video" || surface === "radio");
    state.surface = surface;
    state.orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    state.keyboardOpen = document.body.classList.contains("group-keyboard-open");
    target.dataset.videoMode = state.videoMode;
    target.dataset.translationMode = state.translationMode;
    target.dataset.radioTranslationMode = state.radioTranslationMode;
    target.dataset.communicationMode = state.active ? "IMMERSIVE" : "NORMAL";
    var videoShell = target.querySelector(".video-call-layout");
    var translationShell = target.querySelector(".translation-dock");
    var radioTranslationShell = target.querySelector(".radio-translation-card");
    if (videoShell) videoShell.dataset.videoMode = state.videoMode;
    if (translationShell) {
      translationShell.dataset.translationMode = state.translationMode;
      var translationLabel = translationShell.querySelector("[data-translation-mode-label]");
      if (translationLabel) translationLabel.textContent = state.translationMode;
      translationShell.querySelectorAll('[data-workspace-action="translation-minus"]').forEach(function (button) { button.disabled = state.translationMode === "COLLAPSED"; });
      translationShell.querySelectorAll('[data-workspace-action="translation-plus"]').forEach(function (button) { button.disabled = state.translationMode === "FULL"; });
    }
    if (radioTranslationShell) {
      radioTranslationShell.dataset.radioTranslationMode = state.radioTranslationMode;
      var radioLabel = radioTranslationShell.querySelector("[data-radio-translation-mode-label]");
      if (radioLabel) radioLabel.textContent = state.radioTranslationMode;
      radioTranslationShell.querySelectorAll('[data-workspace-action="radio-translation-minus"]').forEach(function (button) { button.disabled = state.radioTranslationMode === "COLLAPSED"; });
      radioTranslationShell.querySelectorAll('[data-workspace-action="radio-translation-plus"]').forEach(function (button) { button.disabled = state.radioTranslationMode === "FULL"; });
    }
    target.querySelectorAll("[data-video-mode-label]").forEach(function (node) { node.textContent = state.videoMode; });
    target.querySelectorAll('[data-workspace-action="video-minus"]').forEach(function (button) { button.disabled = state.videoMode === "COMPACT"; });
    target.querySelectorAll('[data-workspace-action="video-plus"]').forEach(function (button) { button.disabled = state.videoMode === "FULL"; });
    if (state.active) document.body.classList.add("group-communication-immersive");
    else document.body.classList.remove("group-communication-immersive");
    return snapshot();
  }

  function handleClick(event) {
    var control = event.target.closest && event.target.closest("[data-workspace-action]");
    if (!control) return;
    var action = control.dataset.workspaceAction;
    if (action === "video-plus") stepVideo(1);
    else if (action === "video-minus") stepVideo(-1);
    else if (action === "translation-plus") stepTranslation(1, false);
    else if (action === "translation-minus") stepTranslation(-1, false);
    else if (action === "radio-translation-plus") stepTranslation(1, true);
    else if (action === "radio-translation-minus") stepTranslation(-1, true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  document.addEventListener("click", handleClick, true);
  window.addEventListener("resize", function () { apply(); });
  window.addEventListener("orientationchange", function () { apply(); });
  window.addEventListener("group-v3:rendered", function () { apply(); });
  window.addEventListener("group-v3:viewport", function (event) {
    state.keyboardOpen = Boolean(event.detail && event.detail.keyboardOpen);
    apply();
  });

  window.GroupCommunicationWorkspace = Object.freeze({
    VIDEO_MODES: VIDEO_MODES.slice(),
    TRANSLATION_MODES: TRANSLATION_MODES.slice(),
    snapshot: snapshot,
    apply: apply,
    setVideoMode: setVideoMode,
    setTranslationMode: setTranslationMode,
    stepVideo: stepVideo,
    stepTranslation: stepTranslation
  });
}(window, document));
