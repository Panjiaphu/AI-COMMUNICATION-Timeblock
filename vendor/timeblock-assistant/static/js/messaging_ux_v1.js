(function messagingUxV1(global) {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const MAX_IMAGES = 10;
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const imageStates = new WeakMap();
  let copy = null;
  let composerPatched = false;

  function format(template, values = {}) {
    return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ""));
  }

  async function loadCopy() {
    const response = await fetch("/static/i18n/messaging_ux_v1.json?v=20260823a", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("messaging_ux_i18n_unavailable");
    const catalogue = await response.json();
    const locale = String(app.dataset.locale || "vi");
    copy = catalogue[locale] || catalogue.en || {};
    return copy;
  }

  function setBadge(node, value) {
    if (!node) return;
    const total = Math.max(0, Number(value) || 0);
    node.textContent = total > 99 ? "99+" : String(total);
    node.hidden = total <= 0;
  }

  async function refreshSummaryBadge() {
    const response = await fetch("/api/messaging/notifications/summary", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    const summary = payload.summary || {};
    const total = Number(summary.total ?? summary.unread_count) || 0;
    const messageTotal = (Number(summary.unread_conversation_messages) || 0)
      + (Number(summary.pending_friend_requests) || 0)
      + (Number(summary.ringing_calls) || 0);
    setBadge(app.querySelector("[data-assistant-badge]"), total);
    setBadge(app.querySelector("[data-message-tab-badge]"), messageTotal);
  }

  async function notificationUnreadCount() {
    const response = await fetch("/api/internal-messages/inbox?unread=1", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return (Array.isArray(payload.messages) ? payload.messages : [])
      .filter((message) => !message?.conversation_id)
      .length;
  }

  function refreshCanonicalNotifications() {
    const tab = app.querySelector('[data-mode-tab="alerts"]');
    if (tab && !tab.disabled) tab.click();
  }

  async function syncReadAllButton(button) {
    const count = await notificationUnreadCount();
    if (count === null) return;
    button.disabled = count === 0;
    button.textContent = count === 0 ? copy.allRead : copy.markAllRead;
  }

  function mountReadAll() {
    const inbox = app.querySelector("[data-notification-inbox]");
    const card = inbox?.closest(".assistant-alert-list-card");
    const header = card?.querySelector("header");
    if (!inbox || !header || header.querySelector("[data-notification-read-all]")) return;

    header.classList.add("messaging-ux-notification-header");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-secondary-button messaging-ux-read-all";
    button.dataset.notificationReadAll = "true";
    button.textContent = copy.markAllRead;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const response = await fetch("/api/internal-messages/inbox/read-all", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!response.ok) throw new Error("notification_read_all_failed");
        button.textContent = copy.allRead;
        refreshCanonicalNotifications();
        await refreshSummaryBadge();
        await syncReadAllButton(button);
      } catch (_error) {
        button.disabled = false;
        button.textContent = copy.markAllRead;
        const feedback = app.querySelector("[data-alert-feedback]");
        if (feedback) {
          feedback.textContent = copy.readAllFailed;
          feedback.classList.add("is-error");
          feedback.setAttribute("role", "alert");
        }
      } finally {
        button.removeAttribute("aria-busy");
      }
    });
    header.appendChild(button);
    syncReadAllButton(button).catch(() => undefined);
  }

  function compatibilityInput(form) {
    return form.querySelector("[data-message-file]");
  }

  function ensureCompatibilityFiles(form, files) {
    const input = compatibilityInput(form);
    if (!input || typeof DataTransfer !== "function") return false;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    return input.files?.length === files.length;
  }

  function stateFor(form) {
    let state = imageStates.get(form);
    if (state) return state;
    state = { files: [], preview: null, status: null, urls: [] };
    imageStates.set(form, state);
    return state;
  }

  function clearUrls(state) {
    state.urls.forEach((url) => URL.revokeObjectURL(url));
    state.urls = [];
  }

  function ensureMultiPreview(form, state) {
    if (state.preview?.isConnected) return state.preview;
    const box = form.querySelector(".assistant-composer-box");
    if (!box) return null;
    const section = document.createElement("section");
    section.className = "messaging-ux-multi-preview";
    section.dataset.messagingMultiImagePreview = "true";
    section.hidden = true;
    const grid = document.createElement("div");
    grid.className = "messaging-ux-preview-grid";
    const status = document.createElement("p");
    status.className = "messaging-ux-preview-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.append(grid, status);
    form.insertBefore(section, box);
    state.preview = section;
    state.status = status;
    return section;
  }

  function renderSelection(form) {
    const state = stateFor(form);
    const section = ensureMultiPreview(form, state);
    if (!section) return;
    const grid = section.querySelector(".messaging-ux-preview-grid");
    clearUrls(state);
    grid.replaceChildren();
    state.files.forEach((file, index) => {
      const item = document.createElement("figure");
      item.className = "messaging-ux-preview-item";
      const image = document.createElement("img");
      const url = URL.createObjectURL(file);
      state.urls.push(url);
      image.src = url;
      image.alt = file.name || `${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "messaging-ux-preview-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", format(copy.removeImage, { index: index + 1 }));
      remove.setAttribute("title", format(copy.removeImage, { index: index + 1 }));
      remove.addEventListener("click", () => {
        state.files.splice(index, 1);
        ensureCompatibilityFiles(form, state.files);
        renderSelection(form);
      });
      item.append(image, remove);
      grid.appendChild(item);
    });
    section.hidden = state.files.length === 0;
    state.status.textContent = state.files.length
      ? `${format(copy.imagesSelected, { count: state.files.length })} · ${copy.maxImages}`
      : "";
    if (!state.files.length) compatibilityInput(form).value = "";
  }

  function setSelectionError(form, message) {
    const state = stateFor(form);
    ensureMultiPreview(form, state);
    state.status.textContent = message || "";
    state.status.classList.add("is-error");
    global.setTimeout(() => state.status?.classList.remove("is-error"), 2200);
  }

  function handleGalleryChange(event) {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.matches("[data-messaging-composer-gallery]")) return;
    const form = input.closest("[data-message-form]");
    if (!form) return;
    event.stopImmediatePropagation();
    const incoming = Array.from(input.files || []);
    input.value = "";
    if (!incoming.length) return;
    if (incoming.some((file) => !IMAGE_TYPES.has(String(file.type || "").toLowerCase()))) {
      setSelectionError(form, copy.invalidImage);
      return;
    }
    const state = stateFor(form);
    if (state.files.length + incoming.length > MAX_IMAGES) {
      setSelectionError(form, copy.tooManyImages);
      return;
    }
    state.files.push(...incoming);
    if (!ensureCompatibilityFiles(form, state.files)) {
      setSelectionError(form, copy.tooManyImages);
      return;
    }
    renderSelection(form);
  }

  function clearMultiImages(form) {
    const state = imageStates.get(form);
    if (!state) return;
    clearUrls(state);
    state.files = [];
    if (state.preview) {
      state.preview.hidden = true;
      state.preview.querySelector(".messaging-ux-preview-grid")?.replaceChildren();
    }
    const input = compatibilityInput(form);
    if (input) input.value = "";
  }

  function patchComposerApi() {
    if (composerPatched) return true;
    const api = global.TimeblockMessagingComposerAttachmentsV2;
    if (!api?.decorateFormData) return false;
    const originalDecorate = api.decorateFormData.bind(api);
    api.decorateFormData = function decorateMultiImageFormData(form, formData) {
      const state = imageStates.get(form);
      if (!state?.files?.length) return originalDecorate(form, formData);
      formData.delete("image");
      state.files.forEach((file) => formData.append("image", file, file.name));
      return formData;
    };
    composerPatched = true;
    return true;
  }

  function mountGalleryInputs() {
    app.querySelectorAll("[data-message-form]").forEach((form) => {
      const gallery = form.querySelector("[data-messaging-composer-gallery]");
      if (gallery) gallery.multiple = true;
    });
    patchComposerApi();
  }

  function imageAttachments(message) {
    const raw = Array.isArray(message?.attachments)
      ? message.attachments
      : (message?.attachments && typeof message.attachments === "object" ? [message.attachments] : []);
    return raw.filter((attachment) => attachment?.url && String(attachment.mime_type || "").startsWith("image/"));
  }

  function safeSelectorValue(value) {
    if (global.CSS?.escape) return global.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function renderMessageGalleries(messages) {
    const thread = app.querySelector("[data-thread-messages]");
    if (!thread) return;
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      const images = imageAttachments(message);
      if (images.length < 2) return;
      const bubble = thread.querySelector(`[data-message-id="${safeSelectorValue(message.id)}"]`);
      if (!bubble) return;
      bubble.querySelector(".messaging-ux-image-grid")?.remove();
      const grid = document.createElement("section");
      grid.className = `messaging-ux-image-grid is-count-${Math.min(images.length, MAX_IMAGES)}`;
      grid.setAttribute("aria-label", copy.imageGallery);
      images.slice(0, MAX_IMAGES).forEach((attachment, index) => {
        const figure = document.createElement("figure");
        figure.className = "assistant-private-media assistant-thread-image messaging-ux-image-item";
        figure.dataset.attachmentId = String(attachment.id || "");
        figure.dataset.expiresAt = String(attachment.expires_at || "");
        const image = document.createElement("img");
        image.src = attachment.url;
        image.alt = `${copy.imageGallery} ${index + 1}`;
        image.loading = "lazy";
        image.decoding = "async";
        image.dataset.attachmentId = String(attachment.id || "");
        image.dataset.expiresAt = String(attachment.expires_at || "");
        figure.appendChild(image);
        grid.appendChild(figure);
      });
      const time = bubble.querySelector("time");
      if (time) bubble.insertBefore(grid, time);
      else bubble.appendChild(grid);
      if (String(message.content || "") === "image") {
        const textNode = bubble.querySelector(":scope > .assistant-thread-text");
        if (textNode?.textContent?.trim() === "image") textNode.remove();
      }
    });
  }

  function bindEvents() {
    document.addEventListener("change", handleGalleryChange, true);
    app.addEventListener("timeblock:messaging:message-sent", () => {
      app.querySelectorAll("[data-message-form]").forEach(clearMultiImages);
    });
    app.addEventListener("timeblock:messaging:attachment-change", (event) => {
      if (!event.detail?.attachment) return;
      app.querySelectorAll("[data-message-form]").forEach(clearMultiImages);
    });
    app.addEventListener("timeblock:messaging:messages", (event) => {
      renderMessageGalleries(event.detail?.messages || []);
      mountGalleryInputs();
    });
    app.addEventListener("timeblock:messaging:conversation", mountGalleryInputs);
  }

  async function bootstrap() {
    try {
      await loadCopy();
    } catch (_error) {
      return;
    }
    mountReadAll();
    mountGalleryInputs();
    bindEvents();
    const observer = new MutationObserver(() => {
      mountReadAll();
      mountGalleryInputs();
    });
    observer.observe(app, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(typeof window !== "undefined" ? window : globalThis);
