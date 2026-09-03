(() => {
  "use strict";

  const app = document.getElementById("assistant-app");
  const copyElement = document.getElementById("assistant-mobile-conversation-copy");
  if (!app || !copyElement) return;

  let copy = {};
  try {
    copy = JSON.parse(copyElement.textContent || "{}");
  } catch (_error) {
    return;
  }

  const mq = window.matchMedia("(max-width: 767px)");
  const standaloneMq = window.matchMedia("(display-mode: standalone)");
  const chat = app.querySelector("#assistant-panel-ai .assistant-chat-column");
  const preview = app.querySelector("#assistant-panel-ai .assistant-conversation-preview");
  const messages = app.querySelector("[data-ai-messages]");
  const composer = app.querySelector("[data-ai-form]");
  const fileInput = app.querySelector("[data-ai-file]");
  const attachLabel = fileInput?.closest("label");
  const contextPanel = app.querySelector("[data-context-panel]");
  const contextToggle = app.querySelector("[data-context-toggle]");
  const contextClose = app.querySelector("[data-context-close]");
  const contextType = app.querySelector("[data-context-type]");
  const contextCountry = app.querySelector("[data-context-country]");
  const contextSymbol = app.querySelector("[data-context-symbol]");
  const quota = app.querySelector("[data-assistant-quota]");
  const settingsLink = app.querySelector(".assistant-top-actions a[href]");
  const securityChip = app.querySelector(".assistant-security-chip");
  if (!chat || !messages || !composer) return;

  const isStandalone = () => (
    standaloneMq.matches
    || window.navigator.standalone === true
  );

  const syncStandaloneClass = () => {
    document.body.classList.toggle("assistant-pwa-standalone", isStandalone());
  };

  attachLabel?.classList.add("assistant-mobile-add-trigger");
  attachLabel?.setAttribute("tabindex", "0");

  const create = (tag, className, text = "") => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  const backdrop = create("button", "assistant-mobile-sheet-backdrop");
  backdrop.type = "button";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", copy.close || copy.back || "");

  const sheet = create("section", "assistant-mobile-ai-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", copy.more || "");

  const attachmentSheet = create("section", "assistant-mobile-attachment-sheet");
  attachmentSheet.setAttribute("role", "dialog");
  attachmentSheet.setAttribute("aria-modal", "true");
  attachmentSheet.setAttribute("aria-label", copy.attachments || "");

  const header = create("header", "assistant-mobile-ai-header");
  const back = create("button", "assistant-mobile-ai-back", "‹");
  back.type = "button";
  back.setAttribute("aria-label", copy.back || "");
  const headerCopy = create("div", "assistant-mobile-ai-header-copy");
  const title = create("strong", "", copy.title || "Timeblock AI");
  const subtitle = create("small", "");
  headerCopy.append(title, subtitle);
  const more = create("button", "assistant-mobile-ai-more", "⋯");
  more.type = "button";
  more.setAttribute("aria-label", copy.more || "");
  more.setAttribute("aria-expanded", "false");
  header.append(back, headerCopy, more);
  chat.prepend(header);

  const action = (label, handler) => {
    const button = create("button", "assistant-mobile-sheet-action", label);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  };

  const closeContext = () => {
    contextPanel?.classList.remove("is-mobile-open");
  };

  const closeSheets = () => {
    sheet.classList.remove("is-open");
    attachmentSheet.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    more.setAttribute("aria-expanded", "false");
  };

  const closeAllOverlays = () => {
    closeContext();
    closeSheets();
  };

  const openSheet = (target) => {
    closeAllOverlays();
    target.classList.add("is-open");
    backdrop.classList.add("is-open");
    if (target === sheet) more.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => target.querySelector("button")?.focus());
  };

  const openContext = () => {
    closeAllOverlays();
    contextToggle?.click();
    if (contextPanel?.classList.contains("is-mobile-open")) {
      backdrop.classList.add("is-open");
    }
  };

  const syncContextLabel = () => {
    let contextLabel = copy.general || "";
    const type = contextType?.value || "general";
    if (type === "market") contextLabel = copy.crypto || contextLabel;
    if (type === "equities") {
      const country = contextCountry?.selectedOptions?.[0]?.textContent?.trim() || "";
      const symbol = String(contextSymbol?.value || "").trim().toUpperCase();
      contextLabel = [copy.equities, country, symbol].filter(Boolean).join(" · ");
    }
    subtitle.textContent = [copy.ready, contextLabel].filter(Boolean).join(" · ");
  };

  sheet.appendChild(action(copy.context || "", openContext));

  let quotaClone = null;
  if (quota) {
    const quotaWrap = create("div", "assistant-mobile-sheet-quota");
    const quotaTitle = create("strong", "assistant-mobile-sheet-title", copy.quota || "");
    quotaClone = quota.cloneNode(true);
    quotaClone.removeAttribute("data-assistant-quota");
    quotaWrap.append(quotaTitle, quotaClone);
    sheet.appendChild(quotaWrap);

    const syncQuotaClone = () => {
      if (!quotaClone) return;
      quotaClone.innerHTML = quota.innerHTML;
    };
    new MutationObserver(syncQuotaClone).observe(quota, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  if (settingsLink?.href) {
    sheet.appendChild(action(copy.settings || "", () => {
      window.location.assign(settingsLink.href);
    }));
  }

  if (securityChip) {
    const securityNote = create("div", "assistant-mobile-security-note");
    securityNote.append(
      create("strong", "", copy.security || ""),
      create("small", "", securityChip.textContent.trim()),
    );
    sheet.appendChild(securityNote);
  }

  const chooseFile = (accept) => {
    if (!fileInput) return;
    closeAllOverlays();
    const original = fileInput.getAttribute("accept") || "";
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      fileInput.setAttribute("accept", original);
      fileInput.removeEventListener("change", restore);
    };
    const restoreAfterFocus = () => window.setTimeout(restore, 0);
    fileInput.setAttribute("accept", accept);
    fileInput.addEventListener("change", restore, { once: true });
    window.addEventListener("focus", restoreAfterFocus, { once: true });
    fileInput.click();
  };

  attachmentSheet.append(
    action(copy.image || "", () => chooseFile("image/jpeg,image/png,image/webp")),
    action(copy.audio || "", () => chooseFile("audio/*")),
    action(copy.video || "", () => chooseFile("video/mp4,video/webm")),
    action(copy.imageGeneration || "", () => {
      closeAllOverlays();
      app.querySelector("[data-image-generation-toggle]")?.click();
    }),
  );

  document.body.append(backdrop, sheet, attachmentSheet);

  const activate = () => {
    if (!mq.matches) return;
    const aiPanel = app.querySelector('[data-mode-panel="ai"]');
    if (!aiPanel?.classList.contains("is-active")) return;
    syncStandaloneClass();
    document.body.classList.add("assistant-ai-conversation-active");
    syncContextLabel();
    requestAnimationFrame(() => {
      if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 180) {
        messages.scrollTop = messages.scrollHeight;
      }
    });
  };

  const deactivate = () => {
    closeAllOverlays();
    document.body.classList.remove("assistant-ai-conversation-active");
    preview?.focus();
  };

  back.addEventListener("click", deactivate);
  more.addEventListener("click", () => {
    if (sheet.classList.contains("is-open")) closeAllOverlays();
    else openSheet(sheet);
  });
  backdrop.addEventListener("click", closeAllOverlays);
  contextClose?.addEventListener("click", () => queueMicrotask(() => backdrop.classList.remove("is-open")));
  preview?.addEventListener("click", activate);

  app.querySelectorAll("[data-mode-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      queueMicrotask(() => {
        if (tab.dataset.modeTab === "ai") activate();
        else deactivate();
      });
    });
  });

  contextType?.addEventListener("change", syncContextLabel);
  contextCountry?.addEventListener("change", syncContextLabel);
  contextSymbol?.addEventListener("input", syncContextLabel);
  app.querySelector("[data-context-form]")?.addEventListener("submit", () => {
    queueMicrotask(() => {
      syncContextLabel();
      backdrop.classList.remove("is-open");
    });
  });

  if (attachLabel && fileInput) {
    attachLabel.addEventListener("click", (event) => {
      if (!mq.matches || !document.body.classList.contains("assistant-ai-conversation-active")) return;
      if (event.target === fileInput) return;
      event.preventDefault();
      openSheet(attachmentSheet);
    }, true);
  }

  const onBreakpoint = () => {
    closeAllOverlays();
    syncStandaloneClass();
    if (!mq.matches) {
      document.body.classList.remove("assistant-ai-conversation-active");
      return;
    }
    const aiPanel = app.querySelector('[data-mode-panel="ai"]');
    if (aiPanel?.classList.contains("is-active")) activate();
  };

  mq.addEventListener?.("change", onBreakpoint);
  standaloneMq.addEventListener?.("change", syncStandaloneClass);
  window.addEventListener("orientationchange", () => requestAnimationFrame(onBreakpoint), { passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllOverlays();
  });

  syncStandaloneClass();
  syncContextLabel();
  requestAnimationFrame(onBreakpoint);
})();
