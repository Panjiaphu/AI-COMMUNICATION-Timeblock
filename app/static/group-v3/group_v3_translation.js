(function nativeGroupTranslationV3(window, document) {
  "use strict";

  var runtime = window.GroupV3Runtime;
  if (!runtime || !window.RTCPeerConnection) return;

  var sidecars = new Map();
  var radioRecordings = new Map();
  var safeOutputDeviceId = "";

  function text(value, maximum) {
    if (typeof value !== "string") return "";
    var normalized = value.trim();
    return normalized && normalized.length <= (maximum || 12000) ? normalized : "";
  }

  function uuid() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : "segment-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  async function responseJson(response) {
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(String(payload.detail || payload.error || "translation_request_failed"));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function chooseSafeOutput() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.selectAudioOutput !== "function") {
      safeOutputDeviceId = "";
      return false;
    }
    try {
      var device = await navigator.mediaDevices.selectAudioOutput();
      safeOutputDeviceId = text(device && device.deviceId, 512);
      return Boolean(safeOutputDeviceId);
    } catch (_error) {
      safeOutputDeviceId = "";
      return false;
    }
  }

  async function playRemoteAudio(audio) {
    var snapshot = runtime.snapshot();
    if (!audio || snapshot.device_lost || !snapshot.auto_read || !safeOutputDeviceId) return "suppressed";
    if (typeof audio.setSinkId !== "function") return "suppressed";
    try {
      await audio.setSinkId(safeOutputDeviceId);
      await audio.play();
      return "completed";
    } catch (_error) {
      return "safe_audio_unavailable";
    }
  }

  window.GroupV3SafeAudio = Object.freeze({
    chooseOutput: chooseSafeOutput,
    hasPrivateOutput: function () { return Boolean(safeOutputDeviceId); }
  });

  function membershipForIdentity(snapshot, identity) {
    var participant = (snapshot.media_participants || []).find(function (item) {
      return item.livekit_identity === identity;
    });
    return participant && participant.membership_id || "";
  }

  class TranslationSidecar {
    constructor(options) {
      this.track = options.track;
      this.snapshot = options.snapshot;
      this.speakerMembershipId = options.speakerMembershipId;
      this.segmentId = options.segmentId;
      this.startPlayback = options.startPlayback || null;
      this.cleanupPlayback = options.cleanupPlayback || null;
      this.pc = null;
      this.events = null;
      this.clonedTrack = null;
      this.audio = null;
      this.inputText = "";
      this.outputText = "";
      this.reservationId = "";
      this.closed = false;
      this.persisted = false;
      this.startedAt = Date.now();
    }

    async start() {
      var snapshot = this.snapshot;
      if (!snapshot.space_id || !snapshot.runtime_id || !this.speakerMembershipId) return;
      if (!snapshot.auto_translate || snapshot.consent_status !== "granted") return;
      if (!snapshot.spoken_language || !snapshot.target_language || snapshot.spoken_language === snapshot.target_language) return;
      var response = await window.fetch("/api/group/spaces/" + encodeURIComponent(snapshot.space_id) + "/translation/client-secret", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": uuid()
        },
        body: JSON.stringify({
          runtime_kind: snapshot.runtime_kind,
          runtime_id: snapshot.runtime_id,
          segment_id: this.segmentId,
          source_language: snapshot.spoken_language,
          target_language: snapshot.target_language,
          estimated_target_seconds: 300
        })
      });
      var payload = await responseJson(response);
      var clientSecret = text(payload.client_secret, 4096);
      this.reservationId = text(payload.translation && payload.translation.reservation_id, 128);
      if (!clientSecret || !this.reservationId) throw new Error("translation_client_secret_invalid");

      this.clonedTrack = typeof this.track.clone === "function" ? this.track.clone() : this.track;
      this.pc = new RTCPeerConnection();
      this.pc.ontrack = this.receiveProviderAudio.bind(this);
      this.events = this.pc.createDataChannel("oai-events");
      this.events.onmessage = this.providerEvent.bind(this);
      this.events.onerror = this.release.bind(this);
      this.pc.addTrack(this.clonedTrack, new MediaStream([this.clonedTrack]));
      var offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      var sdpResponse;
      try {
        sdpResponse = await window.fetch("https://api.openai.com/v1/realtime/translations/calls", {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Authorization: "Bearer " + clientSecret,
            "Content-Type": "application/sdp",
            Accept: "application/sdp"
          },
          body: String(offer && offer.sdp || "")
        });
      } finally {
        clientSecret = "";
      }
      if (!sdpResponse.ok) throw new Error("translation_sdp_failed");
      await this.pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      if (this.startPlayback) this.startPlayback();
    }

    receiveProviderAudio(event) {
      var stream = event.streams && event.streams[0];
      if (!stream || this.closed) return;
      this.audio = document.createElement("audio");
      this.audio.autoplay = false;
      this.audio.playsInline = true;
      this.audio.srcObject = stream;
    }

    providerEvent(message) {
      var event;
      try {
        event = JSON.parse(message.data);
      } catch (_error) {
        return;
      }
      if (event.type === "session.input_transcript.delta") {
        this.inputText += text(event.delta, 1024);
      } else if (event.type === "session.input_transcript.done") {
        this.inputText = text(event.transcript || this.inputText);
      } else if (event.type === "session.output_transcript.delta") {
        this.outputText += text(event.delta, 1024);
      } else if (event.type === "session.output_transcript.done") {
        this.outputText = text(event.transcript || this.outputText);
        this.persistFinal();
      } else if (event.type === "error") {
        this.release();
      }
    }

    async persistFinal() {
      if (this.persisted || this.closed || !this.inputText || !this.outputText) return;
      this.persisted = true;
      var seconds = Math.max(1, Math.min(300, Math.ceil((Date.now() - this.startedAt) / 1000)));
      try {
        var response = await window.fetch("/api/group/spaces/" + encodeURIComponent(this.snapshot.space_id) + "/translation/final", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            reservation_id: this.reservationId,
            state: "FINAL",
            speaker_membership_id: this.speakerMembershipId,
            original_text: this.inputText,
            translated_text: this.outputText,
            actual_target_seconds: seconds,
            confidence: null
          })
        });
        await responseJson(response);
        await runtime.translationFinal();
        await playRemoteAudio(this.audio);
      } catch (_error) {
        this.persisted = false;
        await this.release();
      }
    }

    async release() {
      if (!this.reservationId || this.persisted) return;
      var reservationId = this.reservationId;
      this.reservationId = "";
      await window.fetch("/api/group/spaces/" + encodeURIComponent(this.snapshot.space_id) + "/translation/reservations/release", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservation_id: reservationId })
      }).catch(function () {});
    }

    async stop() {
      if (this.closed) return;
      this.closed = true;
      await this.release();
      try { if (this.events) this.events.close(); } catch (_error) {}
      try { if (this.pc) this.pc.close(); } catch (_error) {}
      if (this.clonedTrack && this.clonedTrack !== this.track) this.clonedTrack.stop();
      if (this.audio) {
        this.audio.pause();
        this.audio.srcObject = null;
      }
      if (this.cleanupPlayback) this.cleanupPlayback();
    }
  }

  async function startSidecar(options) {
    var key = options.segmentId + ":" + options.snapshot.target_language;
    if (sidecars.has(key)) return;
    var sidecar = new TranslationSidecar(options);
    sidecars.set(key, sidecar);
    try {
      await sidecar.start();
    } catch (_error) {
      await sidecar.release();
      sidecars.delete(key);
    }
  }

  window.addEventListener("group-v3:remote-audio", function (event) {
    var snapshot = runtime.snapshot();
    var identity = text(event.detail && event.detail.participant_identity, 160);
    var membershipId = membershipForIdentity(snapshot, identity);
    var track = event.detail && event.detail.track;
    if (!track || !membershipId) return;
    startSidecar({
      track: track,
      snapshot: snapshot,
      speakerMembershipId: membershipId,
      segmentId: "segment-" + uuid()
    });
  });

  window.addEventListener("group-v3:local-radio-audio", function (event) {
    var snapshot = runtime.snapshot();
    var burstId = text(event.detail && event.detail.burst_id, 128);
    var track = event.detail && event.detail.track;
    if (!track || !burstId || !snapshot.auto_translate || snapshot.consent_status !== "granted") return;
    if (!window.MediaRecorder) return;
    var mime = ["audio/webm;codecs=opus", "audio/webm"].find(function (value) {
      return !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(value);
    }) || "";
    var clone = track.clone();
    var recorder = new MediaRecorder(new MediaStream([clone]), mime ? { mimeType: mime } : undefined);
    var recording = { recorder: recorder, chunks: [], clone: clone, mime: mime, snapshot: snapshot };
    recorder.ondataavailable = function (chunk) {
      if (chunk.data && chunk.data.size) recording.chunks.push(chunk.data);
    };
    radioRecordings.set(burstId, recording);
    recorder.start(250);
  });

  async function translateRadioRecording(burstId, recording) {
    var blob = new Blob(recording.chunks, { type: recording.mime || "audio/webm" });
    if (!blob.size) return;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    var context = new AudioContextClass();
    var buffer = await context.decodeAudioData(await blob.arrayBuffer());
    var source = context.createBufferSource();
    var destination = context.createMediaStreamDestination();
    source.buffer = buffer;
    source.connect(destination);
    var snapshot = runtime.snapshot();
    snapshot.runtime_kind = "radio";
    snapshot.runtime_id = burstId;
    await startSidecar({
      track: destination.stream.getAudioTracks()[0],
      snapshot: snapshot,
      speakerMembershipId: snapshot.membership_id,
      segmentId: burstId,
      startPlayback: function () { source.start(); },
      cleanupPlayback: function () {
        try { source.stop(); } catch (_error) {}
        context.close();
      }
    });
  }

  window.addEventListener("group-v3:radio-stopped", function (event) {
    var burstId = text(event.detail && event.detail.burst_id, 128);
    var recording = radioRecordings.get(burstId);
    if (!recording) return;
    radioRecordings.delete(burstId);
    recording.recorder.onstop = function () {
      recording.clone.stop();
      translateRadioRecording(burstId, recording).catch(function () {});
    };
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
  });

  window.addEventListener("group-v3:media-disconnected", function () {
    sidecars.forEach(function (sidecar) { sidecar.stop(); });
    sidecars.clear();
  });
}(window, document));
