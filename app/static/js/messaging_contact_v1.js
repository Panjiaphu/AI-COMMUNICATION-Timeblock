(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  const panel = app?.querySelector('[data-mode-panel="messages"]');
  const rail = panel?.querySelector(".assistant-contact-rail");
  if (!app || !panel || !rail) return;

  const state = {
    copy: {},
    me: null,
    connections: [],
    blocks: [],
    activeTab: "connections",
    searchResults: [],
    busy: new Set(),
    surface: null,
  };

  const ui = {};
  let toastTimer = null;
  const key = (ownerType, ownerId) => `${String(ownerType)}:${String(ownerId)}`;
  const t = (name) => state.copy[`messaging.contact.${name}`] || "";
  const compactQuery = window.matchMedia("(max-width: 599px)");

  const ICON_MARKUP = Object.freeze({
    message: '<path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M7 10h10M7 13h6"/>',
    more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h3v3h-3zM18 18h2v2h-2zM18 14h2M14 18h2"/>',
    copy: '<rect x="8" y="8" width="10" height="12" rx="1.5"/><path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1"/>',
    camera: '<path d="M5 8.5h3l1.3-2h5.4l1.3 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="14" r="3.2"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  });

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
    if (!response.ok) {
      const error = new Error(payload.error || t("common.failed"));
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

  function initials(item) {
    const value = String(item?.display_name || item?.public_id || "?").trim();
    return value
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";
  }

  function avatarNode(item, className = "messaging-contact-v1-avatar") {
    const wrapper = document.createElement("span");
    wrapper.className = className;
    const fallback = document.createElement("span");
    fallback.textContent = initials(item);
    fallback.setAttribute("aria-hidden", "true");
    wrapper.appendChild(fallback);
    if (item?.avatar_url) {
      const image = new Image();
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      const version = item.avatar_version ? `?v=${encodeURIComponent(item.avatar_version)}` : "";
      image.src = `${item.avatar_url}${version}`;
      image.addEventListener("load", () => wrapper.classList.add("has-image"), { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      wrapper.appendChild(image);
    }
    return wrapper;
  }

  function iconSvg(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = ICON_MARKUP[name] || ICON_MARKUP.more;
    return svg;
  }

  function iconButton(label, iconName, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `messaging-contact-v1-icon-button ${className}`.trim();
    button.dataset.contactIcon = iconName;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.appendChild(iconSvg(iconName));
    return button;
  }

  function actionButton(label, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `messaging-contact-v1-menu-action ${className}`.trim();
    button.textContent = label;
    return button;
  }

  function peerForConnection(connection) {
    return connection?.peer || null;
  }

  function direction(connection) {
    if (!connection || !state.me) return "";
    const isRequester = connection.requester_type === state.me.owner_type
      && String(connection.requester_id) === String(state.me.owner_id);
    return isRequester ? "outgoing" : "incoming";
  }

  function relationshipFor(entry) {
    if (isBlockedByMe(entry)) return { relationship: "blocked_by_me", connection: null };
    const matching = state.connections.find((connection) => {
      const peer = peerForConnection(connection);
      return peer && key(peer.owner_type, peer.owner_id) === key(entry.owner_type, entry.owner_id);
    });
    if (!matching) return { relationship: entry.relationship || "none", connection: null };
    if (matching.status === "pending") {
      return {
        relationship: direction(matching) === "outgoing" ? "pending_sent" : "pending_received",
        connection: matching,
      };
    }
    return { relationship: matching.status || "none", connection: matching };
  }

  function isBlockedByMe(item) {
    return state.blocks.some((block) => key(block.owner_type, block.owner_id) === key(item.owner_type, item.owner_id));
  }

  function presenceText(item) {
    const online = item?.is_online === true || item?.online === true || item?.presence === "online";
    const offline = item?.is_online === false || item?.online === false || item?.presence === "offline";
    if (online) return t("status.online");
    if (offline) return t("status.offline");
    return "";
  }

  function setFeedback(message, isError = false) {
    if (!ui.feedback) return;
    ui.feedback.textContent = message || "";
    ui.feedback.hidden = !message;
    ui.feedback.classList.toggle("is-error", Boolean(isError));
    ui.feedback.setAttribute("role", isError ? "alert" : "status");
  }

  function showToast(message) {
    if (!message) return;
    document.querySelector("[data-contact-v1-toast]")?.remove();
    window.clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "messaging-contact-v1-toast";
    toast.dataset.contactV1Toast = "";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = window.setTimeout(() => toast.remove(), 2400);
  }

  function focusableNodes(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hidden && node.getClientRects().length);
  }

  function positionAnchoredSurface(dialog, trigger) {
    if (!dialog || !trigger || compactQuery.matches) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(340, Math.max(280, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 360));
    dialog.style.setProperty("--contact-v1-menu-left", `${left}px`);
    dialog.style.setProperty("--contact-v1-menu-top", `${top}px`);
  }

  function closeSurface(restoreFocus = true) {
    const surface = state.surface;
    if (!surface) return;
    document.removeEventListener("keydown", surface.keydown, true);
    surface.root.remove();
    state.surface = null;
    if (restoreFocus && surface.trigger?.isConnected) {
      window.requestAnimationFrame(() => surface.trigger.focus());
    }
  }

  function openSurface({ kind, label, trigger, anchored = false, build }) {
    closeSurface(false);
    const root = document.createElement("div");
    root.className = `messaging-contact-v1-overlay is-${kind}`;
    root.dataset.contactV1Overlay = kind;

    const dialog = document.createElement("section");
    dialog.className = `messaging-contact-v1-surface is-${kind}`;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", label);
    dialog.tabIndex = -1;
    if (anchored) dialog.classList.add("is-anchored");

    const handle = document.createElement("span");
    handle.className = "messaging-contact-v1-sheet-handle";
    handle.setAttribute("aria-hidden", "true");
    dialog.appendChild(handle);

    build(dialog);
    root.appendChild(dialog);
    document.body.appendChild(root);
    if (anchored) positionAnchoredSurface(dialog, trigger);

    const keydown = (event) => {
      if (!state.surface || state.surface.root !== root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeSurface(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = focusableNodes(dialog);
      if (!focusables.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("mousedown", (event) => {
      if (event.target === root) closeSurface(true);
    });
    document.addEventListener("keydown", keydown, true);
    state.surface = { root, dialog, trigger, keydown };
    window.requestAnimationFrame(() => {
      const target = focusableNodes(dialog)[0] || dialog;
      target.focus();
    });
    return dialog;
  }

  async function mutate(busyKey, task, focusAfter = null) {
    if (state.busy.has(busyKey)) return false;
    state.busy.add(busyKey);
    render();
    try {
      await task();
      await refresh();
      await rerunSearch();
      setFeedback("");
      return true;
    } catch (error) {
      setFeedback(error.message || t("common.failed"), true);
      return false;
    } finally {
      state.busy.delete(busyKey);
      render();
      if (focusAfter?.isConnected) window.requestAnimationFrame(() => focusAfter.focus());
    }
  }

  function runRelationshipMutation(item, task, focusAfter = null) {
    return mutate(key(item.owner_type, item.owner_id), task, focusAfter);
  }

  function openConfirmation({ title, message, actionLabel, actionClass = "is-danger", trigger, task, focusAfter }) {
    openSurface({
      kind: "confirm",
      label: title,
      trigger,
      build(dialog) {
        const heading = document.createElement("h3");
        heading.className = "messaging-contact-v1-surface-title";
        heading.textContent = title;
        const copy = document.createElement("p");
        copy.className = "messaging-contact-v1-confirm-copy";
        copy.textContent = message;
        const actions = document.createElement("div");
        actions.className = "messaging-contact-v1-confirm-actions";
        const cancel = actionButton(t("common.cancel"));
        const confirm = actionButton(actionLabel, actionClass);
        cancel.addEventListener("click", () => closeSurface(true));
        confirm.addEventListener("click", async () => {
          if (confirm.disabled) return;
          confirm.disabled = true;
          cancel.disabled = true;
          closeSurface(false);
          await task();
          if (focusAfter?.isConnected) window.requestAnimationFrame(() => focusAfter.focus());
        });
        actions.append(cancel, confirm);
        dialog.append(heading, copy, actions);
      },
    });
  }

  function blockTask(item, focusAfter) {
    openConfirmation({
      title: t("confirm.title"),
      message: t("confirm.block"),
      actionLabel: t("actions.block"),
      trigger: focusAfter,
      focusAfter,
      task: () => runRelationshipMutation(
        item,
        () => api(
          `/api/messaging/users/${encodeURIComponent(item.owner_type)}/${encodeURIComponent(item.owner_id)}/block`,
          jsonOptions("POST", {}),
        ),
        focusAfter,
      ),
    });
  }

  function unblockTask(item, focusAfter) {
    openConfirmation({
      title: t("confirm.title"),
      message: t("confirm.unblock"),
      actionLabel: t("actions.unblock"),
      actionClass: "is-primary",
      trigger: focusAfter,
      focusAfter,
      task: () => runRelationshipMutation(
        item,
        () => api(
          `/api/messaging/users/${encodeURIComponent(item.owner_type)}/${encodeURIComponent(item.owner_id)}/block`,
          { method: "DELETE" },
        ),
        focusAfter,
      ),
    });
  }

  function removeFriendTask(item, connection, focusAfter) {
    if (!connection) return;
    openConfirmation({
      title: t("confirm.title"),
      message: t("confirm.remove"),
      actionLabel: t("actions.remove"),
      trigger: focusAfter,
      focusAfter,
      task: () => runRelationshipMutation(
        item,
        () => api(`/api/messaging/connections/${connection.id}`, { method: "DELETE" }),
        focusAfter,
      ),
    });
  }

  async function openChat(item) {
    const itemKey = key(item.owner_type, item.owner_id);
    if (state.busy.has(itemKey)) return;
    state.busy.add(itemKey);
    render();
    try {
      const payload = await api(
        "/api/messaging/conversations/direct",
        jsonOptions("POST", { public_id: item.public_id }),
      );
      const conversationId = Number(payload?.conversation?.id || 0);
      if (!conversationId) throw new Error(t("common.failed"));
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "messages");
      url.searchParams.set("conversation", String(conversationId));
      window.location.assign(url.toString());
    } catch (error) {
      state.busy.delete(itemKey);
      render();
      setFeedback(error.message || t("common.failed"), true);
    }
  }

  function menuAction(label, handler, { disabled = false, danger = false, primary = false } = {}) {
    return { label, handler, disabled, danger, primary };
  }

  function actionSpecs(item, relationship, connection, trigger) {
    const focusAfter = trigger;
    if (relationship === "blocked_by_me" || isBlockedByMe(item)) {
      return [
        menuAction(t("actions.unblock"), () => unblockTask(item, focusAfter), { primary: true }),
      ];
    }
    if (relationship === "accepted") {
      return [
        menuAction(t("actions.remove"), () => removeFriendTask(item, connection, focusAfter)),
        menuAction(t("actions.block"), () => blockTask(item, focusAfter), { danger: true }),
      ];
    }
    if (relationship === "pending_received") {
      return [
        menuAction(t("actions.accept"), () => runRelationshipMutation(
          item,
          () => api(`/api/messaging/connections/${connection.id}/accept`, { method: "POST" }),
          focusAfter,
        ), { primary: true }),
        menuAction(t("actions.reject"), () => runRelationshipMutation(
          item,
          () => api(`/api/messaging/connections/${connection.id}/reject`, { method: "POST" }),
          focusAfter,
        )),
        menuAction(t("actions.block"), () => blockTask(item, focusAfter), { danger: true }),
      ];
    }
    if (relationship === "pending_sent") {
      return [
        menuAction(t("actions.cancel"), () => runRelationshipMutation(
          item,
          () => api(`/api/messaging/connections/${connection.id}/cancel`, { method: "POST" }),
          focusAfter,
        )),
        menuAction(t("actions.block"), () => blockTask(item, focusAfter), { danger: true }),
      ];
    }
    return [
      menuAction(t("actions.add"), () => runRelationshipMutation(
        item,
        () => api(
          "/api/messaging/connections/request",
          jsonOptions("POST", { public_id: item.public_id }),
        ),
        focusAfter,
      ), { primary: true }),
      menuAction(t("actions.block"), () => blockTask(item, focusAfter), { danger: true }),
    ];
  }

  function openContactMenu(item, relationship, connection, trigger) {
    openSurface({
      kind: "menu",
      label: t("actions.more"),
      trigger,
      anchored: true,
      build(dialog) {
        const heading = document.createElement("div");
        heading.className = "messaging-contact-v1-menu-heading";
        heading.appendChild(avatarNode(item, "messaging-contact-v1-avatar is-menu-avatar"));
        const copy = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = item.display_name || item.public_id || "";
        const small = document.createElement("small");
        small.textContent = item.public_id || "";
        copy.append(strong, small);
        heading.appendChild(copy);

        const menu = document.createElement("div");
        menu.className = "messaging-contact-v1-menu-list";
        actionSpecs(item, relationship, connection, trigger).forEach((spec) => {
          const button = actionButton(
            spec.label,
            `${spec.danger ? "is-danger" : ""} ${spec.primary ? "is-primary" : ""}`.trim(),
          );
          button.disabled = spec.disabled || state.busy.has(key(item.owner_type, item.owner_id));
          button.addEventListener("click", () => {
            if (button.disabled) return;
            closeSurface(false);
            spec.handler();
          });
          menu.appendChild(button);
        });

        const cancel = actionButton(t("common.cancel"), "is-cancel");
        cancel.addEventListener("click", () => closeSurface(true));
        dialog.append(heading, menu, cancel);
      },
    });
  }

  function contactRow(item, relationship = "none", connection = null) {
    const article = document.createElement("article");
    article.className = "messaging-contact-v1-row";
    article.dataset.contactV1PublicId = String(item.public_id || "");
    article.dataset.contactV1Relationship = relationship;

    article.appendChild(avatarNode(item));

    const copy = document.createElement("span");
    copy.className = "messaging-contact-v1-copy";
    const strong = document.createElement("strong");
    strong.textContent = item.display_name || item.public_id || "";
    const meta = document.createElement("span");
    meta.className = "messaging-contact-v1-meta";
    const publicId = document.createElement("small");
    publicId.textContent = item.public_id || "";
    meta.appendChild(publicId);
    const presence = presenceText(item);
    if (presence) {
      const dot = document.createElement("i");
      dot.className = "messaging-contact-v1-presence-dot";
      dot.setAttribute("aria-hidden", "true");
      const status = document.createElement("small");
      status.textContent = presence;
      meta.append(dot, status);
    }
    copy.append(strong, meta);
    article.appendChild(copy);

    const controls = document.createElement("span");
    controls.className = "messaging-contact-v1-row-controls";
    if (relationship === "accepted") {
      const message = iconButton(t("actions.chat"), "message", "is-message");
      message.addEventListener("click", () => openChat(item));
      controls.appendChild(message);
    }
    const more = iconButton(t("actions.more"), "more", "is-more");
    more.setAttribute("aria-haspopup", "dialog");
    more.addEventListener("click", () => openContactMenu(item, relationship, connection, more));
    controls.appendChild(more);
    article.appendChild(controls);

    return article;
  }

  function pendingConnections() {
    return state.connections.filter((item) => item.status === "pending");
  }

  function acceptedConnections() {
    return state.connections.filter((item) => item.status === "accepted" && item.block_state === "none");
  }

  function renderList() {
    if (!ui.list) return;
    let nodes = [];
    let empty = "";
    if (state.activeTab === "connections") {
      nodes = acceptedConnections().map((connection) => contactRow(connection.peer, "accepted", connection));
      empty = t("empty.connections");
    } else if (state.activeTab === "requests") {
      nodes = pendingConnections().map((connection) => contactRow(
        connection.peer,
        direction(connection) === "outgoing" ? "pending_sent" : "pending_received",
        connection,
      ));
      empty = t("empty.requests");
    } else {
      nodes = state.blocks.map((item) => contactRow(item, "blocked_by_me", null));
      empty = t("empty.blocked");
    }
    if (!nodes.length) {
      const message = document.createElement("p");
      message.className = "messaging-contact-v1-empty";
      message.textContent = empty;
      nodes = [message];
    }
    ui.list.replaceChildren(...nodes);
  }

  function renderSearch() {
    if (!ui.searchResults) return;
    const nodes = state.searchResults.map((entry) => {
      const { relationship, connection } = relationshipFor(entry);
      return contactRow(entry, relationship, connection);
    });
    ui.searchResults.replaceChildren(...nodes);
    ui.searchResults.hidden = !nodes.length;
  }

  function renderTabs() {
    if (!ui.tabs) return;
    const counts = {
      connections: acceptedConnections().length,
      requests: pendingConnections().length,
      blocked: state.blocks.length,
    };
    ui.tabs.querySelectorAll("button[data-contact-v1-tab]").forEach((button) => {
      const tab = button.dataset.contactV1Tab;
      const active = tab === state.activeTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      const count = button.querySelector("b");
      if (count) count.textContent = String(counts[tab] || 0);
    });
  }

  function invokeLegacy(selector) {
    const target = ui.legacyQr?.querySelector(selector);
    if (!target) return false;
    target.click();
    return true;
  }

  async function copyPublicId() {
    if (invokeLegacy("[data-network-copy-id]")) {
      showToast(t("qr.copied"));
      return;
    }
    const publicId = String(state.me?.public_id || "");
    if (!publicId) return;
    try {
      await navigator.clipboard.writeText(publicId);
      showToast(t("qr.copied"));
    } catch (_error) {
      setFeedback(t("common.failed"), true);
    }
  }

  function qrSource() {
    const source = ui.legacyQr?.querySelector("[data-network-qr]")?.getAttribute("src");
    return String(source || "");
  }

  function openQr(trigger) {
    openSurface({
      kind: "qr",
      label: t("qr.title"),
      trigger,
      build(dialog) {
        const header = document.createElement("div");
        header.className = "messaging-contact-v1-surface-header";
        const title = document.createElement("h3");
        title.className = "messaging-contact-v1-surface-title";
        title.textContent = t("qr.title");
        const close = iconButton(t("common.close"), "close", "is-close");
        close.addEventListener("click", () => closeSurface(true));
        header.append(title, close);

        const qrWrap = document.createElement("div");
        qrWrap.className = "messaging-contact-v1-qr-preview";
        const source = qrSource();
        if (source) {
          const image = new Image();
          image.src = source;
          image.alt = t("qr.title");
          image.width = 220;
          image.height = 220;
          qrWrap.appendChild(image);
        }
        const publicId = document.createElement("code");
        publicId.textContent = state.me?.public_id || "";
        qrWrap.appendChild(publicId);

        const actions = document.createElement("div");
        actions.className = "messaging-contact-v1-qr-actions";
        const copy = actionButton(t("qr.copy"));
        const download = actionButton(t("qr.download"));
        const share = actionButton(t("qr.share"));
        copy.addEventListener("click", copyPublicId);
        download.addEventListener("click", () => invokeLegacy("[data-network-download-qr]"));
        share.addEventListener("click", () => invokeLegacy("[data-network-share-qr]"));
        actions.append(copy, download, share);

        const note = document.createElement("p");
        note.className = "messaging-contact-v1-privacy-note";
        note.textContent = t("qr.privacy");
        dialog.append(header, qrWrap, actions, note);
      },
    });
  }

  async function uploadAvatar(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFeedback(t("avatar.too_large"), true);
      return;
    }
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) {
      setFeedback(t("avatar.invalid"), true);
      return;
    }
    const form = new FormData();
    form.append("avatar", file, file.name || "avatar");
    ui.avatarTrigger.disabled = true;
    setFeedback(t("avatar.uploading"));
    try {
      await api("/api/messaging/directory/me/avatar", { method: "POST", body: form });
      await refresh();
      app.dispatchEvent(new CustomEvent("timeblock:messaging:contact-avatar-updated", {
        detail: { public_id: state.me?.public_id || "" },
      }));
      setFeedback("");
    } catch (error) {
      setFeedback(error.message || t("avatar.invalid"), true);
    } finally {
      ui.avatarTrigger.disabled = false;
      ui.avatarInput.value = "";
    }
  }

  async function removeAvatar() {
    ui.avatarTrigger.disabled = true;
    try {
      await api("/api/messaging/directory/me/avatar", { method: "DELETE" });
      await refresh();
      app.dispatchEvent(new CustomEvent("timeblock:messaging:contact-avatar-updated", {
        detail: { public_id: state.me?.public_id || "" },
      }));
      setFeedback("");
    } catch (error) {
      setFeedback(error.message || t("common.failed"), true);
    } finally {
      ui.avatarTrigger.disabled = false;
    }
  }

  function openAvatarMenu(trigger) {
    openSurface({
      kind: "avatar",
      label: t("avatar.manage"),
      trigger,
      anchored: true,
      build(dialog) {
        const title = document.createElement("h3");
        title.className = "messaging-contact-v1-surface-title";
        title.textContent = t("avatar.manage");
        const actions = document.createElement("div");
        actions.className = "messaging-contact-v1-menu-list";
        const upload = actionButton(state.me?.avatar_url ? t("avatar.change") : t("avatar.add"), "is-primary");
        upload.addEventListener("click", () => {
          closeSurface(false);
          ui.avatarInput.click();
        });
        actions.appendChild(upload);
        if (state.me?.avatar_url) {
          const remove = actionButton(t("avatar.remove"), "is-danger");
          remove.addEventListener("click", async () => {
            closeSurface(false);
            await removeAvatar();
            if (trigger.isConnected) trigger.focus();
          });
          actions.appendChild(remove);
        }
        const cancel = actionButton(t("common.cancel"), "is-cancel");
        cancel.addEventListener("click", () => closeSurface(true));
        dialog.append(title, actions, cancel);
      },
    });
  }

  function renderIdentity() {
    if (!ui.identity || !state.me) return;
    ui.identityAvatar.replaceChildren(avatarNode(state.me, "messaging-contact-v1-avatar is-me"));
    ui.identityName.textContent = state.me.display_name || state.me.public_id || "";
    ui.identityId.textContent = state.me.public_id || "";
    ui.avatarTrigger.setAttribute("aria-label", t("avatar.manage"));
    ui.avatarTrigger.setAttribute("title", t("avatar.manage"));
    ui.qrTrigger.setAttribute("aria-label", t("qr.open"));
    ui.qrTrigger.setAttribute("title", t("qr.open"));
    ui.copyTrigger.setAttribute("aria-label", t("qr.copy"));
    ui.copyTrigger.setAttribute("title", t("qr.copy"));
  }

  function syncSearchCopy() {
    const searchForm = rail.querySelector("[data-network-search]");
    const searchLabel = searchForm?.querySelector("label");
    const searchInput = searchForm?.querySelector("[data-network-query]");
    const compact = compactQuery.matches;
    if (searchLabel) {
      searchLabel.textContent = t(compact ? "search.compact_label" : "search.label") || searchLabel.textContent;
    }
    if (searchInput) {
      searchInput.placeholder = t(compact ? "search.compact_placeholder" : "search.placeholder") || searchInput.placeholder;
    }
  }

  function render() {
    renderIdentity();
    renderTabs();
    renderList();
    renderSearch();
  }

  async function refresh() {
    const [me, connections, blocks] = await Promise.all([
      api("/api/messaging/contact-v1/me"),
      api("/api/messaging/connections"),
      api("/api/messaging/blocks"),
    ]);
    state.me = me.entry || null;
    state.connections = Array.isArray(connections.connections) ? connections.connections : [];
    state.blocks = Array.isArray(blocks.blocks) ? blocks.blocks : [];
    render();
  }

  async function rerunSearch() {
    const input = rail.querySelector("[data-network-query]");
    const query = String(input?.value || "").trim();
    if (query.length < 2) {
      state.searchResults = [];
      renderSearch();
      return;
    }
    try {
      const payload = await api(`/api/messaging/directory/search?q=${encodeURIComponent(query)}`);
      state.searchResults = (payload.results || []).filter((entry) => !(
        state.me
        && key(entry.owner_type, entry.owner_id) === key(state.me.owner_type, state.me.owner_id)
      ));
      renderSearch();
    } catch (error) {
      setFeedback(error.message || t("common.failed"), true);
    }
  }

  function mountIdentity() {
    const card = rail.querySelector(".assistant-contact-qr");
    if (!card) return;
    const legacy = document.createElement("div");
    legacy.className = "messaging-contact-v1-legacy-qr";
    legacy.hidden = true;
    while (card.firstChild) legacy.appendChild(card.firstChild);

    const identity = document.createElement("section");
    identity.className = "messaging-contact-v1-identity";
    identity.dataset.contactV1Identity = "";

    const avatarTrigger = document.createElement("button");
    avatarTrigger.type = "button";
    avatarTrigger.className = "messaging-contact-v1-avatar-trigger";
    avatarTrigger.setAttribute("aria-haspopup", "dialog");
    const avatarSlot = document.createElement("span");
    avatarSlot.className = "messaging-contact-v1-avatar-slot";
    const camera = document.createElement("span");
    camera.className = "messaging-contact-v1-camera-badge";
    camera.setAttribute("aria-hidden", "true");
    camera.appendChild(iconSvg("camera"));
    avatarTrigger.append(avatarSlot, camera);
    avatarTrigger.addEventListener("click", () => openAvatarMenu(avatarTrigger));

    const copy = document.createElement("span");
    copy.className = "messaging-contact-v1-identity-copy";
    const name = document.createElement("strong");
    const publicId = document.createElement("code");
    copy.append(name, publicId);

    const actions = document.createElement("span");
    actions.className = "messaging-contact-v1-identity-actions";
    const qr = iconButton(t("qr.open"), "qr", "is-qr");
    qr.setAttribute("aria-haspopup", "dialog");
    qr.addEventListener("click", () => openQr(qr));
    const copyButton = iconButton(t("qr.copy"), "copy", "is-copy messaging-contact-v1-copy-id");
    copyButton.addEventListener("click", copyPublicId);
    actions.append(qr, copyButton);

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.className = "assistant-sr-only";
    input.dataset.contactV1AvatarInput = "";
    input.addEventListener("change", () => uploadAvatar(input.files?.[0]));

    identity.append(avatarTrigger, copy, actions, input);
    card.classList.add("is-contact-v1-identity-host");
    card.append(identity, legacy);

    ui.identity = identity;
    ui.identityAvatar = avatarSlot;
    ui.identityName = name;
    ui.identityId = publicId;
    ui.avatarTrigger = avatarTrigger;
    ui.avatarInput = input;
    ui.qrTrigger = qr;
    ui.copyTrigger = copyButton;
    ui.legacyQr = legacy;
  }

  function mountManager() {
    const feedback = rail.querySelector("[data-network-feedback]");
    const section = document.createElement("section");
    section.className = "assistant-rail-section messaging-contact-v1";
    section.dataset.contactV1 = "";

    const searchResults = document.createElement("div");
    searchResults.className = "messaging-contact-v1-search-results";
    searchResults.hidden = true;

    const tabsViewport = document.createElement("div");
    tabsViewport.className = "messaging-contact-v1-tabs-viewport";
    const tabs = document.createElement("div");
    tabs.className = "messaging-contact-v1-tabs";
    tabs.setAttribute("role", "tablist");
    [
      ["connections", "tabs.connections"],
      ["requests", "tabs.requests"],
      ["blocked", "tabs.blocked"],
    ].forEach(([name, labelKey]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.contactV1Tab = name;
      button.setAttribute("role", "tab");
      const label = document.createElement("span");
      label.textContent = t(labelKey);
      const count = document.createElement("b");
      count.textContent = "0";
      button.append(label, count);
      button.addEventListener("click", () => {
        state.activeTab = name;
        render();
      });
      tabs.appendChild(button);
    });
    tabsViewport.appendChild(tabs);

    const list = document.createElement("div");
    list.className = "messaging-contact-v1-list";
    section.append(searchResults, tabsViewport, list);
    if (feedback) feedback.after(section);
    else rail.prepend(section);

    ui.feedback = feedback;
    ui.searchResults = searchResults;
    ui.tabs = tabs;
    ui.list = list;

    ["[data-online-list]", "[data-connection-list]"].forEach((selector) => {
      const legacySection = rail.querySelector(selector)?.closest(".assistant-rail-section");
      if (legacySection) legacySection.dataset.contactV1LegacyHidden = "true";
    });

    const searchForm = rail.querySelector("[data-network-search]");
    searchForm?.addEventListener("submit", () => window.setTimeout(rerunSearch, 0));
    const searchInput = rail.querySelector("[data-network-query]");
    searchInput?.addEventListener("input", () => {
      if (String(searchInput.value || "").trim().length < 2) {
        state.searchResults = [];
        renderSearch();
      }
    });
    syncSearchCopy();
  }

  async function init() {
    try {
      const i18n = await api("/api/messaging/contact-v1/i18n");
      state.copy = i18n.copy || {};
      mountIdentity();
      mountManager();
      await refresh();
    } catch (error) {
      const fallback = rail.querySelector("[data-network-feedback]");
      if (fallback) {
        fallback.textContent = error.message || t("common.failed") || "Contact controls unavailable";
        fallback.classList.add("is-error");
      }
    }
  }

  window.addEventListener("resize", () => {
    if (state.surface?.dialog?.classList.contains("is-anchored")) {
      positionAnchoredSurface(state.surface.dialog, state.surface.trigger);
    }
  });

  const handleCompactChange = () => syncSearchCopy();
  if (typeof compactQuery.addEventListener === "function") compactQuery.addEventListener("change", handleCompactChange);
  else compactQuery.addListener(handleCompactChange);

  init();
})();
