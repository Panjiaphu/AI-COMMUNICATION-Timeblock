(function groupUiStateOnly(window) {
  "use strict";

  const root = document.querySelector("[data-group-ui]");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  let copy = window.__GROUP_UI_COPY__ || {};
  if (!Object.keys(copy).length) {
    try {
      const configNode = document.getElementById("guilua-runtime-config");
      const runtimeConfig = JSON.parse(configNode?.textContent || "{}");
      copy = runtimeConfig.copy || {};
    } catch (_error) {
      copy = {};
    }
  }
  const text = (key, fallback) => String(copy[key] || fallback || "");
  const applyLanguageProfile = (profile) => {
    if (!profile) return;
    root.querySelectorAll("[data-group-profile-field]").forEach((field) => {
      const key = field.dataset.groupProfileField;
      if (!(key in profile)) return;
      if (field.type === "checkbox") field.checked = Boolean(profile[key]);
      else field.value = profile[key] == null ? "" : String(profile[key]);
    });
  };
  window.addEventListener("group:handoff-ready", (event) => {
    applyLanguageProfile(event.detail?.language_profile || null);
  });
  const setState = (card, state) => {
    card.dataset.state = state;
    card.querySelectorAll("[data-group-call-state], [data-group-radio-state]").forEach((button) => {
      const key = button.dataset.groupCallState || button.dataset.groupRadioState;
      button.classList.toggle("is-selected", key === state);
    });
    const stateNode = card.querySelector("[data-group-state], [data-group-radio-state]");
    if (stateNode) stateNode.textContent = state;
  };

  const callCard = root.querySelector(".group-call-stage");
  if (callCard) {
    const degraded = callCard.querySelector("[data-group-degraded]");
    callCard.querySelectorAll("[data-group-call-state]").forEach((button) => {
      button.addEventListener("click", () => setState(callCard, button.dataset.groupCallState));
    });
    callCard.querySelector('[data-group-call-action="join"]')?.addEventListener("click", () => {
      setState(callCard, "JOIN_FAILED");
      if (degraded) degraded.textContent = text("group_join_degraded", text("group_ui_only", "UI-only state; secure handoff is not connected."));
    });
    callCard.querySelector('[data-group-call-action="reject"]')?.addEventListener("click", () => {
      setState(callCard, "ENDED");
      if (degraded) degraded.textContent = text("group_rejected", text("group_ui_only", "UI-only state; no room was ended."));
    });
  }

  const radioCard = root.querySelector(".group-radio-panel");
  if (radioCard) {
    const note = radioCard.querySelector("[data-group-radio-note]");
    const start = radioCard.querySelector('[data-group-radio-action="start"]');
    const stop = radioCard.querySelector('[data-group-radio-action="stop"]');
    const leave = radioCard.querySelector('[data-group-radio-action="leave"]');
    const readyNote = text("group_radio_ready", "Radio is in a design state; no microphone permission was requested.");
    const degradedNote = text("group_radio_degraded", "The Radio provider is unavailable; no microphone or floor lease was created.");
    const setRadioActionVisibility = (talking) => {
      if (start) start.hidden = talking;
      if (stop) stop.hidden = !talking;
    };
    radioCard.querySelectorAll("[data-group-radio-state]").forEach((button) => {
      button.addEventListener("click", () => {
        const state = button.dataset.groupRadioState;
        setState(radioCard, state);
        setRadioActionVisibility(state === "TALKING");
        if (note) note.textContent = state === "READY" ? readyNote : degradedNote;
      });
    });
    start?.addEventListener("click", () => {
      setState(radioCard, "TALKING");
      setRadioActionVisibility(true);
      if (note) note.textContent = degradedNote;
    });
    stop?.addEventListener("click", () => {
      setState(radioCard, "FINALIZING_BURST");
      setRadioActionVisibility(false);
      if (note) note.textContent = degradedNote;
    });
    leave?.addEventListener("click", () => {
      setState(radioCard, "ENDED");
      setRadioActionVisibility(false);
      if (note) note.textContent = degradedNote;
    });
  }

  const translation = root.querySelector(".group-translation-panel");
  translation?.querySelector('[data-group-translation-action="listen"]')?.addEventListener("click", () => {
    const state = translation.querySelector("[data-group-translation-state]");
    if (state) state.textContent = "QUEUED";
  });

  const preferences = root.querySelector(".group-translation-preferences");
  preferences?.querySelector("[data-group-preferences-save]")?.addEventListener("click", () => {
    const status = preferences.querySelector("[data-group-preferences-status]");
    if (status) status.textContent = text("group_preferences_saved", "UI preferences were saved for this session.");
  });
}(window));
