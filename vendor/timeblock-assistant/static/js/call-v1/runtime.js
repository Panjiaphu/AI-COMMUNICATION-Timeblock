(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};
  const { STATES, CallV1Session, CallV1Media, CallV1Peer, CallV1Signaling } = namespace;

  const terminalStatuses = new Set(["rejected", "cancelled", "canceled", "ended", "missed", "failed"]);

  function statusOf(call) {
    return String(call?.status || "").trim().toLowerCase();
  }

  function candidatePayload(candidate) {
    const candidateLine = String(candidate?.candidate || "").trim();
    if (!candidateLine) return null;
    return {
      candidate: candidateLine,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    };
  }

  function isUsableCandidate(candidate) {
    return Boolean(candidate && typeof candidate === "object" && String(candidate.candidate || "").trim());
  }

  class CallV1Runtime {
    constructor({
      sessionFactory = (options) => CallV1Session.create(options),
      mediaFactory = (options) => new CallV1Media(options),
      peerFactory = (options) => new CallV1Peer(options),
      signalingFactory = (options) => new CallV1Signaling(options),
      ringFactory = (options) => (typeof namespace.RingAudio === "function" ? new namespace.RingAudio(options) : null),
      mediaDevices = root.navigator?.mediaDevices,
      fetcher = root.fetch?.bind(root),
      peerFactoryImplementation = null,
      ownerToken = "",
      remoteStreamFactory = null,
      onStateChange = null,
      onRemoteStream = null,
      onTelemetry = null,
      onRingAudioStateChange = null,
      translationPlugin = null,
    } = {}) {
      this._sessionFactory = sessionFactory;
      this._mediaFactory = mediaFactory;
      this._peerFactory = peerFactory;
      this._signalingFactory = signalingFactory;
      this._ringFactory = ringFactory;
      this._mediaDevices = mediaDevices;
      this._fetcher = fetcher;
      this._peerFactoryImplementation = peerFactoryImplementation;
      this._ownerToken = String(ownerToken || "");
      this._remoteStreamFactory = typeof remoteStreamFactory === "function"
        ? remoteStreamFactory
        : (track) => (typeof root.MediaStream === "function" && track ? new root.MediaStream([track]) : null);
      this._onStateChange = typeof onStateChange === "function" ? onStateChange : null;
      this._onRemoteStream = typeof onRemoteStream === "function" ? onRemoteStream : null;
      this._onTelemetry = typeof onTelemetry === "function" ? onTelemetry : null;
      this._onRingAudioStateChange = typeof onRingAudioStateChange === "function" ? onRingAudioStateChange : null;
      this.translationPlugin = translationPlugin || null;
      this.session = null;
      this.media = null;
      this.peer = null;
      this.signaling = null;
      this.ring = null;
      this.call = null;
      this.localElement = null;
      this.remoteElement = null;
      this._terminalPromise = null;
      this._localIceQueue = [];
      this._localIceKeys = new Set();
      this._localIceDrain = null;
      this._ringSilencedGeneration = null;
    }

    _emitTelemetry(event, details = {}) {
      this._onTelemetry?.({
        event,
        call_id: details.call_id || this.session?.callId || this.call?.id || "",
        role: details.role || this.session?.role || "",
        status: details.status || this.session?.status || "",
        ...details,
      });
    }

    _ensureRing() {
      if (!this.ring && typeof this._ringFactory === "function") this.ring = this._ringFactory({});
      return this.ring;
    }

    _silenceRing(reason = "state-change") {
      const generation = this.session?.generation ?? null;
      if (generation !== null && this._ringSilencedGeneration === generation) return false;
      try { this.ring?.stopAll?.(); } catch (_error) { /* ring cleanup is best effort */ }
      this._ringSilencedGeneration = generation;
      this._onRingAudioStateChange?.({ channel: "all", playable: false, reason });
      this._emitTelemetry("ring_state", { state: "stopped", reason });
      return true;
    }

    _terminalActionForPeerFailure() {
      const callStatus = statusOf(this.call);
      const sessionStatus = this.session?.status;
      if (
        callStatus === "accepted"
        || [STATES.ANSWERING, STATES.NEGOTIATING, STATES.CONNECTED].includes(sessionStatus)
      ) return "end";
      return this.session?.role === "callee" ? "reject" : "cancel";
    }

    silenceRing(reason = "external-state") {
      return this._silenceRing(reason);
    }

    armRingAudio() {
      const ring = this._ensureRing();
      if (!ring?.arm) return Promise.resolve(false);
      return Promise.resolve(ring.arm()).then((armed) => {
        this._onRingAudioStateChange?.({ channel: "all", armed: Boolean(armed), playable: Boolean(armed) });
        return Boolean(armed);
      }).catch(() => {
        this._onRingAudioStateChange?.({ channel: "all", armed: false, playable: false });
        return false;
      });
    }

    attachMediaElements(localElement, remoteElement) {
      this.localElement = localElement || null;
      this.remoteElement = remoteElement || null;
      if (this.localElement && this.session?.localStream) this.localElement.srcObject = this.session.localStream;
      if (this.remoteElement && this.session?.remoteStream) this.remoteElement.srcObject = this.session.remoteStream;
      return { local: this.localElement, remote: this.remoteElement };
    }

    _attachOwnedMedia() {
      if (this.localElement && this.session?.localStream) this.localElement.srcObject = this.session.localStream;
      if (this.remoteElement && this.session?.remoteStream) this.remoteElement.srcObject = this.session.remoteStream;
    }

    _ensureIdle() {
      if (this.session?.isLive?.()) throw new Error("call-v1.active-runtime");
      if (CallV1Session.active?.()) throw new Error("call-v1.active-session");
    }

    _newSession({ conversationId = "", callId = "", role = "caller", media = "audio" } = {}) {
      this._ensureIdle();
      this.session = this._sessionFactory({
        conversationId,
        callId,
        role,
        media,
        onStateChange: (event) => {
          this.translationPlugin?.handleCallState?.(event);
          this._onStateChange?.(event);
        },
      });
      this.media = this._mediaFactory({ session: this.session, mediaDevices: this._mediaDevices });
      this.signaling = this._signalingFactory({
        session: this.session,
        fetcher: this._fetcher,
        onTelemetry: (event) => {
          this._emitTelemetry(event);
          if (
            event?.event === "signaling_error"
            && [404, 409].includes(Number(event.http_status))
            && ["answer", "ice"].includes(String(event.kind || ""))
            && this.session?.isLive?.()
          ) {
            this.terminate("stale-signaling");
          }
        },
      });
      this._ensureRing();
      this._terminalPromise = null;
      this._localIceQueue = [];
      this._localIceKeys = new Set();
      this._localIceDrain = null;
      this._ringSilencedGeneration = null;
      return this.session;
    }

    attachTranslationPlugin(plugin) {
      this.translationPlugin = plugin || null;
      this.translationPlugin?.attachRuntime?.(this);
      return this.translationPlugin;
    }

    async _peerConfiguration(explicit) {
      if (explicit && typeof explicit === "object") return explicit;
      const payload = await this.signaling.getIceServers(this.session.callbackToken());
      return { iceServers: Array.isArray(payload?.ice_servers) ? payload.ice_servers : [] };
    }

    _createPeer(configuration, generation) {
      this.peer = this._peerFactory({
        session: this.session,
        peerFactory: this._peerFactoryImplementation || undefined,
      });
      this.peer.create(configuration, generation);
      this.peer.bind({
        track: (event) => {
          const stream = event?.streams?.[0] || this._remoteStreamFactory(event?.track, event) || null;
          if (!stream || !this.session?.isCurrent(generation)) return;
          this.session.ownRemoteStream(stream, generation);
          if (this.remoteElement) this.remoteElement.srcObject = stream;
          this._silenceRing("remote-track");
          this._emitTelemetry("remote_track", { state: "received", track_kind: String(event?.track?.kind || "") });
          this._onRemoteStream?.(stream, event);
        },
        icecandidate: (event) => {
          if (!this.session?.isCurrent(generation) || !event?.candidate) return;
          const candidate = candidatePayload(event.candidate);
          if (!candidate) return;
          if (!this.session.callId) {
            if (this.session.pendingIce.length < 200) this.session.pendingIce.push(candidate);
            return;
          }
          this._enqueueLocalIce(candidate, generation);
        },
        connectionstatechange: () => {
          const state = String(this.session?.peer?.connectionState || "").toLowerCase();
          if (!this.session?.isCurrent(generation)) return;
          this._emitTelemetry("peer_state", { state });
          if (state === "connected") {
            this._silenceRing("peer-connected");
            if ([STATES.OUTGOING_RINGING, STATES.ANSWERING, STATES.NEGOTIATING].includes(this.session.status)) {
              this.session.transition(STATES.CONNECTED);
            }
          } else if (["failed", "closed"].includes(state)) {
            this.terminate("peer-failure", { serverAction: this._terminalActionForPeerFailure() });
          }
        },
      }, generation);
      this.peer.addLocalTracks(generation);
      return this.peer;
    }

    _enqueueLocalIce(candidate, generation) {
      const session = this.session;
      if (!session?.callId || !session.isCurrent(generation) || !isUsableCandidate(candidate)) return false;
      const key = JSON.stringify(candidate);
      if (this._localIceKeys.has(key) || this._localIceKeys.size >= 200) return false;
      this._localIceKeys.add(key);
      this._localIceQueue.push({ candidate, generation, callId: String(session.callId) });
      if (!this._localIceDrain) {
        this._localIceDrain = this._drainLocalIce().finally(() => {
          this._localIceDrain = null;
          if (this._localIceQueue.length && this.session?.isLive?.()) {
            this._localIceDrain = this._drainLocalIce().finally(() => { this._localIceDrain = null; });
          }
        });
      }
      return true;
    }

    async _drainLocalIce() {
      while (this._localIceQueue.length) {
        const item = this._localIceQueue.shift();
        const session = this.session;
        if (!session?.isCurrent(item.generation) || String(session.callId) !== item.callId) continue;
        try {
          await this.signaling.sendIce(item.callId, item.candidate, item.generation);
        } catch (error) {
          this._emitTelemetry("ice_send_failed", {
            call_id: item.callId,
            http_status: Number(error?.status) || 0,
          });
          if ([404, 409].includes(Number(error?.status))) break;
        }
      }
    }

    async _flushPendingIce(generation) {
      if (!this.session?.callId || !this.session.isCurrent(generation)) return;
      const pending = this.session.pendingIce.splice(0).filter(isUsableCandidate);
      for (const candidate of pending) this._enqueueLocalIce(candidate, generation);
      if (this._localIceDrain) await this._localIceDrain;
    }

    async _applyRemoteIce(call, generation) {
      const session = this.session;
      const peer = this.peer?.session?.peer;
      if (!session?.isCurrent(generation) || !peer) return;
      const queued = Array.from(session.pendingRemoteIce.values());
      session.pendingRemoteIce.clear();
      const items = queued.concat(Array.isArray(call?.ice) ? call.ice : []);
      for (const item of items) {
        if (!session.isCurrent(generation)) return;
        if (item?.source && this._ownerToken && String(item.source) === this._ownerToken) continue;
        const candidate = item?.candidate || item;
        if (!isUsableCandidate(candidate)) continue;
        const key = JSON.stringify(candidate);
        if (session.remoteIce.has(key)) continue;
        if (!peer.remoteDescription) {
          session.pendingRemoteIce.set(key, { candidate });
          continue;
        }
        try {
          await this.peer.addIceCandidate(candidate, generation);
          if (!session.isCurrent(generation)) return;
          session.remoteIce.add(key);
        } catch (_error) {
          if (session.isCurrent(generation)) session.pendingRemoteIce.set(key, { candidate });
        }
      }
    }

    async _startOutgoing(media, { conversationId, peerConfiguration = null, offerOptions = {} } = {}) {
      if (!conversationId) throw new TypeError("call-v1.conversation-required");
      const session = this._newSession({ conversationId, role: "caller", media });
      const generation = session.callbackToken();
      let createdCallId = "";
      try {
        if (media === "video") await this.media.acquireVideo(generation);
        else await this.media.acquireAudio(generation);
        this._attachOwnedMedia();
        const configuration = await this._peerConfiguration(peerConfiguration);
        session.transition(STATES.NEGOTIATING);
        this._createPeer(configuration, generation);
        const offer = await this.peer.createOffer(offerOptions, generation);
        const payload = await this.signaling.create(
          conversationId,
          media,
          { type: offer.type, sdp: offer.sdp },
          generation,
        );
        const call = payload?.call;
        if (!call?.id || statusOf(call) !== "ringing") throw new Error("call-v1.call-create-invalid");
        createdCallId = String(call.id);
        session.setCall(call, generation);
        this.call = call;
        session.transition(STATES.OUTGOING_RINGING, { call });
        const ringbackStarted = await this.ring?.playRingback?.();
        this._onRingAudioStateChange?.({ channel: "ringback", playable: Boolean(ringbackStarted) });
        await this._flushPendingIce(generation);
        return { call, offer, session };
      } catch (error) {
        if (createdCallId) await this.signaling.end(createdCallId, null).catch(() => undefined);
        await this.terminate("outgoing-setup-failed");
        throw error;
      }
    }

    startAudioCall(options = {}) {
      return this._startOutgoing("audio", options);
    }

    startVideoCall(options = {}) {
      return this._startOutgoing("video", options);
    }

    showIncoming(call) {
      if (!call?.id || statusOf(call) !== "ringing") return false;
      const session = this._newSession({
        callId: call.id,
        conversationId: call.conversation_id,
        role: "callee",
        media: call.media === "video" ? "video" : "audio",
      });
      session.setCall(call, session.callbackToken());
      this.call = call;
      session.transition(STATES.INCOMING_RINGING, { call });
      Promise.resolve(this.ring?.playRingtone?.()).then((playable) => {
        if (this.session === session && session.isLive()) {
          this._onRingAudioStateChange?.({ channel: "ringtone", playable: Boolean(playable) });
        }
      }).catch(() => {
        if (this.session === session && session.isLive()) {
          this._onRingAudioStateChange?.({ channel: "ringtone", playable: false });
        }
      });
      return true;
    }

    async answer() {
      const session = this.session;
      const incoming = this.call;
      if (!session || session.role !== "callee" || session.status !== STATES.INCOMING_RINGING) {
        throw new Error("call-v1.no-incoming-call");
      }
      const generation = session.callbackToken();
      try {
        // Answer intent must silence the callee before any network or media work.
        this._silenceRing("answer-intent");
        const canonicalPayload = await this.signaling.get(incoming.id, generation);
        const canonical = canonicalPayload?.call;
        if (!canonical?.id || statusOf(canonical) !== "ringing") throw new Error("call-v1.call-not-ringing");
        session.setCall(canonical, generation);
        this.call = canonical;
        session.transition(STATES.ANSWERING, { call: canonical });
        if (session.media === "video") await this.media.acquireVideo(generation);
        else await this.media.acquireAudio(generation);
        this._attachOwnedMedia();
        const configuration = await this._peerConfiguration(null);
        this._createPeer(configuration, generation);
        await this.peer.applyRemoteDescription(canonical.offer, generation);
        const answer = await this.peer.createAnswer({}, generation);
        const accepted = await this.signaling.answer(canonical.id, { type: answer.type, sdp: answer.sdp }, generation);
        if (!session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
        this.call = accepted?.call || canonical;
        session.transition(STATES.NEGOTIATING, { call: this.call });
        await this._applyRemoteIce(this.call, generation);
        return { call: this.call, answer, session };
      } catch (error) {
        await this.terminate("answer-setup-failed");
        throw error;
      }
    }

    async applyCanonicalCall(call) {
      const session = this.session;
      if (!session?.isLive?.() || !call?.id || String(call.id) !== String(session.callId)) return false;
      const generation = session.callbackToken();
      const status = statusOf(call);
      this.call = call;
      if (terminalStatuses.has(status)) {
        await this.terminate(status);
        return false;
      }
      if (status !== "ringing" || call.answer?.type === "answer") this._silenceRing("canonical-accepted");
      if (session.role === "caller" && call.answer?.type === "answer" && this.peer?.session?.peer) {
        if ([STATES.OUTGOING_RINGING, STATES.NEGOTIATING].includes(session.status)) {
          if (session.status === STATES.OUTGOING_RINGING) session.transition(STATES.NEGOTIATING, { call });
          await this.peer.applyRemoteDescription(call.answer, generation);
          await this._applyRemoteIce(call, generation);
        }
      } else {
        await this._applyRemoteIce(call, generation);
      }
      return true;
    }

    async reject() {
      const callId = this.session?.callId || this.call?.id;
      this._emitTelemetry("reject_clicked", { call_id: callId || "" });
      return this.terminate("reject", { serverAction: callId ? "reject" : null });
    }

    cancel() {
      return this.terminate("cancel", { serverAction: "cancel" });
    }

    hangup() {
      return this.terminate("hangup", { serverAction: "end" });
    }

    heartbeat() {
      if (!this.session?.callId || !this.signaling || !this.session.isLive?.()) return Promise.resolve(false);
      return this.signaling.heartbeat(this.session.callId, this.session.callbackToken())
        .then(() => true)
        .catch(() => false);
    }

    terminate(reason = "ended", { serverAction = null } = {}) {
      const session = this.session;
      if (!session) return Promise.resolve(false);
      if (this._terminalPromise) return this._terminalPromise;
      const callId = session.callId;
      const signaling = this.signaling;
      session.invalidate(reason);
      if (session.status !== STATES.TERMINATING && session.status !== STATES.ENDED) {
        session.transition(STATES.TERMINATING, { reason });
      }

      // The translation plugin is a bounded Call V1 child. It must release its
      // own resources before canonical media/peer cleanup, without awaiting a
      // provider or replacing the canonical microphone during termination.
      try { this.translationPlugin?.beforeCallTerminate?.({ callId, reason }); } catch (_error) { /* continue canonical cleanup */ }

      // Local resources are released before any best-effort network terminal update.
      try { signaling?.abortAll?.({ includeTerminal: false }); } catch (_error) { /* continue cleanup */ }
      this._localIceQueue = [];
      this._localIceKeys.clear();
      this._localIceDrain = null;
      this._silenceRing(reason);
      for (const track of session.localStream?.getTracks?.() || []) {
        try { track.stop?.(); } catch (_error) { /* continue cleanup */ }
      }
      for (const track of session.remoteStream?.getTracks?.() || []) {
        try { track.stop?.(); } catch (_error) { /* continue cleanup */ }
      }
      for (const element of [this.localElement, this.remoteElement]) {
        try { element?.pause?.(); } catch (_error) { /* continue cleanup */ }
        try { if (element) element.srcObject = null; } catch (_error) { /* continue cleanup */ }
      }
      try { this.peer?.close?.(); } catch (_error) { /* continue cleanup */ }
      session.clearResources();
      session.finalize(reason);
      this.session = null;
      this.media = null;
      this.peer = null;
      try { this.ring?.dispose?.(); } catch (_error) { /* continue cleanup */ }
      this.ring = null;
      this.call = null;
      this._emitTelemetry("local_cleanup_completed", {
        call_id: callId || "",
        action: serverAction || "",
        reason,
      });
      const terminalRequest = serverAction && callId && signaling
        ? signaling.action(callId, serverAction, null, { timeoutMs: 3000, keepalive: true })
        : Promise.resolve(null);
      this.signaling = null;
      this._terminalPromise = Promise.resolve(true);
      terminalRequest.then(() => {
        this._emitTelemetry("terminal_action_sent", {
          call_id: callId || "",
          action: serverAction || "",
          reason,
        });
      }).catch((error) => {
        this._emitTelemetry("terminal_action_failed", {
          call_id: callId || "",
          action: serverAction || "",
          reason,
          http_status: Number(error?.status) || 0,
        });
      }).finally(() => {
        try { signaling?.close?.(); } catch (_error) { /* terminal cleanup is best effort */ }
      });
      return this._terminalPromise;
    }
  }

  namespace.CallV1Runtime = CallV1Runtime;
  namespace.candidatePayload = candidatePayload;
  root.TimeblockCallV1 = namespace;
})();
