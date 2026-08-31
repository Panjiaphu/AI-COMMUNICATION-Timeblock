(function groupUiStateOnly(window) {
  "use strict";

  const root = document.querySelector("[data-group-ui]");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  const directControls = document.querySelector(".call-controls");
  if (directControls && "IntersectionObserver" in window) {
    const surfaceObserver = new IntersectionObserver((entries) => {
      const groupSurfaceVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.04);
      document.body.classList.toggle("is-group-surface-visible", groupSurfaceVisible);
    }, { threshold: [0, 0.04, 0.2] });
    surfaceObserver.observe(root);
  }

  let runtimeConfig = {};
  try {
    const configNode = document.getElementById("guilua-runtime-config");
    runtimeConfig = JSON.parse(configNode?.textContent || "{}");
  } catch (_error) {
    runtimeConfig = {};
  }
  let copy = window.__GROUP_UI_COPY__ || {};
  if (!Object.keys(copy).length) {
    copy = runtimeConfig.copy || {};
  }
  const initialSurface = ["call", "video", "radio"].includes(runtimeConfig.initial_surface)
    ? runtimeConfig.initial_surface
    : "";
  const initialQaState = ["READY", "FLOOR_BUSY", "TALKING", "FINALIZING_BURST", "DEVICE_LOST"].includes(runtimeConfig.initial_qa_state)
    ? runtimeConfig.initial_qa_state
    : "";
  root.dataset.initialSurface = initialSurface;
  if (initialSurface) {
    document.body.classList.add("group-runtime-mode", `group-runtime-${initialSurface}`);
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
  const consumeHandoff = () => {
    if (!activeHandoff) activeHandoff = window.GroupCommunicationHandoff?.consume?.() || null;
    return activeHandoff;
  };
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
        const radioOriginal = root.querySelector("[data-group-radio-original]");
        const radioFinal = root.querySelector("[data-group-radio-final]");
        const radioState = root.querySelector("[data-group-radio-translation-state]");
        if (radioOriginal && original) radioOriginal.textContent = original;
        if (radioFinal && translated) radioFinal.textContent = translated;
        if (radioState) radioState.textContent = "PARTIAL";
      },
      onFinal: (original, translated) => {
        const stateNode = translationPanel?.querySelector("[data-group-translation-state]");
        if (stateNode) stateNode.textContent = "FINAL";
        const radioOriginal = root.querySelector("[data-group-radio-original]");
        const radioFinal = root.querySelector("[data-group-radio-final]");
        const radioState = root.querySelector("[data-group-radio-translation-state]");
        if (radioOriginal && original) radioOriginal.textContent = original;
        if (radioFinal && translated) radioFinal.textContent = translated;
        if (radioState) radioState.textContent = "FINAL";
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
    const deviceActions = radioCard.querySelector("[data-group-radio-device-actions]");
    const translationEnable = radioCard.querySelector("[data-group-radio-translation-enable]");
    const radioAutoRead = radioCard.querySelector("[data-group-radio-auto-read]");
    const translationState = radioCard.querySelector("[data-group-radio-translation-state]");
    const roster = radioCard.querySelector("[data-group-radio-roster-list]");
    const pluginToggle = radioCard.querySelector("[data-group-radio-plugin-toggle]");
    const readyNote = text("group_radio_ready", "Radio is in a design state; no microphone permission was requested.");
    const degradedNote = text("group_radio_degraded", "The Radio provider is unavailable; no microphone or floor lease was created.");
    const radioStateNotes = {
      READY: readyNote,
      FLOOR_BUSY: text("group_floor_busy_note", degradedNote),
      TALKING: text("group_talking_note", readyNote),
      FINALIZING_BURST: text("group_finalizing_note", readyNote),
      DEVICE_LOST: text("group_device_lost_note", degradedNote),
      RECONNECTING: text("group_call_reconnecting", degradedNote),
      ENDED: degradedNote,
    };
    const setRadioActionVisibility = (state) => {
      const talking = state === "TALKING";
      if (start) start.hidden = talking || ["FLOOR_BUSY", "DEVICE_LOST", "ENDED"].includes(state);
      if (stop) stop.hidden = !talking;
      if (deviceActions) deviceActions.hidden = state !== "DEVICE_LOST";
    };
    const applyRadioState = (state, noteOverride = "") => {
      setState(radioCard, state);
      setRadioActionVisibility(state);
      if (note) note.textContent = noteOverride || radioStateNotes[state] || degradedNote;
    };
    const renderParticipants = (participants) => {
      if (!roster) return;
      const values = Array.isArray(participants) ? participants.filter(Boolean) : [];
      if (!values.length) {
        const empty = document.createElement("div");
        empty.className = "group-radio-empty-roster";
        const avatar = document.createElement("span");
        avatar.className = "group-ui-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "T";
        const message = document.createElement("p");
        message.textContent = text("group_channel_waiting", "Waiting for listeners.");
        empty.append(avatar, message);
        roster.replaceChildren(empty);
        return;
      }
      roster.replaceChildren(...values.map((identity) => {
        const row = document.createElement("div");
        row.className = "group-radio-participant";
        const avatar = document.createElement("span");
        avatar.className = "group-ui-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = String(identity).split(":").pop().slice(0, 2).toUpperCase();
        const label = document.createElement("strong");
        label.textContent = String(identity);
        row.append(avatar, label);
        return row;
      }));
    };
    const radio = window.GroupRadioClient?.create({
      audioHost: radioCard.querySelector("[data-group-radio-remote-audio]"),
      onState: (state) => applyRadioState(state),
      onRemoteTrack: (track, participantId) => {
        remoteTracks.add(track);
        if (translationManager?.enabled) void translationManager.startForTrack(track, participantId);
      },
      onRemoteTrackRemoved: (track) => {
        remoteTracks.delete(track);
        translationManager?.removeTrack(track);
      },
      onParticipants: renderParticipants,
    });
    const radioHandoff = () => {
      const handoff = consumeHandoff();
      if (!handoff) return null;
      const sessionId = handoff.radio_session_id || handoff.session_id || "";
      const context = { ...handoff, room_id: `group-radio:${sessionId}` };
      radio?.setContext(context);
      translationManager?.setContext(context);
      if (radioAutoRead) {
        radioAutoRead.checked = Boolean(context.language_profile?.auto_read_translation);
        if (translationManager) translationManager.autoRead = radioAutoRead.checked;
      }
      return context;
    };
    radioCard.querySelectorAll("[data-group-radio-state]").forEach((button) => {
      button.addEventListener("click", () => {
        const state = button.dataset.groupRadioState;
        if (state) applyRadioState(state);
      });
    });
    start?.addEventListener("click", () => {
      const handoff = radioHandoff();
      if (!radio) return;
      void Promise.resolve(radio.start({ conversationId: handoff?.conversation_id })).then(() => {
        applyRadioState("TALKING");
        if (handoff?.language_profile?.auto_translate && handoff?.translation_consent_version) {
          void translationManager?.enable(remoteTracks);
          if (translationState) translationState.textContent = "WAITING";
        }
      }).catch((error) => {
        const message = String(error?.message || "");
        if (message.includes("floor_busy")) applyRadioState("FLOOR_BUSY");
        else applyRadioState("DEVICE_LOST");
      });
    });
    stop?.addEventListener("click", () => {
      void Promise.resolve(radio?.stop()).finally(() => {
        applyRadioState("FINALIZING_BURST");
      });
    });
    leave?.addEventListener("click", () => {
      void Promise.all([radio?.leave(), translationManager?.stop()]).finally(() => {
        applyRadioState("ENDED");
      });
    });
    radioCard.querySelectorAll("[data-group-radio-route]").forEach((button) => {
      button.addEventListener("click", () => {
        button.disabled = true;
        void Promise.resolve(radio?.chooseOutputRoute(button.dataset.groupRadioRoute)).catch((error) => {
          applyRadioState("DEVICE_LOST", String(error?.message || radioStateNotes.DEVICE_LOST));
        }).finally(() => { button.disabled = false; });
      });
    });
    translationEnable?.addEventListener("click", async () => {
      const handoff = radioHandoff();
      if (!handoff || !translationManager) {
        if (translationState) translationState.textContent = "HANDOFF_REQUIRED";
        return;
      }
      if (translationState) translationState.textContent = "STARTING";
      if (!handoff.translation_consent_version) {
        const granted = await translationManager.grantConsent();
        if (!granted) {
          if (translationState) translationState.textContent = "CONSENT_UNAVAILABLE";
          return;
        }
      }
      await translationManager.enable(remoteTracks);
      if (translationState) translationState.textContent = remoteTracks.size ? "STREAMING" : "WAITING";
    });
    radioAutoRead?.addEventListener("change", () => {
      if (translationManager) translationManager.autoRead = radioAutoRead.checked;
    });
    pluginToggle?.addEventListener("click", () => {
      const isOpen = radioCard.classList.toggle("is-plugin-open");
      pluginToggle.setAttribute("aria-expanded", String(isOpen));
    });
    applyRadioState(initialSurface === "radio" && initialQaState ? initialQaState : "READY");
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

  const initialCard = initialSurface === "radio" ? radioCard : (["call", "video"].includes(initialSurface) ? callCard : null);
  if (initialCard) {
    initialCard.dataset.initialMode = initialSurface;
    initialCard.setAttribute("tabindex", "-1");
    window.requestAnimationFrame(() => {
      initialCard.focus({ preventScroll: true });
      if (document.body.classList.contains("group-runtime-mode")) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } else {
        initialCard.scrollIntoView({ block: "center", behavior: "auto" });
      }
    });
  }
}(window));
