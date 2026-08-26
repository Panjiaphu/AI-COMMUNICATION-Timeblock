(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};
  const CHANNELS = Object.freeze(["ringback", "ringtone"]);
  const SAMPLE_RATE = 8000;
  const TAU = Math.PI * 2;
  const RINGBACK_METADATA = Object.freeze({
    toneHz: Object.freeze([440, 480]),
    toneDurationMs: 2000,
    silenceDurationMs: 4000,
    cycleDurationMs: 6000,
    cadence: "2000ms-on-4000ms-off",
  });
  const RINGTONE_METADATA = Object.freeze({
    tempoBpm: 96,
    beatMs: 625,
    beatsPerBar: 4,
    bars: 4,
    durationMs: 10000,
    timeSignature: "4/4",
  });
  const RINGTONE_CHORDS = Object.freeze([
    Object.freeze([261.63, 329.63, 392.00]),
    Object.freeze([392.00, 493.88, 587.33]),
    Object.freeze([440.00, 523.25, 659.25]),
    Object.freeze([349.23, 440.00, 523.25]),
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function ascii(bytes, offset, value) {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  }

  function uint16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function uint32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function base64(bytes) {
    if (typeof root.btoa !== "function") throw new Error("call-v1.ring-base64-unavailable");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return root.btoa(binary);
  }

  function envelope(offset, duration) {
    if (offset < 0 || offset >= duration) return 0;
    const attack = Math.min(0.03, duration * 0.15);
    const release = Math.min(0.08, duration * 0.25);
    if (offset < attack) return offset / attack;
    if (offset > duration - release) return (duration - offset) / release;
    return 1;
  }

  function wav(durationMs, sampleAt) {
    const frames = Math.max(1, Math.round(SAMPLE_RATE * durationMs / 1000));
    const bytes = new Uint8Array(44 + frames);
    ascii(bytes, 0, "RIFF");
    uint32(bytes, 4, 36 + frames);
    ascii(bytes, 8, "WAVE");
    ascii(bytes, 12, "fmt ");
    uint32(bytes, 16, 16);
    uint16(bytes, 20, 1);
    uint16(bytes, 22, 1);
    uint32(bytes, 24, SAMPLE_RATE);
    uint32(bytes, 28, SAMPLE_RATE);
    uint16(bytes, 32, 1);
    uint16(bytes, 34, 8);
    ascii(bytes, 36, "data");
    uint32(bytes, 40, frames);
    for (let index = 0; index < frames; index += 1) {
      bytes[44 + index] = Math.round(128 + 127 * clamp(Number(sampleAt(index / SAMPLE_RATE)) || 0, -1, 1));
    }
    return `data:audio/wav;base64,${base64(bytes)}`;
  }

  function voice(time, frequency, duration, level, phase = 0) {
    return level * envelope(time, duration) * Math.sin(TAU * frequency * time + phase);
  }

  function buildRingbackSource() {
    const cycle = RINGBACK_METADATA.cycleDurationMs / 1000;
    const tone = RINGBACK_METADATA.toneDurationMs / 1000;
    return wav(RINGBACK_METADATA.cycleDurationMs, (time) => {
      const offset = time % cycle;
      if (offset >= tone) return 0;
      const level = envelope(offset, tone) * 0.19;
      return level * (
        Math.sin(TAU * RINGBACK_METADATA.toneHz[0] * offset)
        + Math.sin(TAU * RINGBACK_METADATA.toneHz[1] * offset)
      );
    });
  }

  function buildRingtoneSource() {
    const beat = RINGTONE_METADATA.beatMs / 1000;
    const duration = RINGTONE_METADATA.durationMs / 1000;
    const totalBeats = RINGTONE_METADATA.beatsPerBar * RINGTONE_METADATA.bars;
    return wav(RINGTONE_METADATA.durationMs, (time) => {
      const beatIndex = Math.min(totalBeats - 1, Math.floor(time / beat));
      const beatTime = time - beatIndex * beat;
      const chord = RINGTONE_CHORDS[Math.floor(beatIndex / RINGTONE_METADATA.beatsPerBar)];
      const accent = beatIndex % RINGTONE_METADATA.beatsPerBar === 0 ? 1 : 0.58;
      const active = envelope(beatTime, Math.min(0.48, beat - 0.02));
      let sample = 0;
      chord.forEach((frequency, index) => {
        sample += voice(beatTime, frequency, 0.48, (index === 0 ? 0.10 : 0.065) * accent);
      });
      sample += voice(beatTime, chord[0] * 2, 0.48, 0.12 * accent);
      sample += voice(Math.max(0, beatTime - 0.015), chord[2] * 2, 0.34, 0.045 * accent);
      return sample * active * envelope(time, duration);
    });
  }

  const DEFAULT_RINGBACK_SOURCE = buildRingbackSource();
  const DEFAULT_RINGTONE_SOURCE = buildRingtoneSource();

  class RingAudio {
    constructor({ audioFactory = null, sources = {}, volume = 0.7 } = {}) {
      this.audioFactory = audioFactory || ((source) => {
        if (typeof root.Audio === "function") return new root.Audio(source);
        if (root.document?.createElement) {
          const audio = root.document.createElement("audio");
          audio.src = source;
          return audio;
        }
        throw new Error("call-v1.ring-audio-unavailable");
      });
      this.sources = {
        ringback: sources.ringback || DEFAULT_RINGBACK_SOURCE,
        ringtone: sources.ringtone || DEFAULT_RINGTONE_SOURCE,
      };
      this.volume = Math.max(0, Math.min(Number(volume) || 0.7, 1));
      this._channels = { ringback: null, ringtone: null };
      this._audio = { ringback: null, ringtone: null };
      this._generation = { ringback: 0, ringtone: 0 };
      this._armed = false;
      this._armPromise = null;
    }

    playRingback() { return this._play("ringback"); }
    stopRingback() { this._stop("ringback"); }
    playRingtone() { return this._play("ringtone"); }
    stopRingtone() { this._stop("ringtone"); }
    stopAll() { CHANNELS.forEach((channel) => this._stop(channel)); }
    active(channel) { return Boolean(this._channels[channel]); }

    async arm() {
      if (this._armed) return true;
      if (this._armPromise) return this._armPromise;
      const attempts = CHANNELS.map((channel) => {
        const audio = this._getAudio(channel);
        if (!audio) return Promise.resolve(false);
        const generation = this._generation[channel];
        // Browser audio arming is a capability unlock, never a user-facing preview.
        // `muted` is used in addition to volume=0 so iOS/WebKit cannot expose the
        // ring source while a user gesture unlocks later playback.
        try { audio.muted = true; } catch (_error) { /* best effort */ }
        audio.volume = 0;
        audio.loop = false;
        try {
          return Promise.resolve(audio.play?.()).then(() => {
            if (this._generation[channel] !== generation) {
              try { audio.pause?.(); } catch (_error) { /* stale arm is silenced */ }
              try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
              audio.volume = this.volume;
              audio.loop = false;
              try { audio.muted = false; } catch (_error) { /* best effort */ }
              return false;
            }
            if (this._channels[channel] === audio) {
              audio.volume = this.volume;
              audio.loop = true;
              try { audio.muted = false; } catch (_error) { /* actual call audio may be audible */ }
              return true;
            }
            try { audio.pause?.(); } catch (_error) { /* best effort */ }
            try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
            audio.volume = this.volume;
            audio.loop = true;
            try { audio.muted = false; } catch (_error) { /* prepared but stopped */ }
            return true;
          }).catch(() => {
            try { audio.pause?.(); } catch (_error) { /* best effort */ }
            try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
            audio.loop = false;
            audio.volume = this.volume;
            try { audio.muted = false; } catch (_error) { /* best effort */ }
            return false;
          });
        } catch (_error) {
          try { audio.muted = false; } catch (_ignored) { /* best effort */ }
          return Promise.resolve(false);
        }
      });
      this._armPromise = Promise.all(attempts).then((results) => {
        this._armed = results.some(Boolean);
        return this._armed;
      }).finally(() => {
        this._armPromise = null;
      });
      return this._armPromise;
    }

    dispose() {
      this.stopAll();
      CHANNELS.forEach((channel) => {
        const audio = this._audio[channel];
        if (!audio) return;
        try { audio.pause?.(); } catch (_error) { /* best effort */ }
        try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
        try { audio.loop = false; } catch (_error) { /* best effort */ }
        try { audio.muted = false; } catch (_error) { /* best effort */ }
        this._audio[channel] = null;
      });
      this._armed = false;
      this._armPromise = null;
      this.audioFactory = null;
    }

    _getAudio(channel) {
      if (!CHANNELS.includes(channel) || typeof this.audioFactory !== "function") return null;
      if (this._audio[channel]) return this._audio[channel];
      try {
        const audio = this.audioFactory(this.sources[channel]);
        audio.preload = "auto";
        audio.loop = true;
        audio.volume = this.volume;
        try { audio.muted = false; } catch (_error) { /* best effort */ }
        this._audio[channel] = audio;
        return audio;
      } catch (_error) {
        return null;
      }
    }

    _play(channel) {
      if (!CHANNELS.includes(channel)) return Promise.resolve(false);
      const active = this._channels[channel];
      if (active) {
        if (!active.paused) return Promise.resolve(true);
        const generation = ++this._generation[channel];
        try { active.muted = false; } catch (_error) { /* actual call audio may be audible */ }
        return Promise.resolve(active.play?.()).then(() => {
          if (this._generation[channel] === generation && this._channels[channel] === active) return true;
          try { active.pause?.(); } catch (_error) { /* stale play is silenced */ }
          try { active.currentTime = 0; } catch (_error) { /* best effort */ }
          try { active.loop = false; } catch (_error) { /* best effort */ }
          return false;
        }).catch(() => {
          if (this._generation[channel] === generation) this._stop(channel);
          return false;
        });
      }
      const audio = this._getAudio(channel);
      if (!audio) return Promise.resolve(false);
      const generation = ++this._generation[channel];
      audio.volume = this.volume;
      audio.loop = true;
      try { audio.muted = false; } catch (_error) { /* actual call audio may be audible */ }
      this._channels[channel] = audio;
      return Promise.resolve(audio.play?.()).then(() => {
        if (this._generation[channel] === generation && this._channels[channel] === audio) return true;
        try { audio.pause?.(); } catch (_error) { /* stale play is silenced */ }
        try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
        try { audio.loop = false; } catch (_error) { /* best effort */ }
        return false;
      }).catch(() => {
        if (this._generation[channel] === generation) this._stop(channel);
        return false;
      });
    }

    _stop(channel) {
      if (!CHANNELS.includes(channel)) return;
      this._generation[channel] += 1;
      const active = this._channels[channel];
      const backing = this._audio[channel];
      this._channels[channel] = null;
      const targets = new Set([active, backing].filter(Boolean));
      targets.forEach((audio) => {
        try { audio.pause?.(); } catch (_error) { /* best effort */ }
        try { audio.currentTime = 0; } catch (_error) { /* best effort */ }
        try { audio.loop = false; } catch (_error) { /* best effort */ }
        try { audio.muted = false; } catch (_error) { /* reset prepared state */ }
      });
    }
  }

  namespace.RingAudio = RingAudio;
  namespace.DEFAULT_RINGBACK_SOURCE = DEFAULT_RINGBACK_SOURCE;
  namespace.DEFAULT_RINGTONE_SOURCE = DEFAULT_RINGTONE_SOURCE;
  namespace.RINGBACK_METADATA = RINGBACK_METADATA;
  namespace.RINGTONE_METADATA = RINGTONE_METADATA;
  root.TimeblockCallV1 = namespace;
})();
