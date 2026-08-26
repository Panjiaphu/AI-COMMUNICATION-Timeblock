(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};

  class CallV1Media {
    constructor({ session, mediaDevices = root.navigator?.mediaDevices } = {}) {
      if (!session) throw new TypeError("call-v1.media-session-required");
      this.session = session;
      this.mediaDevices = mediaDevices;
    }

    constraints(media = this.session.media) {
      return media === "video"
        ? { audio: true, video: { facingMode: "user" } }
        : { audio: true, video: false };
    }

    async acquire(media = this.session.media, generation = this.session.callbackToken()) {
      if (!this.session.isCurrent(generation)) throw new Error("call-v1.stale-generation");
      if (!this.mediaDevices?.getUserMedia) throw new Error("call-v1.media-unavailable");
      if (this.session.localStream) throw new Error("call-v1.media-already-acquired");
      const stream = await this.mediaDevices.getUserMedia(this.constraints(media));
      if (!this.session.isCurrent(generation)) {
        stream?.getTracks?.().forEach((track) => track.stop?.());
        throw new Error("call-v1.stale-generation");
      }
      this.session.ownLocalStream(stream, generation);
      return stream;
    }

    acquireAudio(generation) {
      return this.acquire("audio", generation);
    }

    acquireVideo(generation) {
      return this.acquire("video", generation);
    }
  }

  namespace.CallV1Media = CallV1Media;
  root.TimeblockCallV1 = namespace;
})();
