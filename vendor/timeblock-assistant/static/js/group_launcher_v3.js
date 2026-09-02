(function groupLauncherV3(window, document) {
  "use strict";

  const root = document.querySelector("[data-group-launcher-v3]");
  if (!root) return;

  const buttons = Array.from(root.querySelectorAll("[data-group-launch]"));
  const status = root.querySelector("[data-group-launcher-status]");
  const surfaces = new Set(["chat", "call", "video", "radio"]);
  const contract = Object.freeze({
    version: "3",
    event: "timeblock.group.handoff.v3",
    transport: "postmessage-memory",
  });

  const setState = (state, message) => {
    root.dataset.state = state;
    if (status) status.textContent = message || "";
  };

  const setBusy = (busy) => {
    buttons.forEach((button) => { button.disabled = busy; });
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
      if (parsed.searchParams.has("handoff_code") || parsed.hash.includes("handoff_code")) return "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  };

  const validHandoff = (payload, surface) => {
    if (!payload || typeof payload !== "object") return null;
    if (String(payload.contract_version || "") !== contract.version) return null;
    if (payload.event !== contract.event || payload.transport !== contract.transport) return null;
    if (String(payload.surface || "").toLowerCase() !== surface) return null;
    const targetOrigin = validOrigin(payload.target_origin);
    const targetUrl = validTargetUrl(payload.target_url, targetOrigin);
    const expiresAt = String(payload.expires_at || "");
    const expiry = Date.parse(expiresAt);
    const handoffCode = String(payload.handoff_code || "");
    if (!targetOrigin || !targetUrl || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
    if (handoffCode.length < 48 || handoffCode.length > 256 || /\s/.test(handoffCode)) return null;
    return { targetOrigin, targetUrl, expiresAt, handoffCode };
  };

  const launch = async (surface) => {
    if (!surfaces.has(surface)) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setState("error", root.dataset.popupBlocked);
      return;
    }

    setBusy(true);
    setState("launching", root.dataset.launching);
    let oneTimeCode = "";
    let targetOrigin = "";
    let timeoutId = 0;

    const cleanup = () => {
      oneTimeCode = "";
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("message", onReady);
      setBusy(false);
    };

    const fail = () => {
      cleanup();
      setState("error", root.dataset.error);
      try { popup.close(); } catch (_error) { /* no-op */ }
    };

    const onReady = (event) => {
      const message = event.data;
      if (event.source !== popup || event.origin !== targetOrigin) return;
      if (!message || typeof message !== "object") return;
      if (message.type !== `${contract.event}.ready`) return;
      if (String(message.contract_version || "") !== contract.version) return;
      if (String(message.surface || "").toLowerCase() !== surface) return;
      if (!oneTimeCode) return;

      popup.postMessage({
        type: contract.event,
        contract_version: contract.version,
        handoff_code: oneTimeCode,
        surface,
        expires_at: pending.expiresAt,
      }, targetOrigin);
      cleanup();
      setState("ready", root.dataset.ready);
    };

    let pending = null;
    try {
      const response = await window.fetch("/api/communication/group/handoffs", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ surface, locale: locale() }),
      });
      const payload = await response.json().catch(() => ({}));
      pending = response.ok ? validHandoff(payload, surface) : null;
      if (!pending) throw new Error("invalid_group_handoff");

      oneTimeCode = pending.handoffCode;
      pending.handoffCode = "";
      targetOrigin = pending.targetOrigin;
      window.addEventListener("message", onReady);
      timeoutId = window.setTimeout(fail, 20000);
      popup.location.replace(pending.targetUrl);
    } catch (_error) {
      fail();
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      void launch(String(button.dataset.groupLaunch || "").toLowerCase());
    });
  });
}(window, document));
