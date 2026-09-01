(function groupHandoffV3Bridge(window) {
  "use strict";

  const root = document.querySelector("[data-group-ui]");
  let runtimeConfig = {};
  try {
    runtimeConfig = JSON.parse(document.getElementById("guilua-runtime-config")?.textContent || "{}");
  } catch (_error) {
    runtimeConfig = {};
  }

  const eventName = runtimeConfig.group_handoff_event || "timeblock.group.handoff.v3";
  const expectedVersion = String(runtimeConfig.group_handoff_contract_version || "3");
  const allowedOrigins = new Set(runtimeConfig.allowed_handoff_origins || []);
  const surfaces = new Set(["chat", "call", "video", "radio", "plugin"]);
  const state = { status: "WAITING", handoff: null };

  const setStatus = (status) => {
    state.status = status;
    if (root) root.dataset.handoffState = status;
  };
  setStatus(state.status);

  const text = (value, maximum = 256) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : "";
  };

  const trustedSource = (event) => {
    const origin = String(event.origin || "").replace(/\/$/, "");
    if (!allowedOrigins.has(origin)) return false;
    const sources = [window.opener, window.parent !== window ? window.parent : null].filter(Boolean);
    return sources.includes(event.source);
  };

  const validEnvelope = (message) => {
    if (!message || typeof message !== "object" || message.type !== eventName) return false;
    if (String(message.contract_version || "") !== expectedVersion) return false;
    const code = text(message.handoff_code, 256);
    const surface = text(message.surface, 16).toLowerCase();
    const expiry = Date.parse(text(message.expires_at, 64));
    return code.length >= 48 && !/\s/.test(code) && surfaces.has(surface)
      && Number.isFinite(expiry) && expiry > Date.now();
  };

  const apply = (payload) => {
    if (!payload || payload.contract_version !== "3" || payload.authority !== "ai-communication") {
      setStatus("INVALID");
      return false;
    }
    state.handoff = Object.freeze({
      handoff_id: text(payload.handoff_id, 128),
      generation: text(payload.handoff_id, 128),
      surface: text(payload.surface, 16),
      principal: payload.principal && typeof payload.principal === "object" ? { ...payload.principal } : {},
      entitlement: payload.entitlement && typeof payload.entitlement === "object" ? { ...payload.entitlement } : {},
      scope: Array.isArray(payload.scope) ? [...payload.scope] : [],
      session_expires_at: text(payload.session_expires_at, 64),
    });
    setStatus("READY");
    window.dispatchEvent(new CustomEvent("group:handoff-ready", {
      detail: {
        handoff_id: state.handoff.handoff_id,
        generation: state.handoff.generation,
        surface: state.handoff.surface,
        principal: { ...state.handoff.principal },
      },
    }));
    return true;
  };

  const redeem = async (message, sourceOrigin) => {
    setStatus("REDEEMING");
    let handoffCode = text(message.handoff_code, 256);
    try {
      const response = await window.fetch("/api/group-handoff/v3/consume", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          handoff_code: handoffCode,
          source_origin: sourceOrigin,
          surface: text(message.surface, 16).toLowerCase(),
        }),
      });
      handoffCode = "";
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !apply(payload)) throw new Error("handoff_redeem_failed");
    } catch (_error) {
      handoffCode = "";
      state.handoff = null;
      setStatus("FAILED");
    }
  };

  window.addEventListener("message", (event) => {
    if (!trustedSource(event) || !validEnvelope(event.data)) return;
    const sourceOrigin = String(event.origin || "").replace(/\/$/, "");
    void redeem(event.data, sourceOrigin);
  });

  const announceReady = () => {
    if (!window.opener || window.opener.closed) return;
    const surface = text(runtimeConfig.initial_surface, 16).toLowerCase();
    if (!surfaces.has(surface)) return;
    allowedOrigins.forEach((origin) => {
      window.opener.postMessage({
        type: `${eventName}.ready`,
        contract_version: expectedVersion,
        surface,
      }, origin);
    });
  };
  announceReady();

  window.GroupCommunicationHandoff = Object.freeze({
    getState: () => ({
      status: state.status,
      handoff_id: state.handoff?.handoff_id || "",
      generation: state.handoff?.generation || "",
      surface: state.handoff?.surface || "",
      principal: state.handoff?.principal ? { ...state.handoff.principal } : {},
    }),
    consume: () => {
      const handoff = state.handoff;
      state.handoff = null;
      if (handoff) setStatus("CONSUMED");
      return handoff;
    },
  });
}(window));
