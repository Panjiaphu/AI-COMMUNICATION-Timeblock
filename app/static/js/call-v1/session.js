(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};
  const STATES = Object.freeze({
    IDLE: "IDLE",
    OUTGOING_RINGING: "OUTGOING_RINGING",
    INCOMING_RINGING: "INCOMING_RINGING",
    ANSWERING: "ANSWERING",
    NEGOTIATING: "NEGOTIATING",
    CONNECTED: "CONNECTED",
    TERMINATING: "TERMINATING",
    ENDED: "ENDED",
  });
  const TERMINAL = new Set([STATES.TERMINATING, STATES.ENDED]);
  const TRANSITIONS = Object.freeze({
    [STATES.IDLE]: new Set([
      STATES.OUTGOING_RINGING,
      STATES.INCOMING_RINGING,
      STATES.ANSWERING,
      STATES.NEGOTIATING,
      STATES.TERMINATING,
    ]),
    [STATES.OUTGOING_RINGING]: new Set([
      STATES.ANSWERING,
      STATES.NEGOTIATING,
      STATES.CONNECTED,
      STATES.TERMINATING,
    ]),
    [STATES.INCOMING_RINGING]: new Set([STATES.ANSWERING, STATES.TERMINATING]),
    [STATES.ANSWERING]: new Set([STATES.NEGOTIATING, STATES.CONNECTED, STATES.TERMINATING]),
    [STATES.NEGOTIATING]: new Set([STATES.OUTGOING_RINGING, STATES.CONNECTED, STATES.TERMINATING]),
    [STATES.CONNECTED]: new Set([STATES.TERMINATING]),
    [STATES.TERMINATING]: new Set([STATES.ENDED]),
    [STATES.ENDED]: new Set(),
  });

  class CallV1SessionError extends Error {
    constructor(message) {
      super(message);
      this.name = "CallV1SessionError";
    }
  }

  class CallV1Session {
    static _active = null;
    static _nextGeneration = 0;

    static create(options = {}) {
      if (CallV1Session._active && CallV1Session._active.isLive()) {
        throw new CallV1SessionError("call-v1.active-session");
      }
      const session = new CallV1Session(options);
      CallV1Session._active = session;
      return session;
    }

    static active() {
      return CallV1Session._active?.isLive() ? CallV1Session._active : null;
    }

    static release(session) {
      if (CallV1Session._active === session) CallV1Session._active = null;
    }

    constructor({
      callId = "",
      conversationId = "",
      role = "caller",
      media = "audio",
      onStateChange = null,
      now = () => Date.now(),
    } = {}) {
      this.callId = String(callId || "");
      this.conversationId = String(conversationId || "");
      this.role = role === "callee" ? "callee" : "caller";
      this.media = media === "video" ? "video" : "audio";
      this.status = STATES.IDLE;
      this.generation = ++CallV1Session._nextGeneration;
      this.peer = null;
      this.localStream = null;
      this.remoteStream = null;
      this.pendingIce = [];
      this.pendingRemoteIce = new Map();
      this.remoteIce = new Set();
      this.terminated = false;
      this.reason = "";
      this._generationValid = true;
      this._now = now;
      this._onStateChange = typeof onStateChange === "function" ? onStateChange : null;
    }

    isLive() {
      return !this.terminated && this.status !== STATES.ENDED;
    }

    isTerminal() {
      return TERMINAL.has(this.status) || this.terminated;
    }

    isCurrent(generation = this.generation) {
      return this.isLive() && this._generationValid && generation === this.generation;
    }

    callbackToken() {
      return this.generation;
    }

    guard(generation, callback) {
      return (...args) => {
        if (!this.isCurrent(generation)) return undefined;
        return callback(...args);
      };
    }

    transition(next, metadata = {}) {
      const target = String(next || "").toUpperCase();
      if (!TRANSITIONS[this.status]?.has(target)) {
        throw new CallV1SessionError(`call-v1.invalid-transition:${this.status}->${target}`);
      }
      this.status = target;
      if (target === STATES.TERMINATING) this._generationValid = false;
      this._onStateChange?.({
        callId: this.callId,
        conversationId: this.conversationId,
        role: this.role,
        media: this.media,
        generation: this.generation,
        status: this.status,
        at: this._now(),
        ...metadata,
      });
      return this.status;
    }

    setCall(call = {}, generation = this.generation) {
      if (!this.isCurrent(generation)) throw new CallV1SessionError("call-v1.stale-generation");
      if (call.id !== undefined) this.callId = String(call.id || this.callId);
      if (call.conversation_id !== undefined) this.conversationId = String(call.conversation_id || this.conversationId);
      return call;
    }

    ownPeer(peer, generation = this.generation) {
      if (!this.isCurrent(generation)) throw new CallV1SessionError("call-v1.stale-generation");
      if (!peer) throw new TypeError("call-v1.peer-required");
      if (this.peer && this.peer !== peer) throw new CallV1SessionError("call-v1.peer-owner-conflict");
      this.peer = peer;
      return peer;
    }

    ownLocalStream(stream, generation = this.generation) {
      if (!this.isCurrent(generation)) throw new CallV1SessionError("call-v1.stale-generation");
      if (!stream) throw new TypeError("call-v1.local-stream-required");
      if (this.localStream && this.localStream !== stream) throw new CallV1SessionError("call-v1.local-stream-owner-conflict");
      this.localStream = stream;
      return stream;
    }

    ownRemoteStream(stream, generation = this.generation) {
      if (!this.isCurrent(generation)) throw new CallV1SessionError("call-v1.stale-generation");
      this.remoteStream = stream || null;
      return this.remoteStream;
    }

    invalidate(reason = "terminated") {
      if (this.terminated) return false;
      this.reason = String(reason || "terminated");
      this._generationValid = false;
      return true;
    }

    finalize(reason = this.reason || "ended") {
      if (this.terminated) return false;
      this.reason = String(reason || "ended");
      if (this.status !== STATES.TERMINATING) {
        this.status = STATES.TERMINATING;
      }
      this.status = STATES.ENDED;
      this.terminated = true;
      this._generationValid = false;
      this._onStateChange?.({
        callId: this.callId,
        conversationId: this.conversationId,
        role: this.role,
        media: this.media,
        generation: this.generation,
        status: this.status,
        reason: this.reason,
        at: this._now(),
      });
      CallV1Session.release(this);
      return true;
    }

    clearResources() {
      this.peer = null;
      this.localStream = null;
      this.remoteStream = null;
      this.pendingIce.length = 0;
      this.pendingRemoteIce.clear();
      this.remoteIce.clear();
    }

    resourceSnapshot() {
      const tracks = this.localStream?.getTracks?.() || [];
      return {
        callId: this.callId,
        conversationId: this.conversationId,
        status: this.status,
        generation: this.generation,
        peer: this.peer,
        localStream: this.localStream,
        remoteStream: this.remoteStream,
        pendingIce: this.pendingIce.length,
        remoteIce: this.remoteIce.size,
        liveMicTracks: tracks.filter((track) => track.kind === "audio" && track.readyState !== "ended").length,
        liveCameraTracks: tracks.filter((track) => track.kind === "video" && track.readyState !== "ended").length,
        terminated: this.terminated,
      };
    }
  }

  namespace.STATES = STATES;
  namespace.CallV1Session = CallV1Session;
  namespace.CallV1SessionError = CallV1SessionError;
  root.TimeblockCallV1 = namespace;
})();
