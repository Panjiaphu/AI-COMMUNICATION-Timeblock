(function installGroupMediaClient(window) {
  "use strict";

  const ROOM_PREFIX = "group-call:";
  const MEDIA_MODES = new Set(["audio", "video"]);
  const LIMITS = Object.freeze({ max_participants: 8, max_rooms: 20, token_ttl_seconds: 300, room_ttl_seconds: 3600 });

  function safeText(value, maximum) {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : "";
  }

  function publicError(error) {
    const code = safeText(error?.code, 96);
    return code || "group_media_unavailable";
  }

  class GroupMediaSession {
    constructor({ card, copy, onState }) {
      this.card = card;
      this.copy = copy || {};
      this.onState = onState;
      this.room = null;
      this.localStream = null;
      this.roomId = "";
      this.mode = "";
      this.generation = 0;
      this.connecting = false;
      this.ending = false;
      this.remoteElements = new Set();
      this.stage = card.querySelector("[data-group-livekit-stage]");
      this.localVideo = card.querySelector("[data-group-local-video]");
      this.remoteVideo = card.querySelector("[data-group-remote-video]");
      this.remoteAudio = card.querySelector("[data-group-remote-audio]");
      window.addEventListener("pagehide", () => {
        void this.leave({ reconcile: false, state: "ENDED" });
      });
    }

    text(key) {
      return String(this.copy[key] || "");
    }

    state(state, noteKey) {
      this.card.dataset.mediaState = state;
      this.onState?.(state, noteKey ? this.text(noteKey) : "");
    }

    handoffContext(handoff) {
      const applicationRoom = safeText(handoff?.room_id, 160);
      const mode = safeText(handoff?.mode, 16).toLowerCase();
      if (!applicationRoom.startsWith(ROOM_PREFIX) || !MEDIA_MODES.has(mode)) {
        throw new Error("group_handoff_required");
      }
      const roomId = applicationRoom.slice(ROOM_PREFIX.length);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) throw new Error("group_room_invalid");
      return { roomId, mode };
    }

    async request(roomId, action, body) {
      const response = await fetch(`/api/messaging/call-rooms/${encodeURIComponent(roomId)}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      let payload = {};
      try { payload = await response.json(); } catch (_error) { payload = {}; }
      if (!response.ok) {
        const failure = new Error(publicError(payload?.error ? { code: payload.error } : null));
        failure.code = publicError(payload?.error ? { code: payload.error } : null);
        throw failure;
      }
      return payload;
    }

    validateSession(payload, expectedMode) {
      const session = payload?.session;
      if (!session || typeof session !== "object") throw new Error("group_media_session_invalid");
      const serverUrl = safeText(session.server_url, 512);
      const token = safeText(session.token, 4096);
      const providerRoomId = safeText(session.provider_room_id, 128);
      const participantId = safeText(session.participant_id, 160);
      const expiry = Date.parse(safeText(session.expires_at, 128));
      if (
        safeText(session.provider, 64) !== "livekit-cloud"
        || !serverUrl.startsWith("wss://")
        || !token
        || !providerRoomId
        || !/^(member|business):[A-Za-z0-9_-]{1,128}$/.test(participantId)
        || !Number.isFinite(expiry)
        || expiry <= Date.now()
        || session.media !== expectedMode
        || session.region !== "Singapore"
        || session.recording !== false
        || session.raw_media_storage !== false
      ) throw new Error("group_media_session_invalid");
      const limits = session.limits || {};
      for (const [key, value] of Object.entries(LIMITS)) {
        if (Number(limits[key]) !== value) throw new Error("group_media_session_invalid");
      }
      return { serverUrl, token };
    }

    library() {
      const library = window.LivekitClient;
      if (!library?.Room || !library?.RoomEvent || !library?.Track) {
        throw new Error("group_media_client_unavailable");
      }
      return library;
    }

    bindRoom(room, library, generation) {
      const event = library.RoomEvent;
      room.on(event.TrackSubscribed, (track) => {
        if (generation !== this.generation || this.ending) return;
        this.attachRemoteTrack(track);
      });
      room.on(event.TrackUnsubscribed, (track) => this.detachRemoteTrack(track));
      room.on(event.Reconnecting, () => {
        if (generation === this.generation && !this.ending) this.state("RECONNECTING", "group_call_reconnecting");
      });
      room.on(event.Reconnected, () => {
        if (generation === this.generation && !this.ending) this.state("JOINED", "group_call_connected");
      });
      room.on(event.Disconnected, () => {
        if (generation !== this.generation || this.ending) return;
        void this.leave({ reconcile: true, state: "JOIN_FAILED" });
      });
    }

    attachRemoteTrack(track) {
      if (!track?.attach) return;
      const target = track.kind === "video" ? this.remoteVideo : this.remoteAudio;
      if (!target) return;
      const element = track.attach();
      element.autoplay = true;
      element.playsInline = true;
      if (track.kind === "video") {
        this.remoteVideo.replaceChildren(element);
      } else {
        element.dataset.groupRemoteAudio = "true";
        this.remoteAudio.append(element);
      }
      this.remoteElements.add(element);
    }

    detachRemoteTrack(track) {
      if (track?.detach) track.detach().forEach((element) => element.remove());
      this.remoteElements.forEach((element) => {
        if (!element.isConnected) this.remoteElements.delete(element);
      });
    }

    async acquireAndPublish(library, mode, generation) {
      if (!navigator.mediaDevices?.getUserMedia || this.localStream) throw new Error("group_media_unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: mode === "video" ? { facingMode: "user" } : false,
      });
      if (generation !== this.generation || this.ending) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("group_media_stale");
      }
      this.localStream = stream;
      if (this.localVideo && mode === "video") {
        this.localVideo.srcObject = stream;
        this.localVideo.dataset.active = "true";
      }
      const source = library.Track.Source;
      try {
        await Promise.all(stream.getTracks().map((track) => this.room.localParticipant.publishTrack(track, {
          source: track.kind === "video" ? source.Camera : source.Microphone,
        })));
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
        if (this.localVideo) this.localVideo.srcObject = null;
        throw error;
      }
    }

    async join(handoff) {
      if (this.connecting || this.room) return;
      let context;
      try { context = this.handoffContext(handoff); } catch (_error) {
        this.state("JOIN_FAILED", "group_call_failed");
        return;
      }
      this.connecting = true;
      this.ending = false;
      this.roomId = context.roomId;
      this.mode = context.mode;
      const generation = ++this.generation;
      let joinedOnServer = false;
      this.state("JOINING", "group_call_joining");
      try {
        await this.request(context.roomId, "join");
        joinedOnServer = true;
        const payload = await this.request(context.roomId, "media/session", { media: context.mode });
        const session = this.validateSession(payload, context.mode);
        const library = this.library();
        const room = new library.Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: false });
        this.room = room;
        this.bindRoom(room, library, generation);
        await room.connect(session.serverUrl, session.token);
        await this.acquireAndPublish(library, context.mode, generation);
        if (generation !== this.generation || this.ending) throw new Error("group_media_stale");
        if (this.stage) this.stage.hidden = false;
        this.state("JOINED", "group_call_connected");
      } catch (_error) {
        await this.cleanup();
        if (joinedOnServer) await this.reconcile(context.roomId, "leave");
        this.state("JOIN_FAILED", "group_call_failed");
      } finally {
        this.connecting = false;
      }
    }

    async reconcile(roomId, action) {
      try { await this.request(roomId, action); } catch (_error) { /* server reconciliation is best effort */ }
    }

    async cleanup() {
      this.ending = true;
      const room = this.room;
      this.room = null;
      const stream = this.localStream;
      this.localStream = null;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (this.localVideo) {
        this.localVideo.pause?.();
        this.localVideo.srcObject = null;
        delete this.localVideo.dataset.active;
      }
      this.remoteElements.forEach((element) => {
        element.pause?.();
        element.srcObject = null;
        element.remove();
      });
      this.remoteElements.clear();
      this.remoteVideo?.replaceChildren();
      this.remoteAudio?.replaceChildren();
      if (this.stage) this.stage.hidden = true;
      try { room?.removeAllListeners?.(); } catch (_error) { /* best effort */ }
      try { room?.disconnect?.(); } catch (_error) { /* best effort */ }
    }

    async leave({ reconcile = true, state = "ENDED" } = {}) {
      if (!this.room && !this.localStream && !this.roomId) return;
      const roomId = this.roomId;
      ++this.generation;
      this.state("LEAVING", "group_call_joining");
      await this.cleanup();
      if (reconcile && roomId) await this.reconcile(roomId, "leave");
      this.roomId = "";
      this.mode = "";
      this.ending = false;
      this.state(state, state === "JOIN_FAILED" ? "group_call_failed" : "group_ui_only");
    }
  }

  window.GroupMediaClient = Object.freeze({
    create: (options) => new GroupMediaSession(options),
  });
}(window));
