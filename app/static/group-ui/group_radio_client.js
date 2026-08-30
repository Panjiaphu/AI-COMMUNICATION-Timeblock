(function installGroupRadioClient(window) {
  "use strict";

  const safe = (value, max = 160) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= max ? normalized : "";
  };

  class GroupRadioClient {
    constructor({ onState, onMediaSession, onRemoteTrack, onRemoteTrackRemoved, onParticipants, audioHost } = {}) {
      this.onState = onState;
      this.onMediaSession = onMediaSession;
      this.onRemoteTrack = onRemoteTrack;
      this.onRemoteTrackRemoved = onRemoteTrackRemoved;
      this.onParticipants = onParticipants;
      this.audioHost = audioHost || null;
      this.sessionId = "";
      this.participantId = "";
      this.leaseId = "";
      this.generation = "";
      this.disposed = false;
      this.ledger = null;
      this.heartbeatTimer = null;
      this.room = null;
      this.localStream = null;
      this.remoteElements = new Set();
      this.remoteParticipantIds = new WeakMap();
      this.outputDeviceId = "";
      this.deviceChangeHandler = () => { void this.verifyOutputRoute(); };
      this.pageHideHandler = () => { this.dispose(); };
      window.addEventListener("pagehide", this.pageHideHandler);
    }

    setContext(handoff) {
      this.sessionId = safe(handoff?.radio_session_id || handoff?.session_id, 128).replace(/^group:/, "");
      this.participantId = safe(handoff?.participant_id, 160);
      this.generation = safe(handoff?.generation, 128);
      this.ledger = window.GroupRadioResourceLedger?.create(this.generation) || null;
      return Boolean(this.sessionId && this.participantId);
    }

    library() {
      const library = window.LivekitClient;
      if (!library?.Room || !library?.RoomEvent || !library?.Track) throw new Error("group_media_client_unavailable");
      return library;
    }

    validateMediaSession(payload) {
      const session = payload?.session;
      const serverUrl = safe(session?.server_url, 512);
      const token = safe(session?.token, 4096);
      const expiresAt = Date.parse(safe(session?.expires_at, 128));
      if (
        !session
        || safe(session.provider, 64) !== "livekit-cloud"
        || !serverUrl.startsWith("wss://")
        || !token
        || session.media !== "audio"
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
        || session.recording !== false
        || session.raw_media_storage !== false
      ) throw new Error("group_media_session_invalid");
      return { serverUrl, token };
    }

    bindRoom(room, library) {
      const event = library.RoomEvent;
      room.on(event.TrackSubscribed, (track, _publication, participant) => {
        if (this.disposed || track?.kind !== "audio") return;
        if (participant?.identity) this.remoteParticipantIds.set(track, String(participant.identity));
        this.attachRemoteTrack(track);
        this.emitParticipants();
      });
      room.on(event.TrackUnsubscribed, (track) => {
        this.detachRemoteTrack(track);
        this.emitParticipants();
      });
      if (event.ParticipantConnected) room.on(event.ParticipantConnected, () => this.emitParticipants());
      if (event.ParticipantDisconnected) room.on(event.ParticipantDisconnected, () => this.emitParticipants());
      room.on(event.Reconnecting, () => this.onState?.("RECONNECTING"));
      room.on(event.Reconnected, () => this.onState?.(this.leaseId ? "TALKING" : "READY"));
      room.on(event.Disconnected, () => {
        if (!this.disposed) this.onState?.("DEVICE_LOST");
      });
    }

    emitParticipants() {
      const participants = new Set();
      if (this.participantId) participants.add(this.participantId);
      this.room?.remoteParticipants?.forEach?.((participant) => {
        const identity = safe(participant?.identity, 160);
        if (identity) participants.add(identity);
      });
      this.onParticipants?.([...participants]);
    }

    attachRemoteTrack(track) {
      if (!track?.attach || !this.audioHost) return;
      const element = track.attach();
      element.autoplay = true;
      element.playsInline = true;
      element.dataset.groupRadioRemoteAudio = "true";
      if (this.outputDeviceId && typeof element.setSinkId === "function") {
        void element.setSinkId(this.outputDeviceId).catch(() => this.onState?.("DEVICE_LOST"));
      }
      this.audioHost.appendChild(element);
      this.remoteElements.add(element);
      this.onRemoteTrack?.(track, safe(this.remoteParticipantIds.get(track), 160));
    }

    detachRemoteTrack(track) {
      if (track?.detach) track.detach().forEach((element) => element.remove());
      this.onRemoteTrackRemoved?.(track);
      this.remoteElements.forEach((element) => {
        if (!element.isConnected) this.remoteElements.delete(element);
      });
    }

    async connectMedia(payload) {
      if (this.room) return;
      const session = this.validateMediaSession(payload);
      const library = this.library();
      const room = new library.Room({ adaptiveStream: true, disconnectOnPageLeave: false });
      this.room = room;
      this.bindRoom(room, library);
      try {
        await room.connect(session.serverUrl, session.token);
        navigator.mediaDevices?.addEventListener?.("devicechange", this.deviceChangeHandler);
        this.emitParticipants();
      } catch (error) {
        this.room = null;
        try { room.removeAllListeners?.(); } catch (_error) { /* best effort */ }
        try { room.disconnect?.(); } catch (_error) { /* best effort */ }
        throw error;
      }
    }

    async publishMicrophone() {
      if (!this.room || this.localStream || !navigator.mediaDevices?.getUserMedia) throw new Error("radio_microphone_unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track || !this.room || this.disposed) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("radio_microphone_unavailable");
      }
      try {
        await this.room.localParticipant.publishTrack(track, { source: this.library().Track.Source.Microphone });
        this.localStream = stream;
        this.ledger?.register("media", track.id || "microphone");
      } catch (error) {
        stream.getTracks().forEach((item) => item.stop());
        throw error;
      }
    }

    async stopPublishing() {
      const stream = this.localStream;
      this.localStream = null;
      if (!stream) return;
      for (const track of stream.getTracks()) {
        try { await this.room?.localParticipant?.unpublishTrack?.(track, true); } catch (_error) { /* best effort */ }
        track.stop();
      }
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
      if (!this.room) {
        const mediaResponse = await fetch(`/api/group-radio/sessions/${encodeURIComponent(this.sessionId)}/media`, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media: "audio" }),
        });
        const mediaPayload = await mediaResponse.json().catch(() => ({}));
        if (!mediaResponse.ok) throw new Error(mediaPayload.detail || "radio_media_session_failed");
        this.onMediaSession?.(mediaPayload.session || null);
        await this.connectMedia(mediaPayload);
      }
      const response = await fetch("/api/group-radio/floor/acquire", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId, participant_id: this.participantId, generation: this.generation }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "radio_floor_acquire_failed");
      this.leaseId = safe(payload.floor?.lease_id, 128);
      if (!this.ledger || this.ledger.terminated) this.ledger = window.GroupRadioResourceLedger?.create(this.generation) || null;
      this.ledger?.register("floor", this.leaseId);
      try {
        await this.publishMicrophone();
      } catch (error) {
        await this.releaseFloor();
        this.onState?.("DEVICE_LOST");
        throw error;
      }
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
      if (!response.ok) {
        await this.stopPublishing();
        await this.releaseFloor();
        this.onState?.("DEVICE_LOST");
      }
      return response.ok;
    }

    async releaseFloor() {
      if (!this.leaseId || !this.sessionId) return false;
      const leaseId = this.leaseId;
      this.leaseId = "";
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      const response = await fetch("/api/group-radio/floor/finalize", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: this.sessionId, lease_id: leaseId }),
      });
      this.ledger?.terminate();
      return response.ok;
    }

    async stop() {
      if (!this.leaseId || !this.sessionId) {
        await this.stopPublishing();
        return false;
      }
      await this.stopPublishing();
      const released = await this.releaseFloor();
      this.onState?.("FINALIZING_BURST");
      return released;
    }

    async chooseOutputRoute(route) {
      if (!this.remoteElements.size && route === "private" && !navigator.mediaDevices?.selectAudioOutput) throw new Error("audio_output_selection_unavailable");
      let deviceId = "default";
      if (route === "private") {
        if (!navigator.mediaDevices?.selectAudioOutput) throw new Error("audio_output_selection_unavailable");
        const selected = await navigator.mediaDevices.selectAudioOutput();
        deviceId = safe(selected?.deviceId, 512);
        if (!deviceId) throw new Error("audio_output_selection_cancelled");
      }
      for (const element of this.remoteElements) {
        if (typeof element.setSinkId !== "function") {
          if (route === "private") throw new Error("audio_output_selection_unavailable");
        } else {
          await element.setSinkId(deviceId);
        }
        await element.play?.().catch(() => undefined);
      }
      this.outputDeviceId = deviceId;
      this.onState?.(this.leaseId ? "TALKING" : "READY");
      return true;
    }

    async verifyOutputRoute() {
      if (!this.outputDeviceId || this.outputDeviceId === "default" || !navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const available = devices.some((device) => device.kind === "audiooutput" && device.deviceId === this.outputDeviceId);
      if (available) return;
      for (const element of this.remoteElements) element.pause?.();
      this.outputDeviceId = "";
      this.onState?.("DEVICE_LOST");
    }

    async disconnectMedia() {
      navigator.mediaDevices?.removeEventListener?.("devicechange", this.deviceChangeHandler);
      await this.stopPublishing();
      const room = this.room;
      this.room = null;
      this.remoteElements.forEach((element) => {
        element.pause?.();
        element.srcObject = null;
        element.remove();
      });
      this.remoteElements.clear();
      this.audioHost?.replaceChildren();
      try { room?.removeAllListeners?.(); } catch (_error) { /* best effort */ }
      try { room?.disconnect?.(); } catch (_error) { /* best effort */ }
      this.emitParticipants();
    }

    async leave() {
      await this.stop();
      await this.disconnectMedia();
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
      window.removeEventListener("pagehide", this.pageHideHandler);
      void this.stop().finally(() => this.disconnectMedia());
      this.ledger?.terminate();
    }
  }

  window.GroupRadioClient = Object.freeze({ create: (options) => new GroupRadioClient(options) });
}(window));
