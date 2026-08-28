(function installGroupRadioTranslation(window) {
  "use strict";

  const safe = (value, max = 128) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= max ? normalized : "";
  };

  class GroupRadioTranslation {
    constructor({ sessionId, generation, consentVersion, onState } = {}) {
      this.sessionId = safe(sessionId);
      this.generation = safe(generation);
      this.consentVersion = safe(consentVersion);
      this.onState = onState;
      this.reservationId = "";
      this.disposed = false;
    }

    async bootstrap({ sourceLanguage, targetLanguage, speakerId, estimatedSourceSeconds = 30 } = {}) {
      if (this.disposed || !this.sessionId) throw new Error("radio_translation_session_required");
      const response = await fetch("/api/group-translation/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: `group-radio:${this.sessionId}`,
          generation: this.generation,
          consent_version: this.consentVersion,
          source_language: safe(sourceLanguage, 16),
          target_language: safe(targetLanguage, 16),
          speaker_id: safe(speakerId, 160),
          estimated_source_seconds: Math.min(30, Math.max(1, Number(estimatedSourceSeconds) || 30)),
          reservation_key: `${this.sessionId}:${this.generation}:${safe(targetLanguage, 16)}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "radio_translation_bootstrap_failed");
      this.reservationId = safe(payload.translation?.quota_reservation_id, 128);
      this.onState?.("READY", payload.translation);
      return payload;
    }

    async publish(event) {
      if (this.disposed || !this.sessionId || !event || typeof event !== "object") return false;
      // Browser never sends audio/raw media to the control plane.
      const { audio, audio_base64, raw_media, media, ...safeEvent } = event;
      const response = await fetch("/api/group-translation/events", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: `group-radio:${this.sessionId}`, event: safeEvent }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "radio_translation_event_failed");
      if (safeEvent.state === "partial") this.onState?.("PARTIAL", payload);
      else this.onState?.("FINAL", payload);
      return payload;
    }

    enqueueRecipientAudio({ id, text, language, audio, state = "final", translationStatus = "final" } = {}) {
      if (!["final", "corrected"].includes(state) || translationStatus !== "final") return false;
      if (!audio || !window.GroupTranslationTTSQueue) return false;
      if (!this.ttsQueue) this.ttsQueue = window.GroupTranslationTTSQueue.create({ onState: this.onState });
      return this.ttsQueue.enqueue({ id: safe(id, 256), text: safe(text, 4096), language: safe(language, 16), audio });
    }

    async release() {
      if (!this.reservationId) return;
      await fetch("/api/group-translation/usage/release", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: `group-radio:${this.sessionId}`, quota_reservation_id: this.reservationId }),
      }).catch(() => {});
      this.reservationId = "";
    }

    async searchHistory({ q = "", targetLanguage, speakerId, state, limit = 50, beforeId } = {}) {
      if (this.disposed || !this.sessionId) return { items: [] };
      const params = new URLSearchParams({ q: safe(q, 200), limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
      if (targetLanguage) params.set("target_language", safe(targetLanguage, 16));
      if (speakerId) params.set("speaker_id", safe(speakerId, 160));
      if (state) params.set("state", safe(state, 16));
      if (beforeId) params.set("before_id", String(beforeId));
      const response = await fetch(`/api/group-radio/history/search/${encodeURIComponent(this.sessionId)}?${params}`, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "radio_history_search_failed");
      return payload;
    }

    dispose() {
      if (this.disposed) return;
      void this.release();
      this.disposed = true;
      this.ttsQueue?.dispose();
      this.ttsQueue = null;
    }
  }

  window.GroupRadioTranslation = Object.freeze({ create: (options) => new GroupRadioTranslation(options) });
}(window));
