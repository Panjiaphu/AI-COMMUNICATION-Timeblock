(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  const messagesPanel = app?.querySelector('[data-mode-panel="messages"]');
  const layout = messagesPanel?.querySelector("[data-messaging-layout]");
  const threadColumn = messagesPanel?.querySelector(".assistant-thread-column");
  const threadHeader = messagesPanel?.querySelector(".assistant-thread-header");
  const threadMessages = messagesPanel?.querySelector("[data-thread-messages]");
  const threadTitle = messagesPanel?.querySelector("[data-thread-title]");
  const threadBack = messagesPanel?.querySelector("[data-thread-back]");
  const composer = messagesPanel?.querySelector("[data-message-form]");
  const composerStatus = messagesPanel?.querySelector("[data-call-status]");
  const toolbar = messagesPanel?.querySelector(".messaging-v2-thread-toolbar");

  if (
    !app
    || !messagesPanel
    || !layout
    || !threadColumn
    || !threadHeader
    || !threadMessages
    || !composer
  ) return;

  const MOBILE_QUERY = window.matchMedia(
    "(max-width: 760px), (max-height: 500px) and (max-width: 900px)",
  );
  const IMAGE_DOWNLOAD_RUNTIME = "enabled_against_canonical_backend";
  const locale = String(app.dataset.locale || "vi");
  const COPY = {
    vi: {
      more: "Tùy chọn cuộc trò chuyện",
      settings: "Cài đặt cuộc trò chuyện",
      conversationTranslation: "Dịch cuộc trò chuyện",
      security: "Thông tin bảo mật",
      close: "Đóng",
      actions: "Thao tác tin nhắn",
      older: "Tải tin cũ hơn",
      image: "Xem ảnh",
      download: "Tải ảnh",
      downloadUnavailable: "Ảnh không còn khả dụng hoặc bạn không có quyền truy cập.",
      downloadExpired: "Ảnh này đã hết hạn.",
      downloadRetry: "Không thể tải ảnh. Vui lòng thử lại.",
      downloadSavedWarning: "Bản ảnh đã tải xuống thiết bị sẽ không bị Timeblock tự động xóa.",
      back: "Quay lại danh sách trò chuyện",
    },
    en: {
      more: "Conversation options",
      settings: "Conversation settings",
      conversationTranslation: "Conversation translation",
      security: "Security information",
      close: "Close",
      actions: "Message actions",
      older: "Load older messages",
      image: "View image",
      download: "Download image",
      downloadUnavailable: "The image is unavailable or you are not authorized to access it.",
      downloadExpired: "This image has expired.",
      downloadRetry: "The image could not be downloaded. Please try again.",
      downloadSavedWarning: "A copy downloaded to your device will not be automatically deleted by Timeblock.",
      back: "Back to conversations",
    },
    "zh-TW": {
      more: "對話選項",
      settings: "對話設定",
      conversationTranslation: "翻譯對話",
      security: "安全資訊",
      close: "關閉",
      actions: "訊息操作",
      older: "載入較舊訊息",
      image: "檢視圖片",
      download: "下載圖片",
      downloadUnavailable: "圖片已無法取得，或您沒有存取權限。",
      downloadExpired: "此圖片已過期。",
      downloadRetry: "無法下載圖片，請再試一次。",
      downloadSavedWarning: "下載到裝置的圖片副本不會由 Timeblock 自動刪除。",
      back: "返回對話列表",
    },
  };
  const copy = COPY[locale] || COPY.en;
  const initialSecurityNote = String(composerStatus?.textContent || "").trim();
  const state = {
    longPressTimer: 0,
    longPressStartX: 0,
    longPressStartY: 0,
    longPressBubble: null,
    suppressClickUntil: 0,
    messageSheetScrollGuardUntil: 0,
  };

  let overflowButton = null;
  let headerAvatar = null;
  let conversationSheet = null;
  let securityCopy = null;
  let messageSheet = null;
  let messageActions = null;
  let imageViewer = null;
  let imageViewerImage = null;
  let imageDownload = null;
  let imageDownloadFeedback = null;
  let loadOlderButton = null;
  let toolbarObserver = null;
  let layoutObserver = null;
  let titleObserver = null;
  let messagesObserver = null;
  let statusObserver = null;

  function isImmersiveConversation() {
    return Boolean(
      MOBILE_QUERY.matches
      && layout.classList.contains("has-thread")
      && messagesPanel.classList.contains("is-active")
      && !messagesPanel.hidden
      && !composer.hidden
      && String(app.dataset.activeMessagingConversationId || "").trim(),
    );
  }

  function safeDialogOpen(dialog, focusTarget) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.requestAnimationFrame(() => focusTarget?.focus?.());
  }

  function safeSheetOpen(dialog, focusTarget) {
    if (!dialog) return;
    if (typeof dialog.show === "function") {
      if (!dialog.open) dialog.show();
    } else {
      dialog.setAttribute("open", "");
    }
    window.requestAnimationFrame(() => focusTarget?.focus?.());
  }

  function safeDialogClose(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function initials(value) {
    const parts = String(value || "Timeblock").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "T";
  }

  function updateHeaderAvatar() {
    if (headerAvatar) headerAvatar.textContent = initials(threadTitle?.textContent);
  }

  function mountHeaderControls() {
    if (!headerAvatar) {
      headerAvatar = document.createElement("span");
      headerAvatar.className = "messaging-mobile-thread-avatar";
      headerAvatar.setAttribute("aria-hidden", "true");
      const copyWrap = threadTitle?.parentElement;
      copyWrap?.before(headerAvatar);
      updateHeaderAvatar();
    }

    if (!overflowButton) {
      overflowButton = document.createElement("button");
      overflowButton.type = "button";
      overflowButton.className = "assistant-icon-button messaging-mobile-overflow-button";
      overflowButton.dataset.messagingMobileOverflow = "true";
      overflowButton.textContent = "⋯";
      overflowButton.setAttribute("aria-label", copy.more);
      overflowButton.setAttribute("title", copy.more);
      overflowButton.addEventListener("click", () => {
        if (!isImmersiveConversation()) return;
        securityCopy.hidden = true;
        safeDialogOpen(conversationSheet, conversationSheet.querySelector("button"));
      });
      threadHeader.appendChild(overflowButton);
    }

    if (threadBack) {
      threadBack.setAttribute("aria-label", copy.back);
      threadBack.setAttribute("title", copy.back);
    }
  }

  function buildConversationSheet() {
    conversationSheet = document.createElement("dialog");
    conversationSheet.className = "messaging-mobile-sheet messaging-mobile-conversation-sheet";
    conversationSheet.setAttribute("aria-label", copy.more);

    const heading = document.createElement("strong");
    heading.className = "messaging-mobile-sheet-title";
    heading.textContent = copy.more;

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "messaging-mobile-sheet-action";
    settings.textContent = copy.settings;
    settings.addEventListener("click", () => {
      const source = Array.from(toolbar?.querySelectorAll("button") || []).find(
        (button) => button.classList.contains("is-primary"),
      );
      safeDialogClose(conversationSheet);
      source?.click();
    });

    const translation = document.createElement("button");
    translation.type = "button";
    translation.className = "messaging-mobile-sheet-action";
    translation.textContent = actionLabel(
      "v2TranslationConversation",
      copy.conversationTranslation,
    );
    translation.addEventListener("click", () => {
      safeDialogClose(conversationSheet);
      window.TimeblockMessagingCapabilitySurfacesV2?.openTranslationPreferences?.();
    });

    const security = document.createElement("button");
    security.type = "button";
    security.className = "messaging-mobile-sheet-action";
    security.textContent = copy.security;
    security.setAttribute("aria-expanded", "false");
    security.addEventListener("click", () => {
      securityCopy.hidden = !securityCopy.hidden;
      security.setAttribute("aria-expanded", String(!securityCopy.hidden));
    });

    securityCopy = document.createElement("p");
    securityCopy.className = "messaging-mobile-security-copy";
    securityCopy.textContent = initialSecurityNote;
    securityCopy.hidden = true;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "messaging-mobile-sheet-close";
    close.textContent = copy.close;
    close.addEventListener("click", () => safeDialogClose(conversationSheet));

    conversationSheet.append(heading, settings, translation, security, securityCopy, close);
    document.body.appendChild(conversationSheet);
  }

  function actionLabel(key, fallback) {
    const value = app.dataset[key];
    return String(value || fallback || "").trim();
  }

  function findSourceAction(bubble, labels) {
    const wanted = new Set(labels.filter(Boolean));
    return Array.from(
      bubble.querySelectorAll(".messaging-v2-message-actions .messaging-v2-message-action"),
    ).find((button) => wanted.has(String(button.textContent || "").trim())) || null;
  }

  function proxySourceAction(bubble, label, sourceLabels, modifier = "") {
    const source = findSourceAction(bubble, sourceLabels);
    if (!source) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `messaging-mobile-sheet-action ${modifier}`.trim();
    button.textContent = label || source.textContent;
    button.addEventListener("click", () => {
      closeMessageSheet();
      source.click();
    });
    return button;
  }

  function buildReactionAction(bubble) {
    const reactLabel = actionLabel("v2MessageReact", "React");
    const source = findSourceAction(bubble, [reactLabel]);
    if (!source) return null;

    const wrap = document.createElement("div");
    wrap.className = "messaging-mobile-reaction-action";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "messaging-mobile-sheet-action";
    toggle.textContent = reactLabel;
    toggle.setAttribute("aria-expanded", "false");

    const choices = document.createElement("div");
    choices.className = "messaging-mobile-reaction-choices";
    choices.hidden = true;
    ["👍", "❤️", "😂"].forEach((emoji) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "messaging-mobile-reaction-choice";
      button.textContent = emoji;
      button.setAttribute("aria-label", `${reactLabel} ${emoji}`);
      button.addEventListener("click", () => {
        source.click();
        const palette = source.parentElement?.querySelector(".messaging-v2-reaction-palette");
        const sourceChoice = Array.from(palette?.querySelectorAll("button") || []).find(
          (candidate) => String(candidate.textContent || "").trim() === emoji,
        );
        sourceChoice?.click();
        closeMessageSheet();
      });
      choices.appendChild(button);
    });

    toggle.addEventListener("click", () => {
      choices.hidden = !choices.hidden;
      toggle.setAttribute("aria-expanded", String(!choices.hidden));
    });
    wrap.append(toggle, choices);
    return wrap;
  }

  function buildTranslationAction(bubble) {
    const capability = window.TimeblockMessagingCapabilitySurfacesV2;
    if (!capability?.openTranslationForBubble) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "messaging-mobile-sheet-action";
    button.textContent = capability.getTranslationActionLabel?.(bubble)
      || actionLabel("v2MessageTranslate", "Translate");
    button.addEventListener("click", () => {
      closeMessageSheet();
      capability.openTranslationForBubble(bubble);
    });
    return button;
  }

  function populateMessageActions(bubble) {
    messageActions.replaceChildren();
    const reply = proxySourceAction(
      bubble,
      actionLabel("v2MessageReply", "Reply"),
      [actionLabel("v2MessageReply", "Reply")],
    );
    const translation = buildTranslationAction(bubble);
    const reaction = buildReactionAction(bubble);
    const pin = proxySourceAction(
      bubble,
      "",
      [
        actionLabel("v2MessagePin", "Pin"),
        actionLabel("v2MessageUnpin", "Unpin"),
      ],
    );
    const edit = proxySourceAction(
      bubble,
      actionLabel("v2MessageEdit", "Edit"),
      [actionLabel("v2MessageEdit", "Edit")],
    );
    const remove = proxySourceAction(
      bubble,
      actionLabel("v2MessageDelete", "Delete"),
      [actionLabel("v2MessageDelete", "Delete")],
      "is-danger",
    );
    [reply, translation, reaction, pin, edit, remove].filter(Boolean).forEach((node) => {
      messageActions.appendChild(node);
    });
  }

  function closeMessageSheet() {
    if (!messageSheet) return;
    safeDialogClose(messageSheet);
    delete messageSheet.dataset.messageId;
  }

  function openMessageActions(bubble) {
    if (!isImmersiveConversation() || !bubble) return;
    populateMessageActions(bubble);
    if (!messageActions.childElementCount) return;
    state.messageSheetScrollGuardUntil = Date.now() + 250;
    messageSheet.dataset.messageId = String(bubble.dataset.messageId || "");
    safeSheetOpen(messageSheet, messageActions.querySelector("button"));
  }

  function buildMessageSheet() {
    messageSheet = document.createElement("dialog");
    messageSheet.className = "messaging-mobile-sheet messaging-mobile-message-sheet";
    messageSheet.setAttribute("aria-label", copy.actions);
    messageSheet.style.position = "fixed";
    messageSheet.style.inset = "auto 0 0 0";
    messageSheet.style.zIndex = "2100";
    const heading = document.createElement("strong");
    heading.className = "messaging-mobile-sheet-title";
    heading.textContent = copy.actions;
    messageActions = document.createElement("div");
    messageActions.className = "messaging-mobile-message-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "messaging-mobile-sheet-close";
    close.textContent = copy.close;
    close.addEventListener("click", closeMessageSheet);
    messageSheet.append(heading, messageActions, close);
    document.body.appendChild(messageSheet);
  }

  function safeSameOriginUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return url.origin === window.location.origin ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function buildMessagingDownloadUrl(attachmentId) {
    const normalized = String(attachmentId ?? "").trim();
    if (!normalized) return "";
    return `/api/messaging/media/${encodeURIComponent(normalized)}/download`;
  }

  function attachmentIdFromImage(image) {
    const declared = String(image?.dataset.attachmentId || image?.closest("figure")?.dataset.attachmentId || "").trim();
    if (declared) return declared;
    const source = safeSameOriginUrl(image?.currentSrc || image?.src || "");
    if (!source) return "";
    try {
      const path = new URL(source).pathname;
      const match = path.match(/^\/api\/messaging\/media\/([^/]+)$/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch (_error) {
      return "";
    }
  }

  function expiresAtFromImage(image) {
    return String(image?.dataset.expiresAt || image?.closest("figure")?.dataset.expiresAt || "").trim();
  }

  function imageDownloadEnabled() {
    return IMAGE_DOWNLOAD_RUNTIME === "enabled_against_canonical_backend";
  }

  function setImageDownloadFeedback(message, isError = false) {
    if (!imageDownloadFeedback) return;
    imageDownloadFeedback.textContent = message || "";
    imageDownloadFeedback.hidden = !message;
    imageDownloadFeedback.setAttribute("role", isError ? "alert" : "status");
  }

  async function downloadCurrentImage() {
    const attachmentId = String(imageViewer?.dataset.attachmentId || "").trim();
    const downloadUrl = buildMessagingDownloadUrl(attachmentId);
    if (!imageDownloadEnabled() || !downloadUrl) {
      setImageDownloadFeedback(copy.downloadUnavailable, true);
      return;
    }

    const expiresAt = String(imageViewer?.dataset.expiresAt || "").trim();
    if (expiresAt) setImageDownloadFeedback(copy.downloadSavedWarning, false);
    else setImageDownloadFeedback("");
    imageDownload.disabled = true;
    try {
      const response = await fetch(downloadUrl, {
        method: "GET",
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (response.status === 404) {
        setImageDownloadFeedback(copy.downloadUnavailable, true);
        return;
      }
      if (response.status === 410) {
        setImageDownloadFeedback(copy.downloadExpired, true);
        return;
      }
      if (!response.ok) {
        setImageDownloadFeedback(copy.downloadRetry, true);
        return;
      }
      const blob = await response.blob();
      if (!blob.size) {
        setImageDownloadFeedback(copy.downloadRetry, true);
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `timeblock-image-${attachmentId}`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      if (expiresAt) setImageDownloadFeedback(copy.downloadSavedWarning, false);
    } catch (_error) {
      setImageDownloadFeedback(copy.downloadRetry, true);
    } finally {
      imageDownload.disabled = false;
    }
  }

  function openImageViewer(image) {
    const source = safeSameOriginUrl(image.currentSrc || image.src);
    if (!source) return;
    imageViewerImage.src = source;
    imageViewerImage.alt = image.alt || copy.image;

    const attachmentId = attachmentIdFromImage(image);
    const expiresAt = expiresAtFromImage(image);
    imageViewer.dataset.attachmentId = attachmentId;
    imageViewer.dataset.expiresAt = expiresAt;
    imageViewer.dataset.imageDownloadRuntime = IMAGE_DOWNLOAD_RUNTIME;
    imageDownload.hidden = !(imageDownloadEnabled() && attachmentId);
    setImageDownloadFeedback("");
    safeDialogOpen(imageViewer, imageViewer.querySelector("button"));
  }

  function buildImageViewer() {
    imageViewer = document.createElement("dialog");
    imageViewer.className = "messaging-mobile-image-viewer";
    imageViewer.setAttribute("aria-label", copy.image);

    const controls = document.createElement("div");
    controls.className = "messaging-mobile-image-controls";
    imageDownload = document.createElement("button");
    imageDownload.type = "button";
    imageDownload.className = "messaging-mobile-image-download";
    imageDownload.textContent = copy.download;
    imageDownload.hidden = true;
    imageDownload.addEventListener("click", downloadCurrentImage);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "messaging-mobile-image-close";
    close.textContent = "×";
    close.setAttribute("aria-label", copy.close);
    close.addEventListener("click", () => safeDialogClose(imageViewer));
    controls.append(imageDownload, close);

    imageDownloadFeedback = document.createElement("p");
    imageDownloadFeedback.className = "messaging-mobile-image-feedback";
    imageDownloadFeedback.hidden = true;
    imageDownloadFeedback.setAttribute("aria-live", "polite");

    imageViewerImage = document.createElement("img");
    imageViewerImage.alt = copy.image;
    imageViewer.append(controls, imageDownloadFeedback, imageViewerImage);
    imageViewer.addEventListener("click", (event) => {
      if (event.target === imageViewer) safeDialogClose(imageViewer);
    });
    imageViewer.addEventListener("close", () => {
      imageViewerImage.removeAttribute("src");
      imageDownload.hidden = true;
      imageDownload.disabled = false;
      setImageDownloadFeedback("");
      delete imageViewer.dataset.attachmentId;
      delete imageViewer.dataset.expiresAt;
    });
    document.body.appendChild(imageViewer);
  }

  function sourceLoadOlderButton() {
    const olderLabel = actionLabel("v2ThreadLoadOlder", "");
    return Array.from(toolbar?.querySelectorAll("button") || []).find(
      (button) => String(button.textContent || "").trim() === olderLabel,
    ) || null;
  }

  function syncLoadOlderControl() {
    if (!loadOlderButton) return;
    const source = sourceLoadOlderButton();
    const visible = isImmersiveConversation()
      && Boolean(source)
      && !source.hidden
      && !source.disabled;
    loadOlderButton.hidden = !visible;
    loadOlderButton.disabled = !visible;
    threadColumn.classList.toggle("has-mobile-older-history", visible);
  }

  function mountLoadOlderControl() {
    loadOlderButton = document.createElement("button");
    loadOlderButton.type = "button";
    loadOlderButton.className = "messaging-mobile-load-older";
    loadOlderButton.textContent = actionLabel("v2ThreadLoadOlder", copy.older) || copy.older;
    loadOlderButton.hidden = true;
    loadOlderButton.addEventListener("click", () => {
      const source = sourceLoadOlderButton();
      if (!source || source.disabled) return;
      loadOlderButton.disabled = true;
      source.click();
    });
    threadColumn.appendChild(loadOlderButton);
    syncLoadOlderControl();
  }

  function suppressPermanentSecurityCopy() {
    if (!composerStatus || !initialSecurityNote || !isImmersiveConversation()) return;
    if (String(composerStatus.textContent || "").trim() === initialSecurityNote) {
      composerStatus.textContent = "";
    }
  }

  function annotateMessageBubbles() {
    threadMessages.querySelectorAll(".assistant-thread-bubble").forEach((bubble) => {
      if (bubble.dataset.messagingMobileActionReady === "true") return;
      bubble.dataset.messagingMobileActionReady = "true";
      bubble.tabIndex = 0;
      bubble.setAttribute("aria-haspopup", "dialog");
    });
  }

  function closeMobileSurfaces() {
    closeMessageSheet();
    safeDialogClose(conversationSheet);
    safeDialogClose(imageViewer);
  }

  function syncImmersiveState() {
    const active = isImmersiveConversation();
    document.body.classList.toggle("timeblock-mobile-immersive-conversation", active);
    app.classList.toggle("is-mobile-immersive-conversation", active);
    if (active) {
      updateHeaderAvatar();
      annotateMessageBubbles();
      suppressPermanentSecurityCopy();
    } else {
      closeMobileSurfaces();
    }
    syncLoadOlderControl();
  }

  function clearLongPress() {
    if (state.longPressTimer) window.clearTimeout(state.longPressTimer);
    state.longPressTimer = 0;
    state.longPressBubble = null;
  }

  function hasActiveTextSelection() {
    return Boolean(String(window.getSelection?.()?.toString() || "").trim());
  }

  function shouldIgnoreMessageGesture(target, longPress = false) {
    if (!target) return true;
    if (hasActiveTextSelection()) return true;
    if (target.closest("a, button, input, textarea, select, audio, video, label")) return true;
    if (target.closest(".messaging-v2-reply-preview")) return true;
    if (longPress && target.closest(".assistant-thread-text")) return true;
    return false;
  }

  function bindDelegatedMessageInteractions() {
    threadMessages.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const image = target.closest("figure.assistant-thread-image img");
      if (image) {
        event.preventDefault();
        openImageViewer(image);
        return;
      }
      if (Date.now() < state.suppressClickUntil) return;
      if (shouldIgnoreMessageGesture(target)) return;
      const bubble = target.closest(".assistant-thread-bubble");
      if (bubble) openMessageActions(bubble);
    });

    threadMessages.addEventListener("keydown", (event) => {
      if (!new Set(["Enter", " "]).has(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      const bubble = target?.closest(".assistant-thread-bubble");
      if (!bubble || target !== bubble || !isImmersiveConversation()) return;
      event.preventDefault();
      openMessageActions(bubble);
    });

    threadMessages.addEventListener("pointerdown", (event) => {
      if (!isImmersiveConversation() || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (shouldIgnoreMessageGesture(target, true)) return;
      const bubble = target.closest(".assistant-thread-bubble");
      if (!bubble) return;
      clearLongPress();
      state.longPressStartX = event.clientX;
      state.longPressStartY = event.clientY;
      state.longPressBubble = bubble;
      state.longPressTimer = window.setTimeout(() => {
        const activeBubble = state.longPressBubble;
        state.longPressTimer = 0;
        state.longPressBubble = null;
        state.suppressClickUntil = Date.now() + 700;
        openMessageActions(activeBubble);
      }, 420);
    }, { passive: true });

    threadMessages.addEventListener("pointermove", (event) => {
      if (!state.longPressTimer) return;
      if (
        Math.abs(event.clientX - state.longPressStartX) > 8
        || Math.abs(event.clientY - state.longPressStartY) > 8
      ) clearLongPress();
    }, { passive: true });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      threadMessages.addEventListener(type, clearLongPress, { passive: true });
    });
    threadMessages.addEventListener("scroll", () => {
      clearLongPress();
      if (Date.now() < state.messageSheetScrollGuardUntil) return;
      closeMessageSheet();
    }, { passive: true });
  }

  function bindLifecycle() {
    layoutObserver = new MutationObserver(syncImmersiveState);
    layoutObserver.observe(layout, { attributes: true, attributeFilter: ["class", "hidden"] });

    titleObserver = new MutationObserver(updateHeaderAvatar);
    if (threadTitle) titleObserver.observe(threadTitle, { childList: true, subtree: true, characterData: true });

    messagesObserver = new MutationObserver(() => {
      annotateMessageBubbles();
      syncLoadOlderControl();
    });
    messagesObserver.observe(threadMessages, { childList: true, subtree: true });

    if (toolbar) {
      toolbarObserver = new MutationObserver(syncLoadOlderControl);
      toolbarObserver.observe(toolbar, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
        attributeFilter: ["hidden", "disabled"],
      });
    }

    if (composerStatus) {
      statusObserver = new MutationObserver(suppressPermanentSecurityCopy);
      statusObserver.observe(composerStatus, { childList: true, subtree: true, characterData: true });
    }

    document.addEventListener("pointerdown", (event) => {
      if (!messageSheet?.open) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || messageSheet.contains(target)) return;
      const bubble = threadMessages.contains(target)
        ? target.closest(".assistant-thread-bubble")
        : null;
      const image = target.closest("figure.assistant-thread-image img");
      if (bubble && !image && !shouldIgnoreMessageGesture(target)) return;
      closeMessageSheet();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !messageSheet?.open) return;
      event.preventDefault();
      closeMessageSheet();
    });

    MOBILE_QUERY.addEventListener?.("change", syncImmersiveState);
    window.addEventListener("orientationchange", syncImmersiveState, { passive: true });
    window.addEventListener("pageshow", syncImmersiveState, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncImmersiveState();
    });
    threadBack?.addEventListener("click", () => {
      closeMobileSurfaces();
      window.requestAnimationFrame(syncImmersiveState);
    });
    app.addEventListener("timeblock:messaging:conversation", () => {
      window.requestAnimationFrame(syncImmersiveState);
    });
    app.addEventListener("timeblock:messaging:messages", () => {
      window.requestAnimationFrame(() => {
        annotateMessageBubbles();
        syncLoadOlderControl();
        suppressPermanentSecurityCopy();
      });
    });
    window.addEventListener("pagehide", () => {
      clearLongPress();
      [toolbarObserver, layoutObserver, titleObserver, messagesObserver, statusObserver]
        .forEach((observer) => observer?.disconnect());
      closeMobileSurfaces();
      document.body.classList.remove("timeblock-mobile-immersive-conversation");
      app.classList.remove("is-mobile-immersive-conversation");
    }, { once: true });
  }

  window.TimeblockMessagingMobile = Object.freeze({
    buildMessagingDownloadUrl,
    imageDownloadRuntime: IMAGE_DOWNLOAD_RUNTIME,
  });

  buildConversationSheet();
  buildMessageSheet();
  buildImageViewer();
  mountHeaderControls();
  mountLoadOlderControl();
  bindDelegatedMessageInteractions();
  bindLifecycle();
  annotateMessageBubbles();
  syncImmersiveState();
}());
