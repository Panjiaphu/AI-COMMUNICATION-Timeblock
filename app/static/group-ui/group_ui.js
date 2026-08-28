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

  let translationManager = null;
  const remoteTracks = new Set();
  let activeHandoff = null;
  const callCard = root.querySelector(".group-call-stage");
  if (callCard) {
    const degraded = callCard.querySelector("[data-group-degraded]");
    const join = callCard.querySelector('[data-group-call-action="join"]');
    const reject = callCard.querySelector('[data-group-call-action="reject"]');
    const leave = callCard.querySelector('[data-group-call-action="leave"]');
    const updateCallActions = (state) => {
      const connected = state === "JOINED" || state === "RECONNECTING";
      if (join) join.hidden = connected || state === "JOINING";
      if (reject) reject.hidden = connected || state === "JOINING";
      if (leave) leave.hidden = !connected;
    };
    const translationPanel = root.querySelector(".group-translation-panel");
    const translation = window.GroupTranslationClient?.create({
      panel: translationPanel,
      copy,
      onState: (state) => {
        const stateNode = translationPanel?.querySelector("[data-group-translation-state]");
        if (stateNode) stateNode.textContent = state;
      },
      onPartial: (original, translated) => {
        const originalNode = translationPanel?.querySelector("[data-group-original]");
        const finalNode = translationPanel?.querySelector("[data-group-final]");
        if (originalNode && original) originalNode.textContent = original;
        if (finalNode && translated) finalNode.textContent = translated;
        const stateNode = translationPanel?.querySelector("[data-group-translation-state]");
        if (stateNode) stateNode.textContent = "PARTIAL";
      },
      onFinal: (_original, _translated) => {
        const stateNode = translationPanel?.querySelector("[data-group-translation-state]");
        if (stateNode) stateNode.textContent = "FINAL";
      },
      onTTSState: (state) => {
        const stateNode = translationPanel?.querySelector("[data-group-translation-state]");
        if (stateNode && ["PLAYING", "PAUSED_TRANSMIT", "AUTOPLAY_BLOCKED"].includes(state)) {
          stateNode.textContent = state;
        }
      },
    });
    translationManager = translation;
    const media = window.GroupMediaClient?.create({
      card: callCard,
      copy,
      onRemoteTrack: (track, participantId) => {
        remoteTracks.add(track);
        if (translation?.enabled) void translation.startForTrack(track, participantId);
      },
      onRemoteTrackRemoved: (track) => {
        remoteTracks.delete(track);
        translation?.removeTrack(track);
      },
      onState: (state, note) => {
        setState(callCard, state);
        updateCallActions(state);
        if (degraded && note) degraded.textContent = note;
      },
    });
    const consumeHandoff = () => {
      if (!activeHandoff) activeHandoff = window.GroupCommunicationHandoff?.consume?.() || null;
      return activeHandoff;
    };
    join?.addEventListener("click", async () => {
      const handoff = consumeHandoff();
      translation?.setContext(handoff);
      await media?.join(handoff);
    });
    reject?.addEventListener("click", () => {
      setState(callCard, "ENDED");
      if (degraded) degraded.textContent = text("group_rejected", text("group_ui_only", "UI-only state; no room was ended."));
    });
    leave?.addEventListener("click", async () => {
      await media?.leave();
      await translation?.stop();
      remoteTracks.clear();
    });
    updateCallActions("RINGING");
  }

  const radioCard = root.querySelector(".group-radio-panel");
  if (radioCard) {
    const note = radioCard.querySelector("[data-group-radio-note]");
    const start = radioCard.querySelector('[data-group-radio-action="start"]');
    const stop = radioCard.querySelector('[data-group-radio-action="stop"]');
    const leave = radioCard.querySelector('[data-group-radio-action="leave"]');
    const radio = window.GroupRadioClient?.create({
      onState: (state) => setState(radioCard, state),
    });
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
      const handoff = activeHandoff || window.GroupCommunicationHandoff?.getState?.() || null;
      radio?.setContext(handoff);
      if (!radio) return;
      void Promise.resolve(radio.start({ conversationId: handoff?.conversation_id })).then(() => {
        setState(radioCard, "TALKING");
        setRadioActionVisibility(true);
        if (note) note.textContent = readyNote;
      }).catch((error) => {
        setState(radioCard, "DEVICE_LOST");
        setRadioActionVisibility(false);
        if (note) note.textContent = `${degradedNote} ${error.message || ""}`.trim();
      });
    });
    stop?.addEventListener("click", () => {
      void Promise.resolve(radio?.stop()).finally(() => {
        setState(radioCard, "FINALIZING_BURST");
        setRadioActionVisibility(false);
        if (note) note.textContent = readyNote;
      });
    });
    leave?.addEventListener("click", () => {
      void Promise.resolve(radio?.leave()).finally(() => {
        setState(radioCard, "ENDED");
        setRadioActionVisibility(false);
        if (note) note.textContent = degradedNote;
      });
    });
  }

  const translationPanel = root.querySelector(".group-translation-panel");
  translationPanel?.querySelector('[data-group-translation-action="listen"]')?.addEventListener("click", async () => {
    const state = translationPanel.querySelector("[data-group-translation-state]");
    const manager = translationManager;
    if (state) state.textContent = "STARTING";
    if (!manager) {
      if (state) state.textContent = "UNAVAILABLE";
      return;
    }
    manager.setContext(activeHandoff);
    const consent = root.querySelector("[data-group-translation-consent]");
    if (!consent?.checked && !activeHandoff?.translation_consent_version && !activeHandoff?.consent_version) {
      if (state) state.textContent = "CONSENT_REQUIRED";
      return;
    }
    if (consent?.checked) {
      const granted = await manager.grantConsent();
      if (!granted && !activeHandoff?.translation_consent_version) {
        if (state) state.textContent = "CONSENT_UNAVAILABLE";
        return;
      }
    }
    await manager.enable(remoteTracks);
    if (state) state.textContent = manager.sidecars.size ? "STREAMING" : "WAITING_FOR_REMOTE_AUDIO";
  });

  const preferences = root.querySelector(".group-translation-preferences");
  preferences?.querySelector("[data-group-preferences-save]")?.addEventListener("click", () => {
    const status = preferences.querySelector("[data-group-preferences-status]");
    if (status) status.textContent = text("group_preferences_saved", "UI preferences were saved for this session.");
  });
}(window));
