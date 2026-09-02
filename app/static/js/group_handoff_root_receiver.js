(function groupHandoffRootReceiver(window, document) {
  "use strict";

  const configNode = document.getElementById("guilua-group-handoff-root-config");
  if (!configNode || !window.opener || window.opener.closed) return;

  let runtimeConfig = {};
  try {
    runtimeConfig = JSON.parse(configNode.textContent || "{}");
  } catch (_error) {
    return;
  }

  const eventName = runtimeConfig.group_handoff_event || "timeblock.group.handoff.v3";
  const expectedVersion = String(runtimeConfig.group_handoff_contract_version || "3");
  const allowedOrigins = new Set(
    Array.isArray(runtimeConfig.allowed_handoff_origins)
      ? runtimeConfig.allowed_handoff_origins.map((origin) => String(origin || "").replace(/\/$/, ""))
      : [],
  );
  const state = { status: "WAITING", consumed: false };

  const text = (value, maximum = 256) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : "";
  };

  const setState = (value) => {
    state.status = value;
    document.documentElement.dataset.groupHandoffState = value;
  };

  const trustedSource = (event) => {
    const origin = String(event.origin || "").replace(/\/$/, "");
    return allowedOrigins.has(origin) && event.source === window.opener;
  };

  const validEnvelope = (message) => {
    if (!message || typeof message !== "object" || message.type !== eventName) return false;
    if (String(message.contract_version || "") !== expectedVersion) return false;
    if (message.transport !== "postmessage-memory") return false;
    const code = text(message.handoff_code, 256);
    const expiry = Date.parse(text(message.expires_at, 64));
    return code.length >= 48 && !/\s/.test(code)
      && Number.isFinite(expiry) && expiry > Date.now();
  };

  const redeem = async (message, sourceOrigin) => {
    if (state.consumed || state.status === "REDEEMING") return;
    state.consumed = true;
    setState("REDEEMING");
    let handoffCode = text(message.handoff_code, 256);
    try {
      const response = await window.fetch("/api/group-handoff/v3/consume", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ handoff_code: handoffCode, source_origin: sourceOrigin }),
      });
      handoffCode = "";
      if (!response.ok) throw new Error("group_handoff_redeem_failed");
      const payload = await response.json().catch(() => ({}));
      if (payload.contract_version !== "3" || payload.authority !== "ai-communication") {
        throw new Error("invalid_group_handoff_response");
      }
      setState("READY");
      // The Group capability and its runtime are AI-owned. The generic root
      // receiver only establishes the server session, then enters the AI app's
      // normal Group route without forwarding a capability selector.
      window.location.replace("/group");
    } catch (_error) {
      handoffCode = "";
      setState("FAILED");
    }
  };

  window.addEventListener("message", (event) => {
    if (!trustedSource(event) || !validEnvelope(event.data)) return;
    void redeem(event.data, String(event.origin || "").replace(/\/$/, ""));
  });

  allowedOrigins.forEach((origin) => {
    window.opener.postMessage({
      type: `${eventName}.ready`,
      contract_version: expectedVersion,
      transport: "postmessage-memory",
    }, origin);
  });

  window.GroupHandoffRootReceiver = Object.freeze({
    getState: () => ({ status: state.status }),
  });
}(window, document));
