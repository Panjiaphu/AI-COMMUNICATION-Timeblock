(function groupHandoffBridge(window) {
  "use strict";

  const root = document.querySelector("[data-group-ui]");
  const setRootHandoffState = (status) => {
    if (root) root.dataset.handoffState = status;
  };

  let runtimeConfig = {};
  try {
    runtimeConfig = JSON.parse(document.getElementById("guilua-runtime-config")?.textContent || "{}");
  } catch (_error) {
    runtimeConfig = {};
  }
  const eventName = runtimeConfig.group_handoff_event || "timeblock.group.communication.handoff.v2";
  const allowedOrigins = new Set(runtimeConfig.allowed_handoff_origins || []);
  const expectedVersion = String(runtimeConfig.group_handoff_contract_version || "2");
  const state = { status: "WAITING", handoff: null };
  setRootHandoffState(state.status);

  const text = (value, maximum = 4096) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : "";
  };
  const validPayload = (payload) => {
    if (!payload || typeof payload !== "object") return false;
    if (text(payload.contract_version) !== expectedVersion || text(payload.authority) !== "timeblock") return false;
    if (text(payload.handoff_type) !== "group") return false;
    if (!["group_call", "group_video"].includes(text(payload.surface))) return false;
    if (!["audio", "video"].includes(text(payload.mode))) return false;
    if (text(payload.surface) === "group_video" && text(payload.mode) !== "video") return false;
    if (text(payload.surface) === "group_call" && text(payload.mode) !== "audio") return false;
    if (!text(payload.handoff_id, 128) || !text(payload.generation, 128)) return false;
    if (!text(payload.session_id, 128).startsWith("group:")) return false;
    if (!text(payload.room_id, 160).startsWith("group-call:")) return false;
    if (!text(payload.participant_id, 128).match(/^(member|business):/)) return false;
    if (!text(payload.workspace_id, 160).startsWith("conversation:")) return false;
    if (!text(payload.session_token, 4096) || !text(payload.audience, 128) || !text(payload.issuer, 128)) return false;
    if (!text(payload.websocket_url, 4096).match(/^wss?:\/\//)) return false;
    if (text(payload.websocket_url, 4096).includes(text(payload.session_token, 4096))) return false;
    const expiry = Date.parse(text(payload.expires_at, 128));
    return Number.isFinite(expiry) && expiry > Date.now();
  };
  const trustedSource = (event) => {
    const origin = String(event.origin || "").replace(/\/$/, "");
    if (!allowedOrigins.has(origin)) return false;
    const sources = [window.opener, window.parent !== window ? window.parent : null].filter(Boolean);
    return sources.includes(event.source);
  };

  const apply = (payload) => {
    if (!validPayload(payload)) {
      state.status = "INVALID";
      setRootHandoffState(state.status);
      return false;
    }
    state.handoff = { ...payload };
    state.status = "READY";
    setRootHandoffState(state.status);
    window.dispatchEvent(new CustomEvent("group:handoff-ready", {
      detail: {
        handoff_id: payload.handoff_id,
        generation: payload.generation,
        surface: payload.surface,
        session_id: payload.session_id,
        room_id: payload.room_id,
      },
    }));
    return true;
  };

  window.addEventListener("message", (event) => {
    if (!trustedSource(event)) return;
    const message = event.data;
    if (!message || typeof message !== "object" || message.type !== eventName) return;
    apply(message.payload);
  });

  window.GroupCommunicationHandoff = Object.freeze({
    getState: () => ({
      status: state.status,
      handoff_id: state.handoff?.handoff_id || "",
      generation: state.handoff?.generation || "",
      surface: state.handoff?.surface || "",
      session_id: state.handoff?.session_id || "",
      room_id: state.handoff?.room_id || "",
    }),
    consume: () => {
      const handoff = state.handoff;
      state.handoff = null;
      state.status = handoff ? "CONSUMED" : state.status;
      setRootHandoffState(state.status);
      return handoff;
    },
  });
}(window));
