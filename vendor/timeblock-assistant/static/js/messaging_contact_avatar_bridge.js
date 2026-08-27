(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const conversationPeers = new Map();
  const avatarMetadata = new Map();
  const pendingIds = new Set();
  const compactThreadQuery = window.matchMedia("(max-width: 839px)");
  let metadataRequest = null;
  let scheduled = false;

  function normalizedPublicId(value) {
    const publicId = String(value || "").trim().toUpperCase();
    return /^(MEM|BIZ)-[A-Z0-9-]{3,}$/u.test(publicId) ? publicId : "";
  }

  function withVersion(url, version) {
    if (!url) return "";
    return version ? `${url}?v=${encodeURIComponent(version)}` : url;
  }

  function queueMetadata(publicId) {
    const value = normalizedPublicId(publicId);
    if (!value || avatarMetadata.has(value)) return;
    pendingIds.add(value);
    scheduleMetadataFetch();
  }

  function scheduleMetadataFetch() {
    if (scheduled || metadataRequest || !pendingIds.size) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      fetchMetadata();
    });
  }

  async function fetchMetadata() {
    if (metadataRequest || !pendingIds.size) return;
    const publicIds = Array.from(pendingIds).slice(0, 50);
    publicIds.forEach((publicId) => pendingIds.delete(publicId));
    metadataRequest = fetch("/api/messaging/contact-v1/avatars", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ public_ids: publicIds }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("avatar metadata unavailable");
        return response.json();
      })
      .then((payload) => {
        const avatars = payload?.avatars && typeof payload.avatars === "object"
          ? payload.avatars
          : {};
        publicIds.forEach((publicId) => {
          const contract = avatars[publicId] || null;
          avatarMetadata.set(publicId, contract && contract.avatar_url
            ? {
                url: String(contract.avatar_url),
                version: String(contract.avatar_version || ""),
              }
            : null);
        });
      })
      .catch(() => {
        publicIds.forEach((publicId) => avatarMetadata.set(publicId, null));
      })
      .finally(() => {
        metadataRequest = null;
        scan();
        if (pendingIds.size) scheduleMetadataFetch();
      });
    await metadataRequest;
  }

  function clearHydratedAvatar(element, publicId) {
    if (!element) return;
    const current = element.querySelector(":scope > img[data-contact-avatar-bridge-image]");
    current?.remove();
    element.classList.remove("has-contact-avatar-image");
    element.dataset.contactAvatarBridge = publicId;
    delete element.dataset.contactAvatarSource;
  }

  function hydrateAvatar(element, publicId) {
    if (!element) return;
    const value = normalizedPublicId(publicId);
    if (!value) return;
    element.dataset.contactAvatarBridgeSlot = "";
    if (!avatarMetadata.has(value)) {
      queueMetadata(value);
      return;
    }
    const metadata = avatarMetadata.get(value);
    if (!metadata?.url) {
      clearHydratedAvatar(element, value);
      return;
    }
    const source = withVersion(metadata.url, metadata.version);
    if (element.dataset.contactAvatarBridge === value
        && element.dataset.contactAvatarSource === source
        && element.querySelector(":scope > img[data-contact-avatar-bridge-image]")) return;
    clearHydratedAvatar(element, value);
    element.dataset.contactAvatarSource = source;
    const image = new Image();
    image.dataset.contactAvatarBridgeImage = "";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = source;
    image.addEventListener("load", () => element.classList.add("has-contact-avatar-image"), { once: true });
    image.addEventListener("error", () => {
      image.remove();
      element.classList.remove("has-contact-avatar-image");
      avatarMetadata.set(value, null);
    }, { once: true });
    element.appendChild(image);
  }

  function hydrateOnline() {
    app.querySelectorAll("[data-online-list] .assistant-list-item").forEach((row) => {
      const publicId = row.querySelector(".assistant-list-copy small")?.textContent?.trim();
      hydrateAvatar(row.querySelector(".assistant-list-avatar"), publicId);
    });
  }

  function hydrateConversations() {
    app.querySelectorAll("[data-conversation-list] [data-messaging-conversation-id]").forEach((row) => {
      const peer = conversationPeers.get(String(row.dataset.messagingConversationId || ""));
      if (!peer?.public_id || peer.kind === "group") return;
      hydrateAvatar(row.querySelector(".assistant-list-avatar"), peer.public_id);
    });
    hydrateThreadHeader();
  }

  function ensureDesktopThreadAvatar() {
    const header = app.querySelector(".assistant-thread-header .assistant-inline-actions");
    if (!header) return null;
    let slot = header.querySelector("[data-contact-thread-avatar]");
    if (!slot) {
      slot = document.createElement("span");
      slot.className = "assistant-list-avatar messaging-contact-thread-avatar";
      slot.dataset.contactThreadAvatar = "";
      slot.setAttribute("aria-hidden", "true");
      const back = header.querySelector("[data-thread-back]");
      if (back?.nextSibling) header.insertBefore(slot, back.nextSibling);
      else header.prepend(slot);
    }
    return slot;
  }

  function threadAvatarSlot() {
    if (compactThreadQuery.matches) {
      const canonicalMobile = app.querySelector(".messaging-mobile-thread-avatar");
      if (canonicalMobile) return canonicalMobile;
      return null;
    }
    return ensureDesktopThreadAvatar();
  }

  function hydrateThreadHeader() {
    const selected = app.querySelector(
      '[data-conversation-list] [data-messaging-conversation-id][aria-current="true"], '
      + '[data-conversation-list] [data-messaging-conversation-id].is-active',
    );
    if (!selected) return;
    const peer = conversationPeers.get(String(selected.dataset.messagingConversationId || ""));
    if (!peer?.public_id || peer.kind === "group") return;
    const slot = threadAvatarSlot();
    if (!slot) return;
    if (!slot.querySelector(":scope > img[data-contact-avatar-bridge-image]")) {
      slot.textContent = String(peer.display_name || peer.public_id || "?")
        .trim()
        .charAt(0)
        .toUpperCase() || "?";
    }
    hydrateAvatar(slot, peer.public_id);
  }

  function hydrateQrPreview() {
    const publicId = app.querySelector("[data-qr-preview-id]")?.textContent?.trim();
    if (!publicId || publicId === "-") return;
    hydrateAvatar(app.querySelector("[data-qr-preview-avatar]"), publicId);
  }

  function scan() {
    hydrateOnline();
    hydrateConversations();
    hydrateQrPreview();
  }

  app.addEventListener("timeblock:messaging:conversations", (event) => {
    conversationPeers.clear();
    (event.detail?.conversations || []).forEach((conversation) => {
      if (!conversation?.id || conversation.kind === "group") return;
      const peer = conversation.peer || null;
      if (peer?.public_id) conversationPeers.set(String(conversation.id), peer);
    });
    window.requestAnimationFrame(hydrateConversations);
  });

  app.addEventListener("timeblock:messaging:contact-avatar-updated", (event) => {
    const publicId = normalizedPublicId(event.detail?.public_id);
    if (!publicId) return;
    avatarMetadata.delete(publicId);
    queueMetadata(publicId);
  });

  compactThreadQuery.addEventListener?.("change", () => window.requestAnimationFrame(hydrateThreadHeader));

  const observer = new MutationObserver(() => window.requestAnimationFrame(scan));
  observer.observe(app, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-current", "class", "hidden"],
  });

  scan();
})();
