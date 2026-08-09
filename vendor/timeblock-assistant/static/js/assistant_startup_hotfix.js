(function () {
  "use strict";

  performance.mark?.("timeblock:assistant:start");

  const loaderScript = document.currentScript;
  const app = document.getElementById("assistant-app");
  const attachmentsEnabled = loaderScript?.dataset.messagingAdvancedAttachmentsEnabled === "true";
  const loadedScripts = new Map();
  const loadedStyles = new Map();
  let qrReady = false;
  let attachmentReady = false;
  let callWorkspaceReady = false;
  let capabilitySurfacesReady = false;

  function loadScriptOnce(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing?.dataset.loaded === "true") {
        resolve(existing);
        return;
      }
      const script = existing || document.createElement("script");
      script.src = src;
      script.defer = true;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve(script);
      }, { once: true });
      script.addEventListener("error", () => {
        loadedScripts.delete(src);
        reject(new Error(`Failed to load ${src}`));
      }, { once: true });
      if (!existing) document.head.appendChild(script);
    });
    loadedScripts.set(src, promise);
    return promise;
  }

  function loadStylesheetOnce(href) {
    if (loadedStyles.has(href)) return loadedStyles.get(href);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`link[href="${href}"]`);
      if (existing) {
        resolve(existing);
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.messagingComposerAttachmentsV2 = "true";
      link.addEventListener("load", () => resolve(link), { once: true });
      link.addEventListener("error", () => {
        loadedStyles.delete(href);
        reject(new Error(`Failed to load ${href}`));
      }, { once: true });
      document.head.appendChild(link);
    });
    loadedStyles.set(href, promise);
    return promise;
  }

  function setControlsLoading(selector, loading) {
    document.querySelectorAll(selector).forEach((control) => {
      control.toggleAttribute("aria-busy", loading);
      if ("disabled" in control) control.disabled = loading;
    });
  }

  async function ensureQrScannerLoaded() {
    if (qrReady) return;
    setControlsLoading("[data-qr-camera], [data-qr-file]", true);
    try {
      await loadScriptOnce("/static/vendor/jsqr/1.4.0/jsQR.min.js");
      await loadScriptOnce("/static/js/qr_friend_scanner.js?v=startup-20260730b");
      qrReady = true;
    } finally {
      setControlsLoading("[data-qr-camera], [data-qr-file]", false);
    }
  }

  async function ensureAttachmentComposerLoaded() {
    if (!attachmentsEnabled || attachmentReady) return;
    setControlsLoading("[data-message-file]", true);
    try {
      await loadStylesheetOnce("/static/css/messaging_composer_attachments_v2.css?v=startup-20260730b");
      await loadScriptOnce("/static/js/messaging_composer_attachments_v2.js?v=startup-20260730b");
      attachmentReady = true;
    } finally {
      setControlsLoading("[data-message-file]", false);
    }
  }

  async function ensureCallWorkspaceLoaded() {
    if (callWorkspaceReady) return;
    await loadScriptOnce("/static/js/call_answer_bootstrap.js?v=phase3-20260807");
    callWorkspaceReady = true;
  }

  async function ensureCapabilitySurfacesLoaded() {
    if (capabilitySurfacesReady) return;
    await loadScriptOnce("/static/js/messaging_capability_surfaces_v2.js?v=phase3b2-translation-20260809");
    capabilitySurfacesReady = true;
  }

  function reportLoadFailure(error) {
    console.error("Timeblock lazy module load failed", error);
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-qr-scan]")) {
      ensureQrScannerLoaded().catch(reportLoadFailure);
      return;
    }

    if (target.closest('[data-mode-tab="messages"]') && attachmentsEnabled) {
      ensureAttachmentComposerLoaded().catch(reportLoadFailure);
      return;
    }

    if (target.closest('[data-communication-tab="ptt"]')) {
      ensureCapabilitySurfacesLoaded().catch(reportLoadFailure);
    }

    if (target.closest("[data-call-start], [data-call-answer], [data-call-interpreter-toggle]")) {
      ensureCallWorkspaceLoaded().catch(reportLoadFailure);
      return;
    }

    const attachmentInput = target.closest("[data-message-file]");
    if (attachmentInput && attachmentsEnabled && !attachmentReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ensureAttachmentComposerLoaded().catch(reportLoadFailure);
    }
  }, true);

  app?.addEventListener("timeblock:messaging:conversation", () => {
    if (attachmentsEnabled) ensureAttachmentComposerLoaded().catch(reportLoadFailure);
    ensureCapabilitySurfacesLoaded().catch(reportLoadFailure);
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (app?.dataset.initialMode === "messages" && attachmentsEnabled) {
      ensureAttachmentComposerLoaded().catch(reportLoadFailure);
    }
    const url = new URL(window.location.href);
    let pendingCallAnswer = url.searchParams.get("answer") === "1";
    if (!pendingCallAnswer) {
      try {
        const stored = JSON.parse(window.sessionStorage.getItem("timeblock.pending-call-answer") || "null");
        pendingCallAnswer = Boolean(stored && Date.now() - Number(stored.created_at || 0) < 120000);
      } catch (_error) {
        pendingCallAnswer = false;
      }
    }
    if (pendingCallAnswer) ensureCallWorkspaceLoaded().catch(reportLoadFailure);
    performance.mark?.("timeblock:assistant:dom-ready");
    try {
      performance.measure?.("assistant_bootstrap", "timeblock:assistant:start", "timeblock:assistant:dom-ready");
    } catch (_error) {
      // Performance marks are optional in older browsers.
    }
  }, { once: true });
}());
