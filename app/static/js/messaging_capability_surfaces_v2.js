(function messagingCapabilitySurfacesV2(global) {
  "use strict";

  const app = document.getElementById("assistant-app");
  const panel = app?.querySelector('[data-mode-panel="messages"]');
  const threadMessages = panel?.querySelector("[data-thread-messages]");
  const messageForm = panel?.querySelector("[data-message-form]");

  if (!app || !panel || !threadMessages || !messageForm) return;
  if (app.dataset.messagingCapabilitySurfacesV2Initialized === "true") return;
  app.dataset.messagingCapabilitySurfacesV2Initialized = "true";

  const locale = String(app.dataset.locale || "en");
  const sourceTranslationLanguages = ["auto", "zh-TW", "vi", "en", "ja", "ko", "th", "id"];
  const targetTranslationLanguages = sourceTranslationLanguages.filter((code) => code !== "auto");
  const supportedTranslationLanguages = new Set(targetTranslationLanguages);
  const languageOptions = [
    { code: "auto", labels: { vi: "Tự động nhận diện", en: "Auto detect", "zh-TW": "自動偵測" } },
    { code: "zh-TW", labels: { vi: "繁體中文", en: "Traditional Chinese", "zh-TW": "繁體中文" } },
    { code: "vi", labels: { vi: "Tiếng Việt", en: "Vietnamese", "zh-TW": "越南語" } },
    { code: "en", labels: { vi: "English", en: "English", "zh-TW": "英語" } },
    { code: "ja", labels: { vi: "日本語", en: "Japanese", "zh-TW": "日語" } },
    { code: "ko", labels: { vi: "한국어", en: "Korean", "zh-TW": "韓語" } },
    { code: "th", labels: { vi: "ภาษาไทย", en: "Thai", "zh-TW": "泰語" } },
    { code: "id", labels: { vi: "Bahasa Indonesia", en: "Indonesian", "zh-TW": "印尼語" } },
  ];
  const copyTable = {
    vi: {
      translate: "Dịch",
      translating: "Đang dịch…",
      translation: "Bản dịch",
      original: "Bản gốc",
      retry: "Thử lại",
      translationError: "Không thể dịch tin nhắn này.",
      translationUnavailable: "Dịch hiện không khả dụng.",
      voiceStart: "Ghi âm tin nhắn thoại",
      voiceStop: "Dừng ghi âm",
      voicePermission: "Đang xin quyền micro",
      voiceRecorded: "Tin nhắn thoại đã sẵn sàng",
      voiceSending: "Đang gửi tin nhắn thoại",
      voiceError: "Ghi âm không khả dụng",
    },
    en: {
      translate: "Translate",
      translating: "Translating…",
      translation: "Translation",
      original: "Original",
      retry: "Retry",
      translationError: "This message could not be translated.",
      translationUnavailable: "Translation is currently unavailable.",
      voiceStart: "Record voice message",
      voiceStop: "Stop recording",
      voicePermission: "Requesting microphone access",
      voiceRecorded: "Voice message ready",
      voiceSending: "Sending voice message",
      voiceError: "Voice recording unavailable",
    },
    "zh-TW": {
      translate: "翻譯",
      translating: "翻譯中…",
      translation: "翻譯",
      original: "原文",
      retry: "重試",
      translationError: "無法翻譯這則訊息。",
      translationUnavailable: "目前無法使用翻譯。",
      voiceStart: "錄製語音訊息",
      voiceStop: "停止錄製",
      voicePermission: "正在要求麥克風權限",
      voiceRecorded: "語音訊息已就緒",
      voiceSending: "正在傳送語音訊息",
      voiceError: "無法使用語音錄製",
    },
  };
  const appCopy = (key, fallback) => String(app.dataset[key] || fallback || "").trim();
  const copy = {
    ...(copyTable[locale] || copyTable.en),
    translate: appCopy("v2MessageTranslate", copyTable.en.translate),
    translateAgain: appCopy("v2MessageTranslateAgain", "Translate again"),
    conversationTranslation: appCopy("v2TranslationConversation", "Conversation translation"),
    sourceLanguage: appCopy("v2TranslationSource", "Source language"),
    targetLanguage: appCopy("v2TranslationTarget", "Target language"),
    autoDetect: appCopy("v2TranslationAuto", copyTable.en.autoDetect || "Auto detect"),
    swapLanguages: appCopy("v2TranslationSwap", "Swap languages"),
    done: appCopy("v2TranslationDone", "Done"),
    translation: appCopy("v2TranslationLabel", copyTable.en.translation),
    showTranslation: appCopy("v2TranslationShow", "Show translation"),
    hideTranslation: appCopy("v2TranslationHide", "Hide translation"),
    translating: appCopy("v2TranslationTranslating", copyTable.en.translating),
    translationError: appCopy("v2TranslationError", copyTable.en.translationError),
    translationUnavailable: appCopy("v2TranslationUnavailable", copyTable.en.translationUnavailable),
    sourceEqualsTarget: appCopy("v2TranslationSourceEqualsTarget", "Choose different source and target languages."),
  };
  const translationStates = new Map();
  const conversationTranslationPreferences = new Map();
  let currentConversationId = String(
    app.dataset.activeMessagingConversationId || app.dataset.initialConversation || "",
  );
  let translationRequests = 0;
  let translationPreferenceBar = null;
  let translationPreferenceButton = null;
  let translationDialog = null;
  let translationSourceSelect = null;
  let translationTargetSelect = null;
  let translationSwapButton = null;
  let translationFeedback = null;
  let pendingTranslationBubble = null;
  let translationDialogReturnFocus = null;
  let threadObserver = null;
  let capabilityObserver = null;
  let voiceObserver = null;
  let voiceButton = null;
  let voiceListenersInstalled = false;

  function text(key) {
    return copy[key] || copyTable.en[key] || key;
  }

  function translationTargetLanguage() {
    return supportedTranslationLanguages.has(locale) ? locale : "vi";
  }

  function languageLabel(code) {
    const option = languageOptions.find((item) => item.code === code);
    return option?.labels?.[locale] || option?.labels?.en || code;
  }

  function activeConversationKey() {
    return currentConversationId || "__unselected__";
  }

  function conversationPreference() {
    const key = activeConversationKey();
    if (!conversationTranslationPreferences.has(key)) {
      conversationTranslationPreferences.set(key, {
        sourceLanguage: "auto",
        targetLanguage: translationTargetLanguage(),
        active: false,
      });
    }
    return conversationTranslationPreferences.get(key);
  }

  function languagePairLabel(sourceLanguage, targetLanguage) {
    return `${languageLabel(sourceLanguage)} → ${languageLabel(targetLanguage)}`;
  }

  function translationStateKey(bubble) {
    return `${activeConversationKey()}:${String(bubble?.dataset.messageId || "")}`;
  }

  function stateForBubble(bubble) {
    const id = String(bubble?.dataset.messageId || "");
    const original = String(bubble?.querySelector(".assistant-thread-text")?.textContent || "").trim();
    const key = translationStateKey(bubble);
    const existing = translationStates.get(key);
    if (!existing || existing.original !== original) {
      const next = {
        id,
        original,
        status: "original",
        translation: "",
        error: "",
        sourceLanguage: "",
        targetLanguage: "",
        expanded: true,
      };
      translationStates.set(key, next);
      return next;
    }
    return existing;
  }

  function setTextIfChanged(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function renderTranslationState(bubble) {
    const originalNode = bubble?.querySelector(".assistant-thread-text");
    const region = bubble?.querySelector(":scope > [data-enterprise-translation]");
    if (!originalNode || !region) return;
    const state = stateForBubble(bubble);
    const button = region.querySelector("[data-enterprise-translate]");
    const output = region.querySelector("[data-enterprise-translation-output]");
    const outputText = output?.querySelector(".messaging-enterprise-translation-text");
    const pair = output?.querySelector(".messaging-enterprise-translation-pair");
    const disclosure = output?.querySelector("[data-enterprise-translation-disclosure]");
    let originalLabel = bubble.querySelector(":scope > .messaging-enterprise-original-label");
    const engaged = state.status !== "original";

    if (engaged && !originalLabel) {
      originalLabel = document.createElement("small");
      originalLabel.className = "messaging-enterprise-original-label";
      originalLabel.textContent = text("original");
      originalNode.insertAdjacentElement("beforebegin", originalLabel);
    } else if (!engaged) {
      originalLabel?.remove();
    }

    if (button) {
      button.disabled = state.status === "requested" || state.status === "loading";
      button.setAttribute("aria-busy", String(state.status === "loading"));
      setTextIfChanged(
        button,
        state.status === "requested" || state.status === "loading"
          ? text("translating")
          : state.status === "error" || state.status === "unavailable"
            ? text("retry")
            : state.status === "translated_expanded" || state.status === "translated_collapsed"
              ? text("translateAgain")
              : text("translate"),
      );
    }

    if (output) {
      output.dataset.translationState = state.status;
      output.hidden = state.status === "original";
      output.setAttribute("aria-live", state.status === "loading" ? "polite" : "off");
    }
    if (pair) {
      setTextIfChanged(pair, languagePairLabel(
        state.sourceLanguage || conversationPreference().sourceLanguage,
        state.targetLanguage || conversationPreference().targetLanguage,
      ));
    }
    const translated = state.status === "translated_expanded" || state.status === "translated_collapsed";
    const collapsed = state.status === "translated_collapsed";
    if (disclosure) {
      disclosure.hidden = !translated;
      disclosure.setAttribute("aria-expanded", String(translated && !collapsed));
      setTextIfChanged(disclosure, collapsed ? text("showTranslation") : text("hideTranslation"));
    }
    if (!outputText) return;
    const inFlight = state.status === "loading" || state.status === "requested";
    const failed = state.status === "error" || state.status === "unavailable";
    outputText.hidden = (!translated && !inFlight && !failed) || collapsed;
    if (state.status === "loading" || state.status === "requested") setTextIfChanged(outputText, text("translating"));
    else if (translated) setTextIfChanged(outputText, state.translation);
    else if (state.status === "unavailable") setTextIfChanged(outputText, text("translationUnavailable"));
    else if (state.status === "error") setTextIfChanged(outputText, state.error || text("translationError"));
  }

  async function requestTranslation(bubble) {
    const state = stateForBubble(bubble);
    if (!state.original || state.status === "loading" || state.status === "requested") return;
    const preference = conversationPreference();
    const sourceLanguage = String(preference.sourceLanguage || "auto");
    const targetLanguage = String(preference.targetLanguage || translationTargetLanguage());
    state.sourceLanguage = sourceLanguage;
    state.targetLanguage = targetLanguage;
    state.translation = "";
    state.expanded = true;
    if (
      !sourceTranslationLanguages.includes(sourceLanguage)
      || !targetTranslationLanguages.includes(targetLanguage)
      || sourceLanguage === targetLanguage
    ) {
      state.status = "error";
      state.error = text("sourceEqualsTarget");
      renderTranslationState(bubble);
      return;
    }
    state.status = "requested";
    state.error = "";
    renderTranslationState(bubble);
    await Promise.resolve();
    state.status = "loading";
    renderTranslationState(bubble);

    const formData = new FormData();
    formData.set("text", state.original);
    formData.set("source_language", sourceLanguage);
    formData.set("target_language", targetLanguage);
    formData.set("lang", locale);

    let response;
    let payload = {};
    try {
      translationRequests += 1;
      response = await fetch("/translator/api/text", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        body: formData,
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const translated = String(payload.translation || "").trim();
      if (!translated) throw new Error(text("translationError"));
      state.status = "translated_expanded";
      state.translation = translated;
      state.sourceLanguage = String(payload.source_language || sourceLanguage);
      state.targetLanguage = String(payload.target_language || targetLanguage);
    } catch (error) {
      const status = Number(error?.status || response?.status || 0);
      state.status = status === 404 || status === 503 ? "unavailable" : "error";
      state.error = state.status === "unavailable"
        ? text("translationUnavailable")
        : String(payload.error || error?.message || text("translationError"));
    }
    if (bubble.isConnected) renderTranslationState(bubble);
  }

  function enhanceMessageBubble(bubble) {
    const original = bubble?.querySelector(".assistant-thread-text");
    const id = String(bubble?.dataset.messageId || "");
    if (!original || !id || bubble.dataset.messageKind === "call_event") return;
    if (bubble.querySelector(":scope > [data-enterprise-translation]")) {
      renderTranslationState(bubble);
      return;
    }

    const region = document.createElement("section");
    region.className = "messaging-enterprise-translation";
    region.dataset.enterpriseTranslation = id;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-secondary-button messaging-enterprise-translate-button";
    button.dataset.enterpriseTranslate = id;
    button.textContent = text("translate");
    button.addEventListener("click", () => requestTranslation(bubble).catch(() => undefined));

    const output = document.createElement("section");
    output.className = "messaging-enterprise-translation-output";
    output.dataset.enterpriseTranslationOutput = id;
    output.hidden = true;
    const heading = document.createElement("div");
    heading.className = "messaging-enterprise-translation-heading";
    const label = document.createElement("strong");
    label.textContent = text("translation");
    const pair = document.createElement("span");
    pair.className = "messaging-enterprise-translation-pair";
    heading.append(label, pair);
    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "messaging-enterprise-translation-disclosure";
    disclosure.dataset.enterpriseTranslationDisclosure = id;
    disclosure.setAttribute("aria-expanded", "true");
    const translationRegionId = `messaging-enterprise-translation-content-${id}`;
    disclosure.setAttribute("aria-controls", translationRegionId);
    disclosure.addEventListener("click", () => {
      const state = stateForBubble(bubble);
      if (state.status !== "translated_expanded" && state.status !== "translated_collapsed") return;
      state.status = state.status === "translated_expanded" ? "translated_collapsed" : "translated_expanded";
      state.expanded = state.status === "translated_expanded";
      renderTranslationState(bubble);
    });
    const outputText = document.createElement("p");
    outputText.className = "messaging-enterprise-translation-text";
    outputText.id = translationRegionId;
    output.append(heading, disclosure, outputText);
    region.append(button, output);
    original.insertAdjacentElement("afterend", region);
    renderTranslationState(bubble);
  }

  function enhanceMessageTranslations() {
    threadMessages.querySelectorAll("[data-message-id]").forEach(enhanceMessageBubble);
  }

  function translationActionLabel(bubble) {
    const status = stateForBubble(bubble).status;
    if (status === "error" || status === "unavailable") return text("retry");
    if (status === "translated_expanded" || status === "translated_collapsed") return text("translateAgain");
    return text("translate");
  }

  function syncTranslationPreferenceBar() {
    if (!translationPreferenceBar || !translationPreferenceButton) return;
    const preference = conversationPreference();
    translationPreferenceBar.hidden = !preference.active;
    if (!preference.active) return;
    const pair = languagePairLabel(preference.sourceLanguage, preference.targetLanguage);
    translationPreferenceButton.textContent = pair;
    translationPreferenceButton.setAttribute("aria-label", `${text("conversationTranslation")}: ${pair}`);
    translationPreferenceButton.title = `${text("conversationTranslation")}: ${pair}`;
  }

  function syncTranslationSwap() {
    if (!translationSwapButton || !translationSourceSelect) return;
    translationSwapButton.disabled = translationSourceSelect.value === "auto";
  }

  function closeTranslationDialog() {
    if (!translationDialog) return;
    pendingTranslationBubble = null;
    if (translationDialog.open) translationDialog.close();
    translationDialogReturnFocus?.focus?.();
    translationDialogReturnFocus = null;
  }

  function commitTranslationPreferences(event) {
    event?.preventDefault();
    const sourceLanguage = String(translationSourceSelect?.value || "auto");
    const targetLanguage = String(translationTargetSelect?.value || translationTargetLanguage());
    if (sourceLanguage === targetLanguage) {
      if (translationFeedback) {
        translationFeedback.textContent = text("sourceEqualsTarget");
        translationFeedback.hidden = false;
      }
      return;
    }
    const preference = conversationPreference();
    preference.sourceLanguage = sourceLanguage;
    preference.targetLanguage = targetLanguage;
    preference.active = true;
    const bubble = pendingTranslationBubble;
    pendingTranslationBubble = null;
    syncTranslationPreferenceBar();
    translationDialog?.close();
    translationDialogReturnFocus?.focus?.();
    translationDialogReturnFocus = null;
    if (bubble?.isConnected) requestTranslation(bubble).catch(() => undefined);
  }

  function buildTranslationDialog() {
    translationDialog = document.createElement("dialog");
    translationDialog.className = "messaging-mobile-sheet messaging-mobile-translation-sheet";
    translationDialog.setAttribute("aria-label", text("conversationTranslation"));
    const heading = document.createElement("strong");
    heading.className = "messaging-mobile-sheet-title";
    heading.textContent = text("conversationTranslation");

    const form = document.createElement("form");
    form.addEventListener("submit", commitTranslationPreferences);
    const sourceLabel = document.createElement("label");
    sourceLabel.className = "messaging-translation-language-field";
    sourceLabel.append(document.createTextNode(text("sourceLanguage")));
    translationSourceSelect = document.createElement("select");
    translationSourceSelect.name = "source_language";
    sourceTranslationLanguages.forEach((code) => {
      translationSourceSelect.appendChild(new Option(languageLabel(code), code));
    });
    translationSourceSelect.addEventListener("change", () => {
      if (translationFeedback) translationFeedback.hidden = true;
      syncTranslationSwap();
    });
    sourceLabel.appendChild(translationSourceSelect);

    const targetLabel = document.createElement("label");
    targetLabel.className = "messaging-translation-language-field";
    targetLabel.append(document.createTextNode(text("targetLanguage")));
    translationTargetSelect = document.createElement("select");
    translationTargetSelect.name = "target_language";
    targetTranslationLanguages.forEach((code) => {
      translationTargetSelect.appendChild(new Option(languageLabel(code), code));
    });
    translationTargetSelect.addEventListener("change", () => {
      if (translationFeedback) translationFeedback.hidden = true;
    });
    targetLabel.appendChild(translationTargetSelect);

    translationSwapButton = document.createElement("button");
    translationSwapButton.type = "button";
    translationSwapButton.className = "messaging-translation-swap";
    translationSwapButton.textContent = text("swapLanguages");
    translationSwapButton.addEventListener("click", () => {
      if (translationSourceSelect.value === "auto") return;
      const source = translationSourceSelect.value;
      translationSourceSelect.value = translationTargetSelect.value;
      translationTargetSelect.value = source;
      syncTranslationSwap();
    });

    translationFeedback = document.createElement("p");
    translationFeedback.className = "messaging-translation-feedback";
    translationFeedback.setAttribute("role", "alert");
    translationFeedback.hidden = true;

    const done = document.createElement("button");
    done.type = "submit";
    done.className = "assistant-primary-button messaging-translation-done";
    done.textContent = text("done");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "messaging-mobile-sheet-close";
    close.textContent = appCopy("v2Close", copyTable.en.close || "Close");
    close.addEventListener("click", closeTranslationDialog);

    form.append(sourceLabel, targetLabel, translationSwapButton, translationFeedback, done);
    translationDialog.append(heading, form, close);
    translationDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeTranslationDialog();
    });
    document.body.appendChild(translationDialog);
    syncTranslationSwap();
  }

  function openTranslationPreferences(bubble = null) {
    if (!translationDialog || !translationSourceSelect || !translationTargetSelect) return false;
    const preference = conversationPreference();
    pendingTranslationBubble = bubble || null;
    translationSourceSelect.value = sourceTranslationLanguages.includes(preference.sourceLanguage)
      ? preference.sourceLanguage
      : "auto";
    translationTargetSelect.value = targetTranslationLanguages.includes(preference.targetLanguage)
      ? preference.targetLanguage
      : translationTargetLanguage();
    if (translationFeedback) {
      translationFeedback.textContent = "";
      translationFeedback.hidden = true;
    }
    translationDialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    syncTranslationSwap();
    try {
      translationDialog.showModal();
    } catch (_error) {
      translationDialog.setAttribute("open", "");
    }
    translationSourceSelect.focus();
    return true;
  }

  function buildTranslationPreferenceBar() {
    translationPreferenceBar = document.createElement("section");
    translationPreferenceBar.className = "messaging-translation-preference-bar";
    translationPreferenceBar.hidden = true;
    const label = document.createElement("span");
    label.className = "assistant-sr-only";
    label.textContent = text("conversationTranslation");
    translationPreferenceButton = document.createElement("button");
    translationPreferenceButton.type = "button";
    translationPreferenceButton.className = "messaging-translation-preference-button";
    translationPreferenceButton.addEventListener("click", () => openTranslationPreferences());
    translationPreferenceBar.append(label, translationPreferenceButton);
    messageForm.insertBefore(translationPreferenceBar, messageForm.firstChild);
    syncTranslationPreferenceBar();
  }

  function handleConversationDetail(event) {
    currentConversationId = String(
      event.detail?.conversation?.id || app.dataset.activeMessagingConversationId || "",
    );
    syncTranslationPreferenceBar();
  }

  function voiceRuntimeRoot() {
    return messageForm.querySelector('[data-messaging-composer-attachments-v2="true"], .messaging-composer-v2');
  }

  function voiceMenuAction(root) {
    const label = String(app.dataset.composerVoice || "").trim();
    return Array.from(root?.querySelectorAll('[role="menuitem"]') || []).find((item) => (
      label && String(item.textContent || "").includes(label)
    )) || root?.querySelector('[role="menuitem"]:last-child') || null;
  }

  function syncVoicePresentation() {
    const root = voiceRuntimeRoot();
    if (!root || !voiceButton?.isConnected) return;
    const recordPanel = messageForm.querySelector(".messaging-composer-v2-recorder");
    const previewAudio = messageForm.querySelector(".messaging-composer-v2-preview audio");
    const status = messageForm.querySelector(".messaging-composer-v2-status");
    const recordingPhase = recordPanel?.dataset.recordingPhase || "";
    const sending = messageForm.dataset.enterpriseVoiceState === "sending";
    let state = "idle";
    if (sending) state = "sending";
    else if (status?.classList.contains("is-error") && String(status.textContent || "").trim()) state = "error";
    else if (recordingPhase === "stopping") state = "stopping";
    else if (recordingPhase === "permission_request") state = "permission_request";
    else if (recordPanel && !recordPanel.hidden) state = "recording";
    else if (root.classList.contains("is-busy")) state = "permission_request";
    else if (previewAudio) state = "recorded";

    messageForm.dataset.enterpriseVoiceState = state;
    voiceButton.dataset.voiceState = state;
    voiceButton.classList.toggle("is-active", state === "recording");
    voiceButton.setAttribute("aria-pressed", String(state === "recording"));
    const shouldDisableVoice = (
      state === "sending"
      || state === "recorded"
      || state === "permission_request"
      || state === "stopping"
      || document.body.classList.contains("timeblock-call-active")
    );
    // The voice observer watches `disabled`. Avoid writing the same property
    // value on every observer pass, which would enqueue another mutation in
    // some WebKit/Chromium builds and can starve the click handler while the
    // permission request is pending.
    if (voiceButton.disabled !== shouldDisableVoice) {
      voiceButton.disabled = shouldDisableVoice;
    }
    const label = state === "recording"
      ? text("voiceStop")
      : state === "permission_request"
        ? text("voicePermission")
        : state === "recorded"
          ? text("voiceRecorded")
          : state === "sending"
            ? text("voiceSending")
            : state === "error"
              ? text("voiceError")
              : text("voiceStart");
    voiceButton.setAttribute("aria-label", label);
    voiceButton.setAttribute("title", label);
  }

  function installVoiceListeners() {
    if (voiceListenersInstalled) return;
    voiceListenersInstalled = true;
    app.addEventListener("timeblock:messaging:attachment-submit", (event) => {
      if (event.detail?.attachment?.type !== "audio") return;
      messageForm.dataset.enterpriseVoiceState = "sending";
      syncVoicePresentation();
    });
    app.addEventListener("timeblock:messaging:attachment-change", () => {
      if (messageForm.dataset.enterpriseVoiceState !== "sending") syncVoicePresentation();
    });
    app.addEventListener("timeblock:messaging:message-sent", () => {
      if (messageForm.dataset.enterpriseVoiceState !== "sending") return;
      messageForm.dataset.enterpriseVoiceState = "idle";
      window.requestAnimationFrame(syncVoicePresentation);
    });
  }

  function enhanceVoiceComposer() {
    const root = voiceRuntimeRoot();
    const menuAction = voiceMenuAction(root);
    if (!root || !menuAction) return;

    if (!voiceButton?.isConnected) {
      voiceButton = document.createElement("button");
      voiceButton.type = "button";
      voiceButton.className = "assistant-icon-button messaging-enterprise-voice-button";
      voiceButton.dataset.enterpriseVoice = "true";
      const micTemplate = app.querySelector('template[data-icon-template="mic"]');
      const mic = micTemplate?.content.cloneNode(true);
      if (mic) voiceButton.appendChild(mic);
      else voiceButton.textContent = "MIC";
      root.insertAdjacentElement("afterend", voiceButton);
      messageForm.querySelector(".assistant-composer-box")?.classList.add("has-messaging-v2-voice");
      voiceButton.addEventListener("click", () => {
        if (
          voiceButton.disabled
          || document.body.classList.contains("timeblock-call-active")
        ) return;
        const recordPanel = messageForm.querySelector(".messaging-composer-v2-recorder");
        if (recordPanel && !recordPanel.hidden) {
          const state = messageForm.dataset.enterpriseVoiceState || "";
          if (state === "recording" || state === "paused") {
            recordPanel.querySelector(".messaging-composer-v2-record-actions .is-primary")?.click();
          }
          return;
        }
        voiceMenuAction(root)?.click();
      });
      installVoiceListeners();
    }

    voiceObserver?.disconnect();
    voiceObserver = new MutationObserver(syncVoicePresentation);
    voiceObserver.observe(messageForm, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "disabled"],
    });
    syncVoicePresentation();
  }

  function getMetrics() {
    const mobileTranslationButtonsVisible = Array.from(
      threadMessages.querySelectorAll("[data-enterprise-translate]"),
    ).filter((button) => {
      const styles = window.getComputedStyle(button);
      return styles.display !== "none" && styles.visibility !== "hidden";
    }).length;
    const preference = conversationPreference();
    return {
      translation_buttons: threadMessages.querySelectorAll("[data-enterprise-translate]").length,
      mobile_translation_buttons_visible: mobileTranslationButtonsVisible,
      translated_messages: threadMessages.querySelectorAll('[data-translation-state^="translated_"]').length,
      translation_requests: translationRequests,
      translation_source_languages: [...sourceTranslationLanguages],
      translation_target_languages: [...targetTranslationLanguages],
      translation_preference_active: Boolean(preference.active),
      translation_source_language: preference.sourceLanguage,
      translation_target_language: preference.targetLanguage,
      translation_lazy: true,
      voice_runtime_present: Boolean(voiceRuntimeRoot()),
      voice_state: messageForm.dataset.enterpriseVoiceState || "unavailable",
      voice_button_visible: Boolean(voiceButton?.isConnected && !voiceButton.hidden),
      media_acquisition_interaction_driven: true,
    };
  }

  buildTranslationPreferenceBar();
  buildTranslationDialog();
  app.addEventListener("timeblock:messaging:conversation", handleConversationDetail);
  app.addEventListener("timeblock:messaging:messages", handleConversationDetail);
  app.addEventListener("timeblock:messaging:call-state", syncVoicePresentation);
  enhanceMessageTranslations();
  enhanceVoiceComposer();

  threadObserver = new MutationObserver(enhanceMessageTranslations);
  threadObserver.observe(threadMessages, { childList: true, subtree: true });
  capabilityObserver = new MutationObserver(() => {
    if (!voiceButton?.isConnected) enhanceVoiceComposer();
  });
  capabilityObserver.observe(messageForm, { childList: true, subtree: true });

  window.addEventListener("pagehide", () => {
    closeTranslationDialog();
    window.TimeblockMessagingComposerAttachmentsV2?.dispose?.(messageForm);
    threadObserver?.disconnect();
    capabilityObserver?.disconnect();
    voiceObserver?.disconnect();
  }, { once: true });

  global.TimeblockMessagingCapabilitySurfacesV2 = Object.freeze({
    getMetrics,
    openTranslationPreferences,
    openTranslationForBubble: openTranslationPreferences,
    getTranslationActionLabel: translationActionLabel,
    sourceTranslationLanguages: [...sourceTranslationLanguages],
    targetTranslationLanguages: [...targetTranslationLanguages],
    translationRuntimeEndpoint: "/translator/api/text",
    translationLazy: true,
    voiceRuntimeDelegated: true,
  });
}(typeof window !== "undefined" ? window : globalThis));
