(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  const messagesPanel = app?.querySelector('[data-mode-panel="messages"]');
  if (!app || !messagesPanel) return;

  const state = {
    me: {
      owner_type: app.dataset.actorType || "",
      owner_id: String(app.dataset.actorId || ""),
    },
    conversation: null,
    messages: new Map(),
    page: null,
    filters: { view: "inbox", pinned_only: false, unread_only: false },
    replyMessage: null,
    actionMessage: null,
    loadingOlder: false,
    eventCursor: 0,
    eventBootstrapping: true,
    eventFailures: 0,
    eventTimer: 0,
    eventInFlight: false,
    eventSource: null,
    eventReconnectTimer: 0,
    authExpired: false,
    eventIds: new Set(),
    refreshTimer: 0,
    pendingRefreshScope: "",
    mailboxAutoLockTimer: 0,
    conversationActionMode: "",
    messageDeleteMode: "",
    activeReaction: null,
    syncStatus: "",
  };

  const ui = {};
  const dialogReturnFocus = new WeakMap();
  const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  function text(key) {
    const property = `v2${String(key || "").charAt(0).toUpperCase()}${String(key || "").slice(1)}`;
    return app.dataset[property] || "";
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = String(content);
    return node;
  }

  function actionButton(label, className = "messaging-v2-button") {
    const button = element("button", className, label);
    button.type = "button";
    return button;
  }

  function emit(name, detail = {}) {
    app.dispatchEvent(new CustomEvent(`timeblock:messaging:${name}`, { detail }));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) stopRealtimeForExpiredSession();
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || text("actionFailed"));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function jsonOptions(method, body) {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    };
  }

  function showNotice(message, isError = false) {
    if (!ui.notice) return;
    ui.notice.textContent = message || "";
    ui.notice.classList.toggle("is-error", Boolean(isError));
    ui.notice.setAttribute("role", isError ? "alert" : "status");
  }

  function focusableElements(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (node) => !node.hidden && !node.closest("[hidden]"),
    );
  }

  function restoreDialogFocus(dialog) {
    const returnFocus = dialogReturnFocus.get(dialog);
    dialogReturnFocus.delete(dialog);
    if (returnFocus?.isConnected && typeof returnFocus.focus === "function") {
      returnFocus.focus();
    }
  }

  function wireDialog(dialog) {
    if (dialog.dataset.messagingV2DialogWired === "true") return;
    dialog.dataset.messagingV2DialogWired = "true";
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(dialog);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("close", () => restoreDialogFocus(dialog));
  }

  function showDialog(dialog, returnFocus, initialFocus) {
    wireDialog(dialog);
    dialogReturnFocus.set(dialog, returnFocus || document.activeElement);
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.setTimeout(() => {
      const target = initialFocus || focusableElements(dialog)[0] || dialog;
      target?.focus?.();
    }, 0);
  }

  function closeDialog(dialog, restoreFocus = true) {
    if (!restoreFocus) dialogReturnFocus.delete(dialog);
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
      return;
    }
    dialog.removeAttribute("open");
    if (restoreFocus) restoreDialogFocus(dialog);
  }

  function dialogHeader(title, dialog) {
    const header = element("header", "messaging-v2-dialog-header");
    const heading = element("h2", "", title);
    heading.id = `messaging-v2-dialog-title-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute("aria-labelledby", heading.id);
    header.appendChild(heading);
    const close = actionButton(text("close"), "messaging-v2-icon-button");
    close.setAttribute("aria-label", text("close"));
    close.setAttribute("title", text("close"));
    close.textContent = "\u00d7";
    close.addEventListener("click", () => closeDialog(dialog));
    header.appendChild(close);
    return header;
  }

  function toggleField(name, label) {
    const wrapper = element("label", "messaging-v2-toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    wrapper.append(input, element("span", "", label));
    return { wrapper, input };
  }

  function mountFilters() {
    const list = messagesPanel.querySelector("[data-conversation-list]");
    if (!list || list.previousElementSibling?.matches("[data-messaging-v2-filters]")) return;

    const bar = element("div", "messaging-v2-filters");
    bar.dataset.messagingV2Filters = "";
    const label = element("label", "assistant-sr-only", text("filtersLabel"));
    label.htmlFor = "messaging-v2-view";
    const view = document.createElement("select");
    view.id = "messaging-v2-view";
    view.setAttribute("aria-label", text("filtersLabel"));
    [
      ["inbox", text("filtersInbox")],
      ["archived", text("filtersArchived")],
      ["restricted", text("filtersRestricted")],
    ].forEach(([value, labelText]) => view.add(new Option(labelText, value)));
    const pinned = actionButton(text("filtersPinned"), "messaging-v2-filter-toggle");
    const unread = actionButton(text("filtersUnread"), "messaging-v2-filter-toggle");
    [pinned, unread].forEach((button) => button.setAttribute("aria-pressed", "false"));
    const sync = element("span", "messaging-v2-sync is-connecting");
    sync.setAttribute("role", "status");
    sync.setAttribute("aria-live", "polite");
    sync.setAttribute("aria-atomic", "true");
    sync.append(
      element("span", "messaging-v2-sync-dot"),
      element("span", "messaging-v2-sync-copy", text("syncConnecting")),
    );
    bar.append(label, view, pinned, unread, sync);
    list.before(bar);

    ui.filterBar = bar;
    ui.view = view;
    ui.pinned = pinned;
    ui.unread = unread;
    ui.sync = sync;
    ui.syncCopy = sync.querySelector(".messaging-v2-sync-copy");

    const requestFilter = () => emit("filter", { ...state.filters });
    view.addEventListener("change", () => {
      state.filters.view = view.value;
      requestFilter();
    });
    pinned.addEventListener("click", () => {
      state.filters.pinned_only = !state.filters.pinned_only;
      pinned.setAttribute("aria-pressed", String(state.filters.pinned_only));
      requestFilter();
    });
    unread.addEventListener("click", () => {
      state.filters.unread_only = !state.filters.unread_only;
      unread.setAttribute("aria-pressed", String(state.filters.unread_only));
      requestFilter();
    });
  }

  function mountThreadToolbar() {
    const container = messagesPanel.querySelector("[data-thread-messages]");
    const column = container?.closest(".assistant-thread-column");
    if (!container || !column) return;
    column.classList.add("messaging-v2-mounted");

    const toolbar = element("div", "messaging-v2-thread-toolbar");
    toolbar.hidden = true;
    const loadOlder = actionButton(text("threadLoadOlder"), "messaging-v2-button");
    loadOlder.hidden = true;
    const spacer = element("span", "messaging-v2-toolbar-spacer");
    const notice = element("span", "messaging-v2-notice");
    notice.setAttribute("aria-live", "polite");
    const jumpLatest = actionButton(
      text("threadJumpLatest"),
      "messaging-v2-button",
    );
    jumpLatest.hidden = true;
    const lock = actionButton(text("mailboxLockNow"), "messaging-v2-button");
    lock.hidden = true;
    const settings = actionButton(text("threadSettings"), "messaging-v2-button is-primary");
    settings.disabled = true;
    toolbar.append(loadOlder, spacer, notice, jumpLatest, lock, settings);
    container.before(toolbar);

    ui.threadToolbar = toolbar;
    ui.loadOlder = loadOlder;
    ui.notice = notice;
    ui.jumpLatest = jumpLatest;
    ui.lockButton = lock;
    ui.settingsButton = settings;

    loadOlder.addEventListener("click", () => {
      if (state.loadingOlder || !state.page?.has_more_before) return;
      state.loadingOlder = true;
      loadOlder.disabled = true;
      emit("load-older");
      window.setTimeout(() => {
        if (!state.loadingOlder) return;
        state.loadingOlder = false;
        loadOlder.disabled = !state.page?.has_more_before;
      }, 8000);
    });
    jumpLatest.addEventListener("click", () => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      jumpLatest.hidden = true;
    });
    container.addEventListener("scroll", () => {
      const distance = container.scrollHeight
        - container.scrollTop
        - container.clientHeight;
      if (distance < 90) jumpLatest.hidden = true;
    }, { passive: true });
    lock.addEventListener("click", () => toggleMailboxLock(lock));
    settings.addEventListener("click", () => openSettings(settings));
  }

  function mountReplyBar() {
    const composer = messagesPanel.querySelector("[data-message-form]");
    if (!composer) return;
    const bar = element("div", "messaging-v2-reply-bar");
    bar.hidden = true;
    const copy = element("div", "messaging-v2-reply-copy");
    const heading = element("strong", "", text("replyingTo"));
    const preview = element("span");
    copy.append(heading, preview);
    const cancel = actionButton(text("cancel"), "messaging-v2-icon-button");
    cancel.setAttribute("aria-label", text("cancel"));
    cancel.setAttribute("title", text("cancel"));
    cancel.textContent = "\u00d7";
    cancel.addEventListener("click", clearReply);
    bar.append(copy, cancel);
    composer.before(bar);
    ui.replyBar = bar;
    ui.replyPreview = preview;
  }

  function buildSettingsDialog() {
    const dialog = element("dialog", "messaging-v2-dialog messaging-v2-settings-dialog");
    const form = element("form", "messaging-v2-dialog-body");
    form.method = "dialog";
    form.appendChild(dialogHeader(text("settingsTitle"), dialog));

    const basics = element("fieldset", "messaging-v2-fieldset");
    const pinned = toggleField("pinned", text("settingsPin"));
    const archived = toggleField("archived", text("settingsArchive"));
    const markedUnread = toggleField("marked_unread", text("settingsMarkUnread"));
    const muted = toggleField("muted", text("settingsMute"));
    const muteDuration = element("label", "messaging-v2-field");
    muteDuration.appendChild(element("span", "", text("settingsMuteDuration")));
    const muteSelect = document.createElement("select");
    [
      ["3600", text("settingsMuteOneHour")],
      ["28800", text("settingsMuteEightHours")],
      ["604800", text("settingsMuteOneWeek")],
    ].forEach(([value, label]) => muteSelect.add(new Option(label, value)));
    muteDuration.appendChild(muteSelect);
    const notification = element("label", "messaging-v2-field");
    notification.appendChild(element("span", "", text("settingsNotification")));
    const notificationSelect = document.createElement("select");
    [
      ["all", text("settingsNotificationAll")],
      ["mentions", text("settingsNotificationMentions")],
      ["none", text("settingsNotificationNone")],
    ].forEach(([value, label]) => notificationSelect.add(new Option(label, value)));
    notification.appendChild(notificationSelect);
    const privateLabel = element("label", "messaging-v2-field");
    privateLabel.append(
      element("span", "", text("settingsLabel")),
      element("small", "", text("settingsLabelHint")),
    );
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.maxLength = 40;
    privateLabel.appendChild(labelInput);
    basics.append(
      pinned.wrapper,
      archived.wrapper,
      markedUnread.wrapper,
      muted.wrapper,
      muteDuration,
      notification,
      privateLabel,
    );

    const ai = element("fieldset", "messaging-v2-fieldset");
    ai.appendChild(element("legend", "", text("settingsAiTitle")));
    const aiAccess = toggleField("ai_access", text("settingsAiAccess"));
    const aiHistory = toggleField("ai_history", text("settingsAiHistory"));
    const aiAttachments = toggleField("ai_attachments", text("settingsAiAttachments"));
    const transcriptRetention = toggleField(
      "transcript_retention",
      text("settingsTranscriptRetention"),
    );
    ai.append(
      aiAccess.wrapper,
      aiHistory.wrapper,
      aiAttachments.wrapper,
      transcriptRetention.wrapper,
    );

    const security = element("fieldset", "messaging-v2-fieldset");
    security.appendChild(element("legend", "", text("settingsSecurityTitle")));
    const mailboxLock = toggleField(
      "mailbox_lock",
      text("settingsMailboxLock"),
    );
    mailboxLock.wrapper.hidden = app.dataset.messagingMailboxLockEnabled === "false";
    const blockPeer = actionButton(
      text("settingsBlock"),
      "messaging-v2-button is-danger",
    );
    blockPeer.hidden = true;
    blockPeer.addEventListener("click", () => togglePeerBlock(blockPeer));
    security.append(mailboxLock.wrapper, blockPeer);

    const privacy = element("fieldset", "messaging-v2-fieldset");
    privacy.appendChild(element("legend", "", text("settingsPrivacyTitle")));
    const privacyActions = element(
      "div",
      "messaging-v2-dialog-actions is-stacked",
    );
    [
      ["clear_history", text("conversationClearHistory"), ""],
      ["for_me", text("conversationDeleteForMe"), "is-danger"],
      ["secure_reset", text("conversationSecureReset"), "is-danger"],
      ["for_everyone", text("conversationDeleteForEveryone"), "is-danger"],
    ].forEach(([mode, label, modifier]) => {
      const button = actionButton(
        label,
        `messaging-v2-button ${modifier}`.trim(),
      );
      button.dataset.conversationAction = mode;
      button.addEventListener("click", () => {
        openConversationAction(mode, button);
      });
      privacyActions.appendChild(button);
    });
    privacy.appendChild(privacyActions);

    const feedback = element("p", "messaging-v2-dialog-feedback");
    feedback.setAttribute("aria-live", "polite");
    const footer = element("footer", "messaging-v2-dialog-actions");
    const cancel = actionButton(text("cancel"), "messaging-v2-button");
    const save = actionButton(text("save"), "messaging-v2-button is-primary");
    save.type = "submit";
    cancel.addEventListener("click", () => closeDialog(dialog));
    footer.append(cancel, save);
    form.append(basics, ai, security, privacy, feedback, footer);
    dialog.appendChild(form);
    app.appendChild(dialog);

    muted.input.addEventListener("change", () => {
      muteSelect.disabled = !muted.input.checked;
    });
    form.addEventListener("submit", saveSettings);
    ui.settingsDialog = dialog;
    ui.settingsForm = form;
    ui.settingsFeedback = feedback;
    ui.settingsSave = save;
    ui.settingsFields = {
      pinned: pinned.input,
      archived: archived.input,
      markedUnread: markedUnread.input,
      muted: muted.input,
      muteSelect,
      notificationSelect,
      labelInput,
      aiAccess: aiAccess.input,
      aiHistory: aiHistory.input,
      aiAttachments: aiAttachments.input,
      transcriptRetention: transcriptRetention.input,
      mailboxLock: mailboxLock.input,
    };
    ui.blockPeer = blockPeer;
  }

  function buildEditDialog() {
    const dialog = element("dialog", "messaging-v2-dialog");
    const form = element("form", "messaging-v2-dialog-body");
    form.method = "dialog";
    form.appendChild(dialogHeader(text("editTitle"), dialog));
    const field = element("label", "messaging-v2-field");
    field.appendChild(element("span", "", text("editLabel")));
    const input = document.createElement("textarea");
    input.rows = 5;
    input.maxLength = 4000;
    field.appendChild(input);
    const feedback = element("p", "messaging-v2-dialog-feedback");
    feedback.setAttribute("aria-live", "polite");
    const footer = element("footer", "messaging-v2-dialog-actions");
    const cancel = actionButton(text("cancel"), "messaging-v2-button");
    const save = actionButton(text("save"), "messaging-v2-button is-primary");
    save.type = "submit";
    cancel.addEventListener("click", () => closeDialog(dialog));
    footer.append(cancel, save);
    form.append(field, feedback, footer);
    dialog.appendChild(form);
    app.appendChild(dialog);
    form.addEventListener("submit", saveEdit);
    ui.editDialog = dialog;
    ui.editInput = input;
    ui.editFeedback = feedback;
    ui.editSave = save;
  }

  function buildDeleteDialog() {
    const dialog = element("dialog", "messaging-v2-dialog");
    const body = element("div", "messaging-v2-dialog-body");
    const header = dialogHeader(text("deleteTitle"), dialog);
    const title = header.querySelector("h2");
    const question = element(
      "p",
      "messaging-v2-dialog-question",
      text("deleteQuestion"),
    );
    question.id = `messaging-v2-dialog-description-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute("aria-describedby", question.id);
    body.append(header, question);
    const feedback = element("p", "messaging-v2-dialog-feedback");
    feedback.setAttribute("aria-live", "polite");
    const actions = element("footer", "messaging-v2-dialog-actions is-stacked");
    const forMe = actionButton(text("deleteForMe"), "messaging-v2-button");
    const forEveryone = actionButton(
      text("deleteForEveryone"),
      "messaging-v2-button is-danger",
    );
    const cancel = actionButton(
      text("destructiveCancel"),
      "messaging-v2-button",
    );
    const confirm = actionButton("", "messaging-v2-button is-danger");
    confirm.hidden = true;
    forMe.addEventListener("click", () => selectMessageDeleteMode("for_me"));
    forEveryone.addEventListener("click", () => selectMessageDeleteMode("for_everyone"));
    cancel.addEventListener("click", () => closeDialog(dialog));
    confirm.addEventListener("click", () => deleteMessage(confirm));
    actions.append(cancel, forMe, forEveryone, confirm);
    body.append(feedback, actions);
    dialog.appendChild(body);
    app.appendChild(dialog);
    dialog.addEventListener("close", () => {
      state.messageDeleteMode = "";
      state.actionMessage = null;
    });
    ui.deleteDialog = dialog;
    ui.deleteTitle = title;
    ui.deleteQuestion = question;
    ui.deleteFeedback = feedback;
    ui.deleteForMe = forMe;
    ui.deleteForEveryone = forEveryone;
    ui.deleteCancel = cancel;
    ui.deleteConfirm = confirm;
  }

  function buildConversationActionDialog() {
    const dialog = element("dialog", "messaging-v2-dialog");
    const body = element("div", "messaging-v2-dialog-body");
    const header = dialogHeader(text("conversationActionTitle"), dialog);
    const title = header.querySelector("h2");
    body.appendChild(header);
    const question = element(
      "p",
      "messaging-v2-dialog-question",
      text("conversationActionQuestion"),
    );
    const feedback = element("p", "messaging-v2-dialog-feedback");
    feedback.setAttribute("aria-live", "polite");
    question.id = `messaging-v2-dialog-description-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute("aria-describedby", question.id);
    const actions = element("footer", "messaging-v2-dialog-actions");
    const cancel = actionButton(
      text("destructiveCancel"),
      "messaging-v2-button",
    );
    const confirm = actionButton(
      text("conversationActionConfirm"),
      "messaging-v2-button is-danger",
    );
    cancel.addEventListener("click", () => closeDialog(dialog));
    confirm.addEventListener("click", () => runConversationAction(confirm));
    actions.append(cancel, confirm);
    body.append(question, feedback, actions);
    dialog.appendChild(body);
    app.appendChild(dialog);
    ui.conversationActionDialog = dialog;
    ui.conversationActionTitle = title;
    ui.conversationActionQuestion = question;
    ui.conversationActionFeedback = feedback;
    ui.conversationActionCancel = cancel;
    ui.conversationActionConfirm = confirm;
  }

  function buildMailboxUnlockDialog() {
    const dialog = element("dialog", "messaging-v2-dialog");
    const form = element("form", "messaging-v2-dialog-body");
    form.method = "dialog";
    const header = dialogHeader(text("mailboxLockedTitle"), dialog);
    const question = element(
      "p",
      "messaging-v2-dialog-question",
      text("mailboxLockedHint"),
    );
    question.id = `messaging-v2-dialog-description-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute("aria-describedby", question.id);
    form.append(header, question);
    const field = element("label", "messaging-v2-field");
    field.appendChild(element("span", "", text("mailboxPassword")));
    const password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.required = true;
    field.appendChild(password);
    const feedback = element("p", "messaging-v2-dialog-feedback");
    feedback.setAttribute("aria-live", "assertive");
    const actions = element("footer", "messaging-v2-dialog-actions");
    const cancel = actionButton(text("cancel"), "messaging-v2-button");
    const unlock = actionButton(
      text("mailboxUnlock"),
      "messaging-v2-button is-primary",
    );
    unlock.type = "submit";
    cancel.addEventListener("click", () => closeDialog(dialog));
    actions.append(cancel, unlock);
    form.append(field, feedback, actions);
    dialog.appendChild(form);
    app.appendChild(dialog);
    form.addEventListener("submit", unlockMailbox);
    dialog.addEventListener("close", () => {
      password.value = "";
      feedback.textContent = "";
    });
    ui.mailboxUnlockDialog = dialog;
    ui.mailboxPassword = password;
    ui.mailboxUnlockFeedback = feedback;
    ui.mailboxUnlockButton = unlock;
  }

  function openSettings(returnFocus) {
    if (!state.conversation) return;
    const preferences = state.conversation.preferences || {};
    const fields = ui.settingsFields;
    fields.pinned.checked = Boolean(preferences.pinned_at);
    fields.archived.checked = Boolean(preferences.archived_at);
    fields.markedUnread.checked = preferences.marked_unread_from_message_id != null;
    fields.muted.checked = Boolean(preferences.muted);
    fields.muteSelect.disabled = !fields.muted.checked;
    fields.notificationSelect.value = preferences.notification_level || "all";
    fields.labelInput.value = preferences.label || "";
    fields.aiAccess.checked = Boolean(preferences.ai_access_enabled);
    fields.aiHistory.checked = Boolean(preferences.ai_history_access_enabled);
    fields.aiAttachments.checked = Boolean(preferences.ai_attachment_access_enabled);
    fields.transcriptRetention.checked = Boolean(preferences.transcript_retention_enabled);
    fields.mailboxLock.checked = Boolean(preferences.lock_enabled);
    const peer = state.conversation.peer;
    const blockState = state.conversation.block_state || "none";
    ui.blockPeer.hidden = !peer || blockState === "blocked_by_them";
    ui.blockPeer.textContent = blockState === "blocked_by_me"
      ? text("settingsUnblock")
      : text("settingsBlock");
    ui.settingsFeedback.textContent = "";
    showDialog(ui.settingsDialog, returnFocus, fields.pinned);
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!state.conversation) return;
    const fields = ui.settingsFields;
    ui.settingsSave.disabled = true;
    ui.settingsFeedback.textContent = "";
    try {
      const payload = await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/preferences`,
        jsonOptions("PATCH", {
          pinned: fields.pinned.checked,
          archived: fields.archived.checked,
          marked_unread: fields.markedUnread.checked,
          mute_seconds: fields.muted.checked ? Number(fields.muteSelect.value) : 0,
          notification_level: fields.notificationSelect.value,
          label: fields.labelInput.value.trim(),
          ai_access_enabled: fields.aiAccess.checked,
          ai_history_access_enabled: fields.aiHistory.checked,
          ai_attachment_access_enabled: fields.aiAttachments.checked,
          transcript_retention_enabled: fields.transcriptRetention.checked,
          lock_enabled: fields.mailboxLock.checked,
          lock_method: "reauth",
        }),
      );
      state.conversation.preferences = payload.preferences || {};
      updateMailboxToolbar();
      showNotice(text("settingsSaved"));
      closeDialog(ui.settingsDialog);
      if (state.conversation.preferences.locked) {
        showDialog(ui.mailboxUnlockDialog, ui.lockButton, ui.mailboxPassword);
      }
      requestRefresh();
    } catch (_error) {
      ui.settingsFeedback.textContent = text("actionFailed");
      ui.settingsFeedback.classList.add("is-error");
    } finally {
      ui.settingsSave.disabled = false;
    }
  }

  function openConversationAction(mode, returnFocus) {
    if (!state.conversation) return;
    state.conversationActionMode = mode;
    const contract = {
      clear_history: {
        title: text("conversationClearHistory"),
        question: text("conversationClearHistoryQuestion"),
        confirm: text("conversationClearHistoryConfirm"),
      },
      for_me: {
        title: text("conversationDeleteForMe"),
        question: text("conversationDeleteForMeQuestion"),
        confirm: text("conversationDeleteForMeConfirm"),
      },
      secure_reset: {
        title: text("conversationSecureReset"),
        question: text("conversationSecureResetQuestion"),
        confirm: text("conversationSecureResetConfirm"),
      },
      for_everyone: {
        title: text("conversationDeleteForEveryone"),
        question: text("conversationDeleteForEveryoneQuestion"),
        confirm: text("conversationDeleteForEveryoneConfirm"),
      },
    }[mode];
    if (!contract) return;
    ui.conversationActionTitle.textContent = contract.title;
    ui.conversationActionQuestion.textContent = contract.question;
    ui.conversationActionConfirm.textContent = contract.confirm;
    ui.conversationActionFeedback.textContent = "";
    ui.conversationActionFeedback.classList.remove("is-error");
    showDialog(
      ui.conversationActionDialog,
      returnFocus,
      ui.conversationActionCancel,
    );
  }

  async function runConversationAction(button) {
    if (!state.conversation || !state.conversationActionMode) return;
    button.disabled = true;
    const requestKey = randomIdempotencyKey();
    try {
      await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}`,
        {
          ...jsonOptions("DELETE", {
            mode: state.conversationActionMode,
            idempotency_key: requestKey,
          }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestKey,
          },
        },
      );
      closeDialog(ui.conversationActionDialog);
      closeDialog(ui.settingsDialog);
      window.location.reload();
    } catch (_error) {
      ui.conversationActionFeedback.textContent = text("actionFailed");
      ui.conversationActionFeedback.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }

  async function togglePeerBlock(button) {
    const peer = state.conversation?.peer;
    if (!peer) return;
    const blockedByMe = state.conversation.block_state === "blocked_by_me";
    button.disabled = true;
    try {
      await api(
        `/api/messaging/users/${encodeURIComponent(peer.owner_type)}`
        + `/${encodeURIComponent(peer.owner_id)}/block`,
        blockedByMe
          ? { method: "DELETE" }
          : jsonOptions("POST", {}),
      );
      state.conversation.block_state = blockedByMe ? "none" : "blocked_by_me";
      button.textContent = blockedByMe
        ? text("settingsBlock")
        : text("settingsUnblock");
      requestRefresh();
    } catch (_error) {
      ui.settingsFeedback.textContent = text("actionFailed");
      ui.settingsFeedback.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }

  function updateMailboxToolbar() {
    if (!ui.lockButton) return;
    const preferences = state.conversation?.preferences || {};
    const enabled = app.dataset.messagingMailboxLockEnabled !== "false"
      && Boolean(preferences.lock_enabled);
    ui.lockButton.hidden = !enabled;
    ui.lockButton.textContent = preferences.locked
      ? text("mailboxUnlock")
      : text("mailboxLockNow");
  }

  async function toggleMailboxLock(returnFocus) {
    if (!state.conversation) return;
    const preferences = state.conversation.preferences || {};
    if (preferences.locked) {
      showDialog(ui.mailboxUnlockDialog, returnFocus, ui.mailboxPassword);
      return;
    }
    try {
      await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/lock`,
        { method: "POST" },
      );
      state.conversation.preferences = {
        ...preferences,
        lock_enabled: true,
        locked: true,
      };
      updateMailboxToolbar();
      showNotice(text("mailboxLockedTitle"));
      showDialog(ui.mailboxUnlockDialog, returnFocus, ui.mailboxPassword);
    } catch (_error) {
      showNotice(text("actionFailed"), true);
    }
  }

  async function unlockMailbox(event) {
    event.preventDefault();
    if (!state.conversation) return;
    ui.mailboxUnlockButton.disabled = true;
    ui.mailboxUnlockFeedback.textContent = "";
    try {
      await api(
        `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/unlock`,
        jsonOptions("POST", { password: ui.mailboxPassword.value }),
      );
      state.conversation.preferences = {
        ...(state.conversation.preferences || {}),
        locked: false,
      };
      closeDialog(ui.mailboxUnlockDialog);
      updateMailboxToolbar();
      requestRefresh();
    } catch (error) {
      ui.mailboxUnlockFeedback.textContent = error.status === 401
        ? text("mailboxInvalidPassword")
        : error.status === 429
          ? text("mailboxRateLimited")
          : text("actionFailed");
      ui.mailboxUnlockFeedback.classList.add("is-error");
    } finally {
      ui.mailboxUnlockButton.disabled = false;
    }
  }

  function scheduleMailboxAutoLock() {
    window.clearTimeout(state.mailboxAutoLockTimer);
    if (!state.conversation?.preferences?.lock_enabled) return;
    state.mailboxAutoLockTimer = window.setTimeout(() => {
      if (!document.hidden || !state.conversation) return;
      const conversationId = state.conversation.id;
      fetch(
        `/api/messaging/conversations/${encodeURIComponent(conversationId)}/lock`,
        {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: { "X-Requested-With": "XMLHttpRequest" },
        },
      ).catch(() => undefined);
    }, 30000);
  }

  function setReply(message) {
    state.replyMessage = message;
    app.dataset.messagingReplyToMessageId = String(message.id);
    ui.replyPreview.textContent = message.content || text("replyUnavailable");
    ui.replyBar.hidden = false;
    messagesPanel.querySelector("[data-message-input]")?.focus();
  }

  function clearReply() {
    state.replyMessage = null;
    delete app.dataset.messagingReplyToMessageId;
    if (ui.replyBar) ui.replyBar.hidden = true;
    if (ui.replyPreview) ui.replyPreview.textContent = "";
  }

  function openEdit(message, returnFocus) {
    state.actionMessage = message;
    ui.editInput.value = message.content || "";
    ui.editFeedback.textContent = "";
    showDialog(ui.editDialog, returnFocus, ui.editInput);
    window.setTimeout(() => {
      ui.editInput.setSelectionRange(ui.editInput.value.length, ui.editInput.value.length);
    }, 0);
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!state.actionMessage) return;
    const content = ui.editInput.value.trim();
    if (!content) return;
    ui.editSave.disabled = true;
    try {
      await api(
        `/api/messaging/messages/${encodeURIComponent(state.actionMessage.id)}`,
        jsonOptions("PATCH", {
          content,
          client_revision: Number(state.actionMessage.revision || 1),
        }),
      );
      closeDialog(ui.editDialog);
      requestRefresh();
    } catch (_error) {
      ui.editFeedback.textContent = text("actionFailed");
      ui.editFeedback.classList.add("is-error");
    } finally {
      ui.editSave.disabled = false;
    }
  }

  function openDelete(message, returnFocus) {
    state.actionMessage = message;
    state.messageDeleteMode = "";
    const mine = isMine(message);
    ui.deleteTitle.textContent = text("deleteTitle");
    ui.deleteQuestion.textContent = text("deleteQuestion");
    ui.deleteForMe.hidden = false;
    ui.deleteForEveryone.hidden = !mine;
    ui.deleteConfirm.hidden = true;
    ui.deleteFeedback.textContent = "";
    ui.deleteFeedback.classList.remove("is-error");
    if (!mine) selectMessageDeleteMode("for_me", false);
    showDialog(ui.deleteDialog, returnFocus, ui.deleteCancel);
  }

  function selectMessageDeleteMode(mode, moveFocus = true) {
    if (!new Set(["for_me", "for_everyone"]).has(mode)) return;
    state.messageDeleteMode = mode;
    const forEveryone = mode === "for_everyone";
    ui.deleteTitle.textContent = forEveryone
      ? text("deleteForEveryone")
      : text("deleteForMe");
    ui.deleteQuestion.textContent = forEveryone
      ? text("deleteForEveryoneQuestion")
      : text("deleteForMeQuestion");
    ui.deleteConfirm.textContent = forEveryone
      ? text("deleteForEveryoneConfirm")
      : text("deleteForMeConfirm");
    ui.deleteForMe.hidden = true;
    ui.deleteForEveryone.hidden = true;
    ui.deleteConfirm.hidden = false;
    if (moveFocus) ui.deleteCancel.focus();
  }

  function randomIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function deleteMessage(button) {
    if (!state.actionMessage || !state.messageDeleteMode) return;
    button.disabled = true;
    const key = randomIdempotencyKey();
    try {
      await api(
        `/api/messaging/messages/${encodeURIComponent(state.actionMessage.id)}`,
        {
          ...jsonOptions("DELETE", {
            mode: state.messageDeleteMode,
            idempotency_key: key,
          }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
        },
      );
      if (state.replyMessage?.id === state.actionMessage.id) clearReply();
      closeDialog(ui.deleteDialog);
      requestRefresh();
    } catch (_error) {
      ui.deleteFeedback.textContent = text("actionFailed");
      ui.deleteFeedback.classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }

  function isMine(message) {
    return Boolean(
      state.me
      && message.sender_type === state.me.owner_type
      && String(message.sender_id) === String(state.me.owner_id),
    );
  }

  async function togglePin(message, button) {
    button.disabled = true;
    try {
      await api(
        `/api/messaging/messages/${encodeURIComponent(message.id)}/pin`,
        { method: message.pinned_by_me ? "DELETE" : "POST" },
      );
      requestRefresh();
    } catch (_error) {
      showNotice(text("actionFailed"), true);
    } finally {
      button.disabled = false;
    }
  }

  async function toggleReaction(message, reaction, button) {
    button.disabled = true;
    const current = (message.reactions || []).find((item) => item.reaction === reaction);
    try {
      if (current?.reacted_by_me) {
        await api(
          `/api/messaging/messages/${encodeURIComponent(message.id)}`
          + `/reactions/${encodeURIComponent(reaction)}`,
          { method: "DELETE" },
        );
      } else {
        await api(
          `/api/messaging/messages/${encodeURIComponent(message.id)}/reactions`,
          jsonOptions("POST", { reaction }),
        );
      }
      requestRefresh();
    } catch (_error) {
      showNotice(text("actionFailed"), true);
    } finally {
      button.disabled = false;
    }
  }

  function replyPreview(message) {
    if (!message.reply_to) return null;
    const preview = element("blockquote", "messaging-v2-reply-preview");
    const content = message.reply_to.unavailable
      ? text("replyUnavailable")
      : (message.reply_to.content || text("replyUnavailable"));
    preview.append(
      element("strong", "", text("replyingTo")),
      element("span", "", content),
    );
    return preview;
  }

  function receiptLabel(message) {
    if (!isMine(message)) return "";
    const receipts = Array.isArray(message.receipts) ? message.receipts : [];
    if (receipts.some((receipt) => receipt.read_at)) return text("messageRead");
    if (receipts.some((receipt) => receipt.delivered_at)) return text("messageDelivered");
    return text("messageSent");
  }

  function updateReceiptNode(message) {
    const bubble = messagesPanel.querySelector(
      `[data-message-id="${Number(message.id)}"]`,
    );
    if (!bubble) return;
    const label = receiptLabel(message);
    let meta = bubble.querySelector(".messaging-v2-message-meta");
    let receipt = meta?.querySelector("[data-message-receipt]");
    if (!label) {
      receipt?.remove();
      if (meta && !meta.childElementCount) meta.remove();
      return;
    }
    if (!meta) {
      meta = element("div", "messaging-v2-message-meta");
      const timeNode = bubble.querySelector("time");
      bubble.insertBefore(meta, timeNode?.nextSibling || null);
    }
    if (!receipt) {
      receipt = element("span");
      receipt.dataset.messageReceipt = "true";
      meta.appendChild(receipt);
    }
    receipt.textContent = label;
  }

  function reactionRow(message) {
    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    if (!reactions.length) return null;
    const row = element("div", "messaging-v2-reactions");
    reactions.forEach((reaction) => {
      const chip = actionButton(
        `${reaction.reaction} ${reaction.count}`,
        "messaging-v2-reaction-chip",
      );
      chip.classList.toggle("is-mine", Boolean(reaction.reacted_by_me));
      chip.setAttribute("aria-pressed", String(Boolean(reaction.reacted_by_me)));
      chip.addEventListener(
        "click",
        () => toggleReaction(message, reaction.reaction, chip),
      );
      row.appendChild(chip);
    });
    return row;
  }

  function messageAttachment(message) {
    const value = message?.attachments;
    if (Array.isArray(value)) return value[0] || null;
    return value && typeof value === "object" ? value : null;
  }

  function renderWaveform(attachment) {
    const waveform = Array.isArray(attachment.waveform)
      ? attachment.waveform.slice(0, 48)
      : [];
    if (!waveform.length) return null;
    const chart = element("span", "messaging-v2-waveform");
    chart.setAttribute("aria-hidden", "true");
    waveform.forEach((sample) => {
      const bar = element("i");
      const amplitude = Math.max(0.08, Math.min(1, Number(sample) || 0));
      bar.style.setProperty("--wave", String(amplitude));
      chart.appendChild(bar);
    });
    return chart;
  }

  function richAttachment(message) {
    const attachment = messageAttachment(message);
    const type = String(attachment?.attachment_type || "");
    if (!attachment?.url || !new Set(["file", "audio", "location"]).has(type)) {
      return null;
    }
    const wrapper = element(
      "section",
      `messaging-v2-rich-attachment is-${type}`,
    );
    if (type === "file") {
      const link = element(
        "a",
        "messaging-v2-attachment-link",
        attachment.display_name || text("attachmentFile"),
      );
      link.href = attachment.url;
      link.download = attachment.display_name || "";
      link.rel = "noopener";
      wrapper.append(
        element("strong", "", text("attachmentFile")),
        link,
      );
      return wrapper;
    }
    if (type === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = attachment.url;
      const speed = document.createElement("select");
      speed.className = "messaging-v2-playback-speed";
      speed.setAttribute("aria-label", text("attachmentSpeed"));
      [["1", "1×"], ["1.5", "1.5×"], ["2", "2×"]].forEach(
        ([value, label]) => speed.add(new Option(label, value)),
      );
      speed.addEventListener("change", () => {
        audio.playbackRate = Number(speed.value) || 1;
      });
      wrapper.appendChild(element("strong", "", text("attachmentVoice")));
      const waveform = renderWaveform(attachment);
      if (waveform) wrapper.appendChild(waveform);
      wrapper.append(audio, speed);
      return wrapper;
    }
    const button = actionButton(
      text("attachmentOpenLocation"),
      "messaging-v2-button",
    );
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const payload = await api(attachment.url);
        const location = payload.location || {};
        const latitude = Number(location.latitude);
        const longitude = Number(location.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error("invalid location");
        }
        window.open(
          `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`,
          "_blank",
          "noopener,noreferrer",
        );
      } catch (_error) {
        showNotice(text("actionFailed"), true);
      } finally {
        button.disabled = false;
      }
    });
    wrapper.append(
      element("strong", "", text("attachmentLocation")),
      button,
    );
    return wrapper;
  }

  function closeReactionPalette(returnFocus = false) {
    const active = state.activeReaction;
    if (!active) return;
    state.activeReaction = null;
    active.palette.hidden = true;
    active.palette.style.removeProperty("--messaging-v2-reaction-top");
    active.palette.style.removeProperty("--messaging-v2-reaction-left");
    active.trigger.setAttribute("aria-expanded", "false");
    if (returnFocus && active.trigger.isConnected) active.trigger.focus();
  }

  function positionReactionPalette(trigger, palette) {
    const viewport = window.visualViewport;
    const viewportTop = Math.max(0, Number(viewport?.offsetTop || 0));
    const viewportLeft = Math.max(0, Number(viewport?.offsetLeft || 0));
    const viewportWidth = Number(viewport?.width || window.innerWidth);
    const viewportHeight = Number(viewport?.height || window.innerHeight);
    const triggerRect = trigger.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    const composerRect = messagesPanel.querySelector("[data-message-form]")
      ?.getBoundingClientRect();
    const topBoundary = viewportTop + 8;
    const viewportBottom = viewportTop + viewportHeight - 8;
    const bottomBoundary = composerRect && composerRect.top > triggerRect.top
      ? Math.min(viewportBottom, composerRect.top - 8)
      : viewportBottom;
    let top = triggerRect.top - paletteRect.height - 7;
    if (top < topBoundary) top = triggerRect.bottom + 7;
    top = Math.max(
      topBoundary,
      Math.min(top, Math.max(topBoundary, bottomBoundary - paletteRect.height)),
    );
    const left = Math.max(
      viewportLeft + 8,
      Math.min(
        triggerRect.right - paletteRect.width,
        viewportLeft + viewportWidth - paletteRect.width - 8,
      ),
    );
    palette.style.setProperty("--messaging-v2-reaction-top", `${Math.round(top)}px`);
    palette.style.setProperty("--messaging-v2-reaction-left", `${Math.round(left)}px`);
  }

  function openReactionPalette(trigger, palette) {
    if (document.body.classList.contains("timeblock-call-active")) return;
    closeReactionPalette();
    palette.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    state.activeReaction = { trigger, palette };
    positionReactionPalette(trigger, palette);
    palette.querySelector('[role="menuitem"]')?.focus();
  }

  function repositionActiveReaction() {
    const active = state.activeReaction;
    if (!active) return;
    if (!active.trigger.isConnected || !active.palette.isConnected) {
      closeReactionPalette();
      return;
    }
    positionReactionPalette(active.trigger, active.palette);
  }

  function handleReactionMenuKeydown(event, trigger, palette) {
    const choices = Array.from(palette.querySelectorAll('[role="menuitem"]'));
    if (!choices.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeReactionPalette(true);
      return;
    }
    if (event.key === "Tab") {
      closeReactionPalette();
      return;
    }
    const current = Math.max(0, choices.indexOf(document.activeElement));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % choices.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + choices.length) % choices.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = choices.length - 1;
    }
    if (next >= 0) {
      event.preventDefault();
      choices[next].focus();
    }
  }

  function messageActions(message) {
    const actions = element("div", "messaging-v2-message-actions");
    actions.dataset.messagingV2MessageActions = "true";
    const reply = actionButton(text("messageReply"), "messaging-v2-message-action");
    reply.addEventListener("click", () => setReply(message));
    const reactionWrap = element("span", "messaging-v2-reaction-picker");
    const react = actionButton(text("messageReact"), "messaging-v2-message-action");
    const palette = element("span", "messaging-v2-reaction-palette");
    palette.id = `messaging-v2-reactions-${message.id}-${Math.random().toString(36).slice(2)}`;
    palette.setAttribute("role", "menu");
    palette.setAttribute("aria-label", text("messageReact"));
    palette.hidden = true;
    ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02"].forEach((emoji) => {
      const choice = actionButton(emoji, "messaging-v2-reaction-choice");
      choice.setAttribute("aria-label", `${text("messageReact")} ${emoji}`);
      choice.setAttribute("title", `${text("messageReact")} ${emoji}`);
      choice.setAttribute("role", "menuitem");
      choice.addEventListener("click", async () => {
        await toggleReaction(message, emoji, choice);
        closeReactionPalette(true);
      });
      palette.appendChild(choice);
    });
    react.addEventListener("click", () => {
      if (palette.hidden) openReactionPalette(react, palette);
      else closeReactionPalette(true);
    });
    react.setAttribute("aria-haspopup", "menu");
    react.setAttribute("aria-controls", palette.id);
    react.setAttribute("aria-expanded", "false");
    palette.addEventListener(
      "keydown",
      (event) => handleReactionMenuKeydown(event, react, palette),
    );
    reactionWrap.append(react, palette);
    const pin = actionButton(
      message.pinned_by_me ? text("messageUnpin") : text("messagePin"),
      "messaging-v2-message-action",
    );
    pin.addEventListener("click", () => togglePin(message, pin));
    actions.append(reply, reactionWrap, pin);
    if (isMine(message) && new Set(["text", "ptt"]).has(message.content_type || "text")) {
      const edit = actionButton(text("messageEdit"), "messaging-v2-message-action");
      edit.addEventListener("click", () => openEdit(message, edit));
      actions.appendChild(edit);
    }
    const remove = actionButton(text("messageDelete"), "messaging-v2-message-action is-danger");
    remove.addEventListener("click", () => openDelete(message, remove));
    actions.appendChild(remove);
    return actions;
  }

  function decorateMessages(messages) {
    const container = messagesPanel.querySelector("[data-thread-messages]");
    if (!container) return;
    state.messages = new Map((messages || []).map((message) => [Number(message.id), message]));
    state.messages.forEach((message, messageId) => {
      const bubble = container.querySelector(`[data-message-id="${messageId}"]`);
      if (!bubble || bubble.dataset.messageKind === "call_event") return;
      const existingActions = bubble.querySelectorAll(
        ":scope > .messaging-v2-message-actions",
      );
      if (
        bubble.dataset.v2Decorated === "true"
        && existingActions.length === 1
      ) {
        return;
      }
      bubble.querySelectorAll(
        ":scope > .messaging-v2-reply-preview,"
        + ":scope > .messaging-v2-reactions,"
        + ":scope > .messaging-v2-rich-attachment,"
        + ":scope > .messaging-v2-message-meta,"
        + ":scope > .messaging-v2-message-actions,"
        + ":scope > .messaging-v2-tombstone",
      ).forEach((node) => node.remove());
      bubble.dataset.v2Decorated = "true";
      const tombstone = message.content_type === "tombstone"
        || Boolean(message.deleted_for_everyone_at);
      const preview = replyPreview(message);
      if (preview) bubble.prepend(preview);
      if (tombstone && !bubble.querySelector(".assistant-thread-text")) {
        const deleted = element("div", "messaging-v2-tombstone", text("messageDeleted"));
        bubble.insertBefore(deleted, bubble.querySelector("time"));
        bubble.classList.add("is-tombstone");
      }
      const reactions = reactionRow(message);
      const timeNode = bubble.querySelector("time");
      const attachment = richAttachment(message);
      if (attachment) bubble.insertBefore(attachment, timeNode);
      if (reactions) bubble.insertBefore(reactions, timeNode);
      const meta = element("div", "messaging-v2-message-meta");
      if (message.edited_at) meta.appendChild(element("span", "", text("messageEdited")));
      const receipt = receiptLabel(message);
      if (receipt) {
        const receiptNode = element("span", "", receipt);
        receiptNode.dataset.messageReceipt = "true";
        meta.appendChild(receiptNode);
      }
      if (meta.childElementCount) bubble.insertBefore(meta, timeNode?.nextSibling || null);
      if (!tombstone) bubble.appendChild(messageActions(message));
    });
    repositionActiveReaction();
  }

  function mergeRefreshScope(current, next) {
    if (!current) return next;
    if (!next || current === next) return current;
    return "all";
  }

  function requestRefresh(scope = "all") {
    state.pendingRefreshScope = mergeRefreshScope(
      state.pendingRefreshScope,
      scope,
    );
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      const refreshScope = state.pendingRefreshScope || "all";
      state.pendingRefreshScope = "";
      emit("refresh", { scope: refreshScope });
    }, 120);
  }

  function updateSyncStatus(status) {
    app.dataset.messagingRealtimeActive = status === "live" ? "true" : "false";
    if (state.syncStatus === status) return;
    state.syncStatus = status;
    if (!ui.sync || !ui.syncCopy) return;
    ui.sync.classList.remove("is-connecting", "is-live", "is-offline");
    ui.sync.classList.add(`is-${status}`);
    ui.syncCopy.textContent = text(
      status === "live" ? "syncLive" : status === "offline" ? "syncOffline" : "syncConnecting",
    );
  }

  function eventStorageKey() {
    return `timeblock.messaging.events.${state.me.owner_type || "owner"}.${state.me.owner_id || "0"}`;
  }

  function loadEventCursor() {
    try {
      const cursor = Number(window.localStorage.getItem(eventStorageKey()) || 0);
      state.eventCursor = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
      state.eventBootstrapping = state.eventCursor === 0;
    } catch (_error) {
      state.eventCursor = 0;
      state.eventBootstrapping = true;
    }
  }

  function saveEventCursor() {
    try {
      window.localStorage.setItem(eventStorageKey(), String(state.eventCursor));
    } catch (_error) {
      // Polling remains functional when storage is unavailable.
    }
  }

  function scheduleEventPoll(delay) {
    if (state.eventSource || state.authExpired) return;
    window.clearTimeout(state.eventTimer);
    state.eventTimer = window.setTimeout(pollEvents, delay);
  }

  async function pollEvents() {
    if (state.eventInFlight || state.authExpired) return;
    if (document.hidden) {
      scheduleEventPoll(4000);
      return;
    }
    state.eventInFlight = true;
    if (state.eventFailures) updateSyncStatus("connecting");
    let sawNewEvent = false;
    let refreshScope = "";
    let caughtUp = false;
    try {
      for (let page = 0; page < 5; page += 1) {
        const payload = await api(
          `/api/messaging/events?after_id=${encodeURIComponent(state.eventCursor)}&limit=200`,
        );
        const events = Array.isArray(payload.events) ? payload.events : [];
        if (!state.eventBootstrapping && events.length) {
          sawNewEvent = true;
          events.forEach((item) => {
            emitCallState(item);
            const eventScope = refreshScopeForEvent(item);
            if (eventScope) {
              refreshScope = mergeRefreshScope(refreshScope, eventScope);
            }
          });
        }
        state.eventCursor = Number(payload.next_after_id || state.eventCursor);
        saveEventCursor();
        if (!payload.has_more) {
          caughtUp = true;
          break;
        }
      }
      if (caughtUp) state.eventBootstrapping = false;
      state.eventFailures = 0;
      updateSyncStatus("live");
      if (sawNewEvent && refreshScope) requestRefresh(refreshScope);
      if (
        caughtUp
        && !state.eventReconnectTimer
        && app.dataset.messagingRealtimeEnabled !== "false"
        && "EventSource" in window
      ) {
        startEventStream();
      } else {
        scheduleEventPoll(caughtUp ? 4000 : 120);
      }
    } catch (error) {
      state.eventFailures += 1;
      updateSyncStatus("offline");
      if (error.status === 401) {
        stopRealtimeForExpiredSession();
        return;
      }
      scheduleEventPoll(Math.min(30000, 3000 * (2 ** Math.min(state.eventFailures, 3))));
    } finally {
      state.eventInFlight = false;
    }
  }

  const REALTIME_EVENT_TYPES = [
    "message.created",
    "message.updated",
    "message.deleted",
    "message.delivered",
    "message.read",
    "message.reaction_added",
    "message.reaction_removed",
    "message.pinned",
    "message.unpinned",
    "conversation.updated",
    "conversation.archived",
    "conversation.deleted",
    "conversation.reset",
    "friendship.updated",
    "user.blocked",
    "user.unblocked",
    "call.created",
    "call.updated",
    "call.ended",
  ];

  const THREAD_REFRESH_EVENT_TYPES = new Set([
    "message.delivered",
    "message.read",
    "message.reaction_added",
    "message.reaction_removed",
    "message.pinned",
    "message.unpinned",
  ]);
  const RECEIPT_EVENT_TYPES = new Set([
    "message.delivered",
    "message.read",
  ]);

  function applyReceiptEvent(payload) {
    const eventType = String(payload?.event_type || "");
    if (!RECEIPT_EVENT_TYPES.has(eventType)) return false;
    const actor = payload?.actor || {};
    const ownActor = actor.type === state.me.owner_type
      && String(actor.id || "") === String(state.me.owner_id || "");
    const sameConversation = state.conversation
      && Number(payload?.conversation_id) === Number(state.conversation.id);
    if (ownActor || !sameConversation) return true;

    const eventPayload = payload?.payload || {};
    if (
      payload?.resource_type !== "message"
      && Number(eventPayload.suppressed_receipt_count || 0) > 0
    ) {
      return false;
    }
    const singleMessageId = Number(
      eventPayload.message_id || payload?.resource_id || 0,
    );
    const lastReadMessageId = Number(
      eventPayload.last_read_message_id || singleMessageId,
    );
    const occurredAt = payload?.occurred_at || new Date().toISOString();
    state.messages.forEach((message) => {
      const messageId = Number(message.id);
      if (
        !isMine(message)
        || !messageId
        || (
          payload?.resource_type === "message"
          ? messageId !== singleMessageId
          : messageId > lastReadMessageId
        )
      ) {
        return;
      }
      const receipts = Array.isArray(message.receipts)
        ? [...message.receipts]
        : [];
      let receipt = receipts.find(
        (item) => item.owner_type === actor.type
          && String(item.owner_id || "") === String(actor.id || ""),
      );
      if (!receipt) {
        receipt = {
          owner_type: actor.type,
          owner_id: String(actor.id || ""),
          delivered_at: null,
          read_at: null,
          updated_at: occurredAt,
        };
        receipts.push(receipt);
      }
      receipt.delivered_at = receipt.delivered_at || occurredAt;
      if (eventType === "message.read" && !eventPayload.suppressed) {
        receipt.read_at = receipt.read_at || occurredAt;
      }
      receipt.updated_at = occurredAt;
      message.receipts = receipts;
      updateReceiptNode(message);
    });
    return true;
  }

  function refreshScopeForEvent(payload) {
    const eventType = String(payload?.event_type || "");
    const sameConversation = state.conversation
      && Number(payload?.conversation_id) === Number(state.conversation.id);
    if (applyReceiptEvent(payload)) return "";
    if (eventType.startsWith("call.")) return "";
    if (THREAD_REFRESH_EVENT_TYPES.has(eventType)) {
      return sameConversation ? "thread" : "";
    }
    return "all";
  }

  function emitCallState(payload) {
    const eventType = String(payload?.event_type || "");
    if (eventType.startsWith("call.")) emit("call-state", { event: payload, eventType });
  }

  function rememberEventId(eventId) {
    if (!eventId || state.eventIds.has(eventId)) return false;
    state.eventIds.add(eventId);
    if (state.eventIds.size > 500) {
      const oldest = state.eventIds.values().next().value;
      state.eventIds.delete(oldest);
    }
    return true;
  }

  function handleRealtimeEvent(event) {
    let payload = {};
    try {
      payload = JSON.parse(event.data || "{}");
    } catch (_error) {
      return;
    }
    if (!payload.event_id || !rememberEventId(payload.event_id)) return;
    const nextCursor = Number(event.lastEventId || payload.id || 0);
    if (Number.isFinite(nextCursor) && nextCursor > state.eventCursor) {
      state.eventCursor = nextCursor;
      saveEventCursor();
    }
    state.eventBootstrapping = false;
    emitCallState(payload);
    const refreshScope = refreshScopeForEvent(payload);
    if (refreshScope) requestRefresh(refreshScope);
  }

  function scheduleEventReconnect() {
    if (state.authExpired) return;
    window.clearTimeout(state.eventReconnectTimer);
    const delay = Math.min(
      30000,
      1500 * (2 ** Math.min(state.eventFailures, 4)),
    );
    state.eventReconnectTimer = window.setTimeout(() => {
      state.eventReconnectTimer = 0;
      if (document.hidden) {
        scheduleEventReconnect();
        return;
      }
      startEventStream();
    }, delay);
  }

  function closeEventStream() {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  }

  function stopRealtimeForExpiredSession() {
    state.authExpired = true;
    closeEventStream();
    window.clearTimeout(state.eventTimer);
    window.clearTimeout(state.eventReconnectTimer);
    state.eventTimer = 0;
    state.eventReconnectTimer = 0;
    updateSyncStatus("offline");
  }

  function startEventStream() {
    if (
      state.eventSource
      || state.authExpired
      || app.dataset.messagingRealtimeEnabled === "false"
      || !("EventSource" in window)
    ) {
      if (!state.eventSource) scheduleEventPoll(0);
      return;
    }
    window.clearTimeout(state.eventTimer);
    window.clearTimeout(state.eventReconnectTimer);
    updateSyncStatus("connecting");
    const source = new EventSource(
      `/api/messaging/events/stream?after_id=${encodeURIComponent(state.eventCursor)}`,
      { withCredentials: true },
    );
    state.eventSource = source;
    REALTIME_EVENT_TYPES.forEach((eventType) => {
      source.addEventListener(eventType, handleRealtimeEvent);
    });
    source.onopen = () => {
      if (state.eventSource !== source) return;
      state.eventFailures = 0;
      updateSyncStatus("live");
    };
    source.onerror = () => {
      if (state.eventSource !== source) return;
      closeEventStream();
      state.eventFailures += 1;
      updateSyncStatus("offline");
      scheduleEventPoll(0);
      scheduleEventReconnect();
    };
  }

  function bindMessagingEvents() {
    app.addEventListener("timeblock:messaging:me", (event) => {
      state.me = event.detail?.me || state.me;
      loadEventCursor();
    });
    app.addEventListener("timeblock:messaging:conversations", (event) => {
      const conversations = event.detail?.conversations || [];
      const current = conversations.find(
        (item) => Number(item.id) === Number(state.conversation?.id),
      );
      if (current && state.conversation) {
        state.conversation = { ...state.conversation, ...current };
        updateMailboxToolbar();
      }
    });
    app.addEventListener("timeblock:messaging:conversation", (event) => {
      state.conversation = event.detail?.conversation || null;
      ui.threadToolbar.hidden = !state.conversation;
      ui.settingsButton.disabled = !state.conversation;
      updateMailboxToolbar();
      showNotice("");
      clearReply();
      if (state.conversation?.preferences?.locked) {
        showDialog(ui.mailboxUnlockDialog, ui.lockButton, ui.mailboxPassword);
      }
    });
    app.addEventListener("timeblock:messaging:messages", (event) => {
      state.conversation = event.detail?.conversation || state.conversation;
      state.page = event.detail?.page || null;
      state.loadingOlder = false;
      ui.threadToolbar.hidden = !state.conversation;
      ui.loadOlder.hidden = !state.conversation;
      ui.loadOlder.disabled = !state.page?.has_more_before;
      ui.loadOlder.textContent = state.page?.has_more_before
        ? text("threadLoadOlder")
        : text("threadNoOlder");
      const container = messagesPanel.querySelector("[data-thread-messages]");
      const distance = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight
        : 0;
      if (ui.jumpLatest) {
        ui.jumpLatest.hidden = distance < 120;
        ui.jumpLatest.textContent = text("threadNewMessages");
      }
      updateMailboxToolbar();
      decorateMessages(event.detail?.messages || []);
    });
    app.addEventListener("timeblock:messaging:message-sent", clearReply);
    document.addEventListener("visibilitychange", () => {
      window.clearTimeout(state.mailboxAutoLockTimer);
      if (document.hidden) scheduleMailboxAutoLock();
      if (!document.hidden) {
        if (app.dataset.messagingRealtimeEnabled === "false") {
          scheduleEventPoll(0);
        } else {
          startEventStream();
        }
      }
    });
    window.addEventListener("pagehide", () => {
      window.clearTimeout(state.mailboxAutoLockTimer);
      if (state.conversation?.preferences?.lock_enabled) {
        fetch(
          `/api/messaging/conversations/${encodeURIComponent(state.conversation.id)}/lock`,
          {
            method: "POST",
            credentials: "same-origin",
            keepalive: true,
            headers: { "X-Requested-With": "XMLHttpRequest" },
          },
        ).catch(() => undefined);
      }
      closeEventStream();
      window.clearTimeout(state.eventTimer);
      window.clearTimeout(state.eventReconnectTimer);
      window.clearTimeout(state.refreshTimer);
    });
  }

  function closeMessagingOverlaysForCall() {
    if (!document.body.classList.contains("timeblock-call-active")) return;
    closeReactionPalette();
    [
      ui.settingsDialog,
      ui.editDialog,
      ui.deleteDialog,
      ui.conversationActionDialog,
      ui.mailboxUnlockDialog,
    ].forEach((dialog) => {
      if (dialog?.open || dialog?.hasAttribute("open")) {
        closeDialog(dialog, false);
      }
    });
  }

  function bindOverlayDismissals() {
    document.addEventListener("pointerdown", (event) => {
      const active = state.activeReaction;
      if (
        active
        && !active.palette.contains(event.target)
        && event.target !== active.trigger
      ) {
        closeReactionPalette();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeReaction) {
        closeReactionPalette(true);
      }
    });
    window.addEventListener("resize", repositionActiveReaction);
    window.visualViewport?.addEventListener(
      "resize",
      repositionActiveReaction,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      repositionActiveReaction,
    );
    messagesPanel.querySelector("[data-thread-messages]")?.addEventListener(
      "scroll",
      repositionActiveReaction,
      { passive: true },
    );
    const callObserver = new MutationObserver(closeMessagingOverlaysForCall);
    callObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener(
      "pagehide",
      () => callObserver.disconnect(),
      { once: true },
    );
  }

  function init() {
    mountFilters();
    mountThreadToolbar();
    mountReplyBar();
    buildSettingsDialog();
    buildEditDialog();
    buildDeleteDialog();
    buildConversationActionDialog();
    buildMailboxUnlockDialog();
    bindMessagingEvents();
    bindOverlayDismissals();
    loadEventCursor();
    updateSyncStatus("connecting");
    if (
      app.dataset.messagingRealtimeEnabled !== "false"
      && "EventSource" in window
    ) {
      startEventStream();
    } else {
      scheduleEventPoll(0);
    }
  }

  init();
}());
