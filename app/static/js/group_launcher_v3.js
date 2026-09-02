(function groupLauncherV3(window, document) {
  "use strict";

  const root = document.querySelector("[data-group-launcher-v3]");
  if (!root) return;

  const buttons = Array.from(root.querySelectorAll("[data-group-launch]"));
  const status = root.querySelector("[data-group-launcher-status]");
  const contract = Object.freeze({
    version: "3",
    event: "timeblock.group.handoff.v3",
    transport: "postmessage-memory",
  });
  const HANDOFF_TIMEOUT_MS = 20000;
  const POPUP_POLL_MS = 250;
  let active = false;

  const message = (key, fallback) => root.dataset[key] || fallback;

  const setState = (state, copy, reason) => {
    root.dataset.state = state;
    if (reason) root.dataset.errorKind = reason;
    else delete root.dataset.errorKind;
    if (status) status.textContent = copy || "";
  };

  const setBusy = (busy) => {
    buttons.forEach((button) => {
      button.disabled = busy;
      button.setAttribute("aria-busy", String(busy));
    });
    root.setAttribute("aria-busy", String(busy));
  };

  const locale = () => {
    const value = String(document.documentElement.lang || "vi").trim();
    if (value.toLowerCase() === "zh-tw") return "zh-TW";
    return value.toLowerCase() === "en" ? "en" : "vi";
  };

  const validOrigin = (value) => {
    try {
      const parsed = new URL(String(value || ""));
      const loopback = parsed.hostname === "localhost"
        || parsed.hostname === "127.0.0.1"
        || parsed.hostname === "[::1]";
      return parsed.protocol === "https:" || parsed.protocol === "http:" && loopback
        ? parsed.origin
        : "";
    } catch (_error) {
      return "";
    }
  };

  const validTargetUrl = (value, targetOrigin) => {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.origin !== targetOrigin || parsed.username || parsed.password) return "";
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  };

  const validHandoff = (payload) => {
    if (!payload || typeof payload !== "object") return null;
    if (String(payload.contract_version || "") !== contract.version) return null;
    if (payload.event !== contract.event || payload.transport !== contract.transport) return null;
    const targetOrigin = validOrigin(payload.target_origin);
    const targetUrl = validTargetUrl(payload.target_url, targetOrigin);
    const expiresAt = String(payload.expires_at || "");
    const expiry = Date.parse(expiresAt);
    const handoffCode = String(payload.handoff_code || "");
    if (!targetOrigin || !targetUrl || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
    if (handoffCode.length < 48 || handoffCode.length > 256 || /\s/.test(handoffCode)) return null;
    return { targetOrigin, targetUrl, expiresAt, handoffCode };
  };

  const launch = async () => {
    if (active) return;

    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setState("error", message("popupBlocked", "Allow pop-ups and try again."), "popup-blocked");
      return;
    }

    active = true;
    setBusy(true);
    setState("launching", message("launching", "Opening group communication app…"));
    let oneTimeCode = "";
    let targetOrigin = "";
    let pending = null;
    let timeoutId = 0;
    let popupPollId = 0;
    let finished = false;

    const cleanup = () => {
      oneTimeCode = "";
      pending = null;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (popupPollId) window.clearInterval(popupPollId);
      window.removeEventListener("message", onReady);
      setBusy(false);
      active = false;
    };

    const fail = (copy, reason) => {
      if (finished) return;
      finished = true;
      cleanup();
      setState("error", copy || message("handoffFailed", "The secure handoff could not be completed. Please try again."), reason || "handoff-failed");
      try { popup.close(); } catch (_error) { /* no-op */ }
    };

    const onReady = (event) => {
      const readyMessage = event.data;
      if (event.source !== popup || event.origin !== targetOrigin) return;
      if (!readyMessage || typeof readyMessage !== "object") return;
      if (readyMessage.type !== `${contract.event}.ready`) return;
      if (String(readyMessage.contract_version || "") !== contract.version) return;
      if (!oneTimeCode || !pending) return;

      try {
        popup.postMessage({
          type: contract.event,
          contract_version: contract.version,
          handoff_code: oneTimeCode,
          expires_at: pending.expiresAt,
        }, targetOrigin);
      } catch (_error) {
        fail(null, "handoff-failed");
        return;
      }
      finished = true;
      cleanup();
      setState("ready", message("ready", "AI-COMMUNICATION is ready."));
    };

    try {
      const response = await window.fetch("/api/communication/group/handoffs", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ locale: locale() }),
      });
      const payload = await response.json().catch(() => ({}));
      const handoff = response.ok ? validHandoff(payload) : null;
      if (!handoff) throw new Error("invalid_group_handoff");

      oneTimeCode = handoff.handoffCode;
      targetOrigin = handoff.targetOrigin;
      pending = { targetUrl: handoff.targetUrl, expiresAt: handoff.expiresAt };
      window.addEventListener("message", onReady);
      timeoutId = window.setTimeout(() => {
        fail(message("timeout", "The secure handoff timed out. Please try again."), "timeout");
      }, HANDOFF_TIMEOUT_MS);
      popupPollId = window.setInterval(() => {
        if (popup.closed) fail(message("handoffFailed", "The secure handoff could not be completed. Please try again."), "popup-closed");
      }, POPUP_POLL_MS);
      popup.location.replace(pending.targetUrl);
    } catch (_error) {
      fail(message("handoffFailed", "The secure handoff could not be completed. Please try again."), "handoff-failed");
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => { void launch(); });
  });
}(window, document));
