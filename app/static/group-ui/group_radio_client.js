(function installGroupRadioClient(window) {
  "use strict";

  const safe = (value, max = 160) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= max ? normalized : "";
  };

  class GroupRadioClient {
    constructor({ onState, onMediaSession } = {}) {
      this.onState = onState;
      this.onMediaSession = onMediaSession;
      this.sessionId = "";
      this.participantId = "";
      this.leaseId = "";
      this.generation = "";
      this.disposed = false;
      this.ledger = null;
      this.heartbeatTimer = null;
    }

    setContext(handoff) {
      this.sessionId = safe(handoff?.radio_session_id || handoff?.session_id, 128).replace(/^group:/, "");
      this.participantId = safe(handoff?.participant_id, 160);
      this.generation = safe(handoff?.generation, 128);
      this.ledger = window.GroupRadioResourceLedger?.create(this.generation) || null;
      return Boolean(this.sessionId && this.participantId);
    }

    async start({ conversationId } = {}) {
      if (this.disposed) return false;
      if (this.leaseId) return { floor: { lease_id: this.leaseId, state: "TALKING" } };
      if (!this.sessionId && conversationId != null) {
        const response = await fetch("/api/group-radio/sessions", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: Number(conversationId) }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || "radio_session_start_failed");
        this.sessionId = safe(payload.radio_session?.id, 128);
      }
      if (!this.sessionId || !this.participantId) throw new Error("radio_handoff_required");
      const joined = await fetch(`/api/group-radio/sessions/${encodeURIComponent(this.sessionId)}/join`, { method: "POST", credentials: "same-origin" });
      if (!joined.ok) throw new Error("radio_join_failed");
      const mediaResponse = await fetch(`/api/group-radio/sessions/${encodeURIComponent(this.sessionId)}/media`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media: "audio" }),
      });
      const mediaPayload = await mediaResponse.json().catch(() => ({}));
      if (!mediaResponse.ok) throw new Error(mediaPayload.detail || "radio_media_session_failed");
      this.onMediaSession?.(mediaPayload.session || null);
      const response = await fetch("/api/group-radio/floor/acquire", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId, participant_id: this.participantId, generation: this.generation }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "radio_floor_acquire_failed");
      this.leaseId = safe(payload.floor?.lease_id, 128);
      this.ledger?.register("floor", this.leaseId);
      this.heartbeatTimer = window.setInterval(() => { void this.heartbeat(); }, 5000);
      this.ledger?.register("timers", `heartbeat:${this.leaseId}`);
      this.onState?.("TALKING", payload);
      return payload;
    }

    async heartbeat() {
      if (!this.sessionId || !this.leaseId || this.disposed) return false;
      const response = await fetch("/api/group-radio/floor/heartbeat", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId, lease_id: this.leaseId }),
      });
      if (!response.ok) this.onState?.("DEVICE_LOST");
      return response.ok;
    }

    async stop() {
      if (!this.leaseId || !this.sessionId) return false;
      const response = await fetch("/api/group-radio/floor/finalize", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId, lease_id: this.leaseId }),
      });
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      const payload = await response.json().catch(() => ({}));
      this.leaseId = "";
      this.ledger?.terminate();
      this.onState?.("FINALIZING_BURST", payload);
      return response.ok;
    }

    async leave() {
      await this.stop();
      if (!this.sessionId) return false;
      const response = await fetch(`/api/group-radio/sessions/${encodeURIComponent(this.sessionId)}/leave`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: this.participantId }),
      });
      this.onState?.("ENDED");
      return response.ok;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      void this.stop();
      this.ledger?.terminate();
    }
  }

  window.GroupRadioClient = Object.freeze({ create: (options) => new GroupRadioClient(options) });
}(window));
