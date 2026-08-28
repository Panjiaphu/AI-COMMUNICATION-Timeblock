(function installGroupTranslationClient(window) {
  "use strict";

  const LANGUAGES = new Set(["vi", "zh-TW", "en"]);
  const ROOM_PREFIX = "group-call:";

  const text = (value, maximum = 4096) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : "";
  };

  class GroupTranslationSidecar {
    constructor({ manager, track, speakerId, roomId, generation, sourceLanguage, targetLanguage }) {
      this.manager = manager;
      this.track = track;
      this.speakerId = text(speakerId, 160);
      this.roomId = text(roomId, 160).replace(ROOM_PREFIX, "");
      this.generation = text(generation, 128);
      this.sourceLanguage = text(sourceLanguage, 16);
      this.targetLanguage = text(targetLanguage, 16);
      this.pc = null;
      this.events = null;
      this.clonedTrack = null;
      this.audio = null;
      this.inputText = "";
      this.outputText = "";
      this.segmentId = "segment-" + Math.random().toString(36).slice(2, 12);
      this.closed = false;
      this.persisted = false;
    }

    async start() {
      if (this.closed || !this.track || !LANGUAGES.has(this.sourceLanguage) || !LANGUAGES.has(this.targetLanguage) || this.sourceLanguage === this.targetLanguage) return;
      if (!this.speakerId.match(/^(member|business):/)) return;
      const sessionResponse = await fetch("/api/group-translation/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: this.roomId,
          generation: this.generation,
          source_language: this.sourceLanguage,
          target_language: this.targetLanguage,
        }),
      });
      const payload = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || !text(payload?.client_secret)) throw new Error(payload?.detail || "group_translation_session_unavailable");
      const clientSecret = text(payload.client_secret, 4096);
      this.clonedTrack = typeof this.track.clone === "function" ? this.track.clone() : this.track;
      this.pc = new RTCPeerConnection();
      this.pc.ontrack = ({ streams }) => {
        const stream = streams?.[0];
        if (!stream || this.closed) return;
        if (!this.audio) {
          this.audio = document.createElement("audio");
          this.audio.autoplay = true;
          this.audio.playsInline = true;
          this.audio.dataset.groupTranslationAudio = this.targetLanguage;
          this.manager.audioHost?.appendChild(this.audio);
        }
        this.audio.srcObject = stream;
        void this.audio.play().catch(() => {});
      };
      this.events = this.pc.createDataChannel("oai-events");
      this.events.onmessage = ({ data }) => this.handleProviderEvent(data);
      this.events.onerror = () => this.manager.onState?.("UNAVAILABLE");
      this.pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(String(this.pc?.connectionState || "")) && !this.closed) this.manager.onState?.("UNAVAILABLE");
      };
      this.pc.addTrack(this.clonedTrack, new MediaStream([this.clonedTrack]));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp", Accept: "application/sdp" },
        body: String(offer?.sdp || ""),
      });
      if (!sdpResponse.ok) throw new Error("group_translation_sdp_failed");
      await this.pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      this.manager.onState?.("STREAMING");
    }

    handleProviderEvent(raw) {
      let event;
      try { event = JSON.parse(raw); } catch (_error) { return; }
      if (event.type === "session.input_transcript.delta") {
        this.inputText += text(event.delta, 1024);
        this.manager.onPartial?.(this.inputText, this.outputText);
      } else if (event.type === "session.output_transcript.delta") {
        this.outputText += text(event.delta, 1024);
        this.manager.onPartial?.(this.inputText, this.outputText);
      } else if (event.type === "session.output_transcript.done") {
        const completed = text(event.transcript || this.outputText);
        if (completed) {
          this.outputText = completed;
          void this.persistFinal();
        }
      } else if (event.type === "error") {
        this.manager.onState?.("UNAVAILABLE");
      }
    }

    async persistFinal() {
      if (this.persisted || this.closed || !this.inputText || !this.outputText) return;
      this.persisted = true;
      const response = await fetch("/api/group-translation/events", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: this.roomId,
          event: {
            segment_id: this.segmentId,
            generation: this.generation,
            speaker_id: this.speakerId,
            source_language: this.sourceLanguage,
            target_language: this.targetLanguage,
            state: "final",
            original_text: this.inputText,
            translated_text: this.outputText,
            translation_status: "final",
          },
        }),
      }).catch(() => null);
      if (!response?.ok) this.persisted = false;
      else this.manager.onFinal?.(this.inputText, this.outputText);
    }

    async stop() {
      if (this.closed) return;
      this.closed = true;
      try { if (this.events?.readyState === "open") this.events.send(JSON.stringify({ type: "session.close" })); } catch (_error) {}
      try { this.events?.close?.(); } catch (_error) {}
      try { this.pc?.close?.(); } catch (_error) {}
      if (this.clonedTrack && this.clonedTrack !== this.track) this.clonedTrack.stop?.();
      this.audio?.remove();
      this.audio = null;
    }
  }

  class GroupTranslationManager {
    constructor({ panel, copy, onState, onPartial, onFinal }) {
      this.panel = panel;
      this.copy = copy || {};
      this.onState = onState;
      this.onPartial = onPartial;
      this.onFinal = onFinal;
      this.audioHost = panel?.querySelector("[data-group-translation-audio-host]") || panel;
      this.sidecars = new Map();
      this.enabled = false;
      this.handoff = null;
    }

    setContext(handoff) { this.handoff = handoff || null; }

    targetLanguage() {
      const profile = this.handoff?.language_profile || {};
      const source = text(this.handoff?.source_language || profile.spoken_language, 16) || "vi";
      const target = text(profile.preferred_output_language || this.handoff?.target_language, 16);
      return { source, target };
    }

    async enable(tracks) {
      this.enabled = true;
      this.onState?.("STARTING");
      await Promise.all([...tracks].map((track) => this.startForTrack(track)));
    }

    async startForTrack(track, participantId = "") {
      if (!this.enabled || !this.handoff || !track) return;
      const key = text(track.sid || track.mediaStreamTrack?.id || Math.random().toString(36), 160);
      if (this.sidecars.has(key)) return;
      const { source, target } = this.targetLanguage();
      const sidecar = new GroupTranslationSidecar({
        manager: this,
        track: track.mediaStreamTrack || track,
        speakerId: participantId || track.participant?.identity,
        roomId: this.handoff.room_id,
        generation: this.handoff.generation,
        sourceLanguage: source,
        targetLanguage: target,
      });
      this.sidecars.set(key, sidecar);
      try { await sidecar.start(); } catch (_error) { this.sidecars.delete(key); await sidecar.stop(); this.onState?.("UNAVAILABLE"); }
    }

    removeTrack(track) {
      const key = text(track?.sid || track?.mediaStreamTrack?.id, 160);
      const sidecar = this.sidecars.get(key);
      if (!sidecar) return;
      this.sidecars.delete(key);
      void sidecar.stop();
    }

    async stop() {
      this.enabled = false;
      const sidecars = [...this.sidecars.values()];
      this.sidecars.clear();
      await Promise.all(sidecars.map((sidecar) => sidecar.stop()));
      this.onState?.("IDLE");
    }
  }

  window.GroupTranslationClient = Object.freeze({
    create: (options) => new GroupTranslationManager(options),
  });
}(window));
