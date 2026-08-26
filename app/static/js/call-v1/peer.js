(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};

  class CallV1Peer {
    constructor({ session, peerFactory = null } = {}) {
      if (!session) throw new TypeError("call-v1.peer-session-required");
      this.session = session;
      this.peerFactory = peerFactory || ((configuration) => new root.RTCPeerConnection(configuration));
      this._bound = new Map();
    }

    create(configuration = {}, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
      if (this.session.peer) throw new Error("call-v1.peer-already-created");
      const peer = this.peerFactory(configuration);
      try {
        this.session.ownPeer(peer, generation);
      } catch (error) {
        try { peer.close?.(); } catch (_closeError) { /* best effort */ }
        throw error;
      }
      return peer;
    }

    bind(events = {}, generation = this.session.callbackToken()) {
      const peer = this.session.peer;
      if (!peer || !this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
      for (const [type, handler] of Object.entries(events)) {
        if (typeof handler !== "function") continue;
        const wrapped = this.session.guard(generation, handler);
        const property = `on${type}`;
        peer[property] = wrapped;
        this._bound.set(property, wrapped);
      }
      return peer;
    }

    addLocalTracks(generation = this.session.callbackToken()) {
      const peer = this.session.peer;
      const stream = this.session.localStream;
      if (!peer || !stream || !this.session.isCurrent(generation)) throw new Error("call-v1.peer-not-ready");
      for (const track of stream.getTracks?.() || []) peer.addTrack(track, stream);
    }

    audioSender() {
      const peer = this.session.peer;
      if (!peer) return null;
      return peer.getSenders?.().find((sender) => sender?.track?.kind === "audio") || null;
    }

    async replaceLocalAudioTrack(track, generation = this.session.callbackToken()) {
      if (!track || track.kind !== "audio" || !this.session.isCurrent(generation)) {
        throw new Error("call-v1.audio-track-invalid");
      }
      const sender = this.audioSender();
      if (!sender?.replaceTrack) throw new Error("call-v1.audio-sender-unavailable");
      await sender.replaceTrack(track);
      return sender;
    }

    async restoreLocalAudioTrack(track, generation = this.session.callbackToken()) {
      if (!track || track.kind !== "audio" || !this.session.isCurrent(generation)) {
        throw new Error("call-v1.audio-track-invalid");
      }
      return this.replaceLocalAudioTrack(track, generation);
    }

    async createOffer(options = {}, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation) || !this.session.peer) throw new Error("call-v1.stale-generation");
      const offer = await this.session.peer.createOffer(options);
      if (!this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
      await this.session.peer.setLocalDescription(offer);
      return offer;
    }

    async createAnswer(options = {}, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation) || !this.session.peer) throw new Error("call-v1.stale-generation");
      const answer = await this.session.peer.createAnswer(options);
      if (!this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
      await this.session.peer.setLocalDescription(answer);
      return answer;
    }

    async applyRemoteDescription(description, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation) || !this.session.peer) throw new Error("call-v1.stale-generation");
      await this.session.peer.setRemoteDescription(description);
      if (!this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
    }

    async addIceCandidate(candidate, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation) || !this.session.peer) throw new Error("call-v1.stale-generation");
      await this.session.peer.addIceCandidate(candidate);
    }

    close() {
      const peer = this.session.peer;
      if (!peer) return;
      for (const property of this._bound.keys()) {
        if (peer[property] === this._bound.get(property)) peer[property] = null;
      }
      this._bound.clear();
      try { peer.close?.(); } catch (_error) { /* best effort */ }
      this.session.peer = null;
    }
  }

  namespace.CallV1Peer = CallV1Peer;
  root.TimeblockCallV1 = namespace;
})();
