(function () {
  "use strict";

  const RINGTONE_CODE = "TIMEBLOCK_RING_V1";
  const PREFERENCES_ENDPOINT = "/api/assistant/notifications/preferences";
  const TEMPO_BPM = 96;
  const BEAT_MS = 625;
  const BEATS_PER_BAR = 4;
  const BARS_PER_CYCLE = 4;
  const CYCLE_MS = BEAT_MS * BEATS_PER_BAR * BARS_PER_CYCLE;
  const VIBRATION_BAR_PATTERN = Object.freeze([320, 305, 120, 505, 120, 505, 120, 505]);
  const VIBRATION_PATTERN = Object.freeze(
    Array.from({ length: BARS_PER_CYCLE }, () => Array.from(VIBRATION_BAR_PATTERN)).flat(),
  );
  const CHORDS = Object.freeze([
    Object.freeze([261.63, 329.63, 392.00]),
    Object.freeze([392.00, 493.88, 587.33]),
    Object.freeze([440.00, 523.25, 659.25]),
    Object.freeze([349.23, 440.00, 523.25]),
  ]);
  const RINGTONE_METADATA = Object.freeze({
    code: RINGTONE_CODE,
    version: 1,
    durationMs: CYCLE_MS,
    tempoBpm: TEMPO_BPM,
    timeSignature: "4/4",
    bars: BARS_PER_CYCLE,
    beatsPerBar: BEATS_PER_BAR,
    beatMs: BEAT_MS,
    loop: true,
  });
  const DEFAULTS = Object.freeze({
    enabled: true,
    videoEnabled: true,
    volume: 1,
    maxDurationMs: 60000,
    ringtoneCode: RINGTONE_CODE,
    vibrationEnabled: true,
    vibrationSyncEnabled: true,
  });

  class IncomingCallRingtoneController {
    constructor(options = {}) {
      this.storageKey = options.storageKey || "timeblock.call-ringtone.v1";
      this.preferences = this.readPreferences();
      this.context = null;
      this.deadline = null;
      this.cycleTimer = null;
      this.ringEndsAt = 0;
      this.interval = null;
      this.activeCallId = "";
      this.nodes = new Set();
      this.timers = new Set();
      this.armed = false;
      this.generation = 0;
      this.saveTimer = null;
      this.syncPromise = this.loadBackendPreferences();
    }

    readPreferences() {
      try {
        const stored = JSON.parse(window.localStorage.getItem(this.storageKey) || "{}");
        return {
          enabled: stored.enabled !== false,
          videoEnabled: stored.videoEnabled !== false,
          volume: this.normalizeVolume(stored.volume),
          maxDurationMs: this.normalizeDuration(stored.maxDurationMs),
          ringtoneCode: stored.ringtoneCode === RINGTONE_CODE ? stored.ringtoneCode : RINGTONE_CODE,
          vibrationEnabled: stored.vibrationEnabled !== false,
          vibrationSyncEnabled: stored.vibrationSyncEnabled !== false,
        };
      } catch (_error) {
        return { ...DEFAULTS };
      }
    }

    normalizeVolume(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0.05, Math.min(number, 1)) : DEFAULTS.volume;
    }

    normalizeDuration(value) {
      const number = Number(value);
      return [20000, 35000, 60000].includes(number) ? number : DEFAULTS.maxDurationMs;
    }

    savePreferences() {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.preferences));
      } catch (_error) {
        // Local storage is only a cache. Backend persistence remains authoritative.
      }
    }

    applyPreferencesToControls() {
      const enabled = document.querySelector("[data-ringtone-enabled]");
      const volume = document.querySelector("[data-ringtone-volume]");
      const output = document.querySelector("[data-ringtone-volume-output]");
      const duration = document.querySelector("[data-ringtone-duration]");
      if (enabled) enabled.checked = this.preferences.enabled;
      if (volume) volume.value = String(Math.round(this.preferences.volume * 100));
      if (output) output.textContent = `${Math.round(this.preferences.volume * 100)}%`;
      if (duration) duration.value = String(this.preferences.maxDurationMs);
      window.dispatchEvent(new CustomEvent("timeblock:call-preferences", {
        detail: this.getPreferences(),
      }));
    }

    backendPayload() {
      return {
        incoming_call_sound_enabled: this.preferences.enabled,
        incoming_video_call_sound_enabled: this.preferences.videoEnabled,
        incoming_call_volume_percent: Math.round(this.preferences.volume * 100),
        incoming_call_ring_duration_seconds: Math.round(this.preferences.maxDurationMs / 1000),
        incoming_call_ringtone_code: RINGTONE_CODE,
        incoming_call_vibration_enabled: this.preferences.vibrationEnabled,
        incoming_call_vibration_sync_enabled: this.preferences.vibrationSyncEnabled,
      };
    }

    preferencesFromBackend(value) {
      const backend = value && typeof value === "object" ? value : {};
      return {
        enabled: backend.incoming_call_sound_enabled !== false,
        videoEnabled: backend.incoming_video_call_sound_enabled !== false,
        volume: this.normalizeVolume(Number(backend.incoming_call_volume_percent) / 100),
        maxDurationMs: this.normalizeDuration(Number(backend.incoming_call_ring_duration_seconds) * 1000),
        ringtoneCode: backend.incoming_call_ringtone_code === RINGTONE_CODE
          ? backend.incoming_call_ringtone_code
          : RINGTONE_CODE,
        vibrationEnabled: backend.incoming_call_vibration_enabled !== false,
        vibrationSyncEnabled: backend.incoming_call_vibration_sync_enabled !== false,
      };
    }

    async loadBackendPreferences() {
      try {
        const response = await window.fetch(PREFERENCES_ENDPOINT, {
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!response.ok) return false;
        const payload = await response.json();
        if (!payload || payload.ok === false || !payload.preferences) return false;
        try {
          window.localStorage.setItem(
            "timeblockNotificationPreferences",
            JSON.stringify(payload.preferences),
          );
        } catch (_error) {
          // Backend remains authoritative when storage is unavailable.
        }
        this.preferences = this.preferencesFromBackend(payload.preferences);
        this.savePreferences();
        this.applyPreferencesToControls();
        return true;
      } catch (_error) {
        return false;
      }
    }

    queueBackendSave() {
      if (this.saveTimer) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(async () => {
        this.saveTimer = null;
        try {
          const response = await window.fetch(PREFERENCES_ENDPOINT, {
            method: "PUT",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(this.backendPayload()),
          });
          if (!response.ok) return;
          const payload = await response.json();
          if (payload && payload.preferences) {
            this.preferences = this.preferencesFromBackend(payload.preferences);
            this.savePreferences();
            this.applyPreferencesToControls();
          }
        } catch (_error) {
          // Keep the local cache and retry after the next explicit preference change.
        }
      }, 250);
    }

    getPreferences() {
      return { ...this.preferences };
    }

    getMetadata() {
      return { ...RINGTONE_METADATA };
    }

    getVibrationPattern() {
      return Array.from(VIBRATION_PATTERN);
    }

    setPreferences(next = {}) {
      this.preferences = {
        enabled: next.enabled === undefined ? this.preferences.enabled : Boolean(next.enabled),
        videoEnabled: next.videoEnabled === undefined
          ? this.preferences.videoEnabled
          : Boolean(next.videoEnabled),
        volume: next.volume === undefined ? this.preferences.volume : this.normalizeVolume(next.volume),
        maxDurationMs: next.maxDurationMs === undefined
          ? this.preferences.maxDurationMs
          : this.normalizeDuration(next.maxDurationMs),
        ringtoneCode: RINGTONE_CODE,
        vibrationEnabled: next.vibrationEnabled === undefined
          ? this.preferences.vibrationEnabled
          : Boolean(next.vibrationEnabled),
        vibrationSyncEnabled: next.vibrationSyncEnabled === undefined
          ? this.preferences.vibrationSyncEnabled
          : Boolean(next.vibrationSyncEnabled),
      };
      this.savePreferences();
      this.applyPreferencesToControls();
      this.queueBackendSave();
      if (!this.preferences.enabled && !this.preferences.vibrationEnabled) this.stop();
      if (!this.preferences.vibrationEnabled) this.stopVibration();
      return this.getPreferences();
    }

    ensureContext() {
      if (this.context && this.context.state !== "closed") return this.context;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
      return this.context;
    }

    async arm() {
      const context = this.ensureContext();
      if (!context) return false;
      try {
        if (context.state !== "running") await context.resume();
        this.armed = this.context === context && context.state === "running";
        return this.armed;
      } catch (_error) {
        this.armed = false;
        return false;
      }
    }

    disconnectNode(node) {
      try {
        node.disconnect();
      } catch (_error) {
        // The node may already be disconnected by the browser.
      }
      this.nodes.delete(node);
    }

    scheduleDisconnect(node, delayMs) {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        this.disconnectNode(node);
      }, Math.max(0, delayMs));
      this.timers.add(timer);
    }

    scheduleVoice(context, destination, frequency, startAt, duration, level, type) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const attack = Math.min(0.06, duration * 0.2);
      const release = Math.min(0.18, duration * 0.35);
      const endAt = startAt + duration;

      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), startAt + attack);
      gain.gain.setValueAtTime(Math.max(0.0002, level), Math.max(startAt + attack, endAt - release));
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gain).connect(destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.02);
      this.nodes.add(oscillator);
      this.nodes.add(gain);
      oscillator.addEventListener("ended", () => this.disconnectNode(oscillator), { once: true });
      this.scheduleDisconnect(gain, Math.max(0, (endAt - context.currentTime) * 1000 + 120));
    }

    scheduleCycle(startAt) {
      const context = this.context;
      if (!context || context.state !== "running" || !this.activeCallId) return false;
      const cycleEnd = startAt + (CYCLE_MS / 1000);
      const master = context.createGain();
      const appVolume = Math.max(0.0001, 0.24 * this.preferences.volume);
      master.gain.setValueAtTime(0.0001, startAt);
      master.gain.exponentialRampToValueAtTime(appVolume, startAt + 0.08);
      master.gain.setValueAtTime(appVolume, cycleEnd - 0.18);
      master.gain.exponentialRampToValueAtTime(0.0001, cycleEnd);
      master.connect(context.destination);
      this.nodes.add(master);

      CHORDS.forEach((chord, barIndex) => {
        for (let beatIndex = 0; beatIndex < BEATS_PER_BAR; beatIndex += 1) {
          const beatNumber = (barIndex * BEATS_PER_BAR) + beatIndex;
          const beatStart = startAt + ((beatNumber * BEAT_MS) / 1000);
          const accent = beatIndex === 0 ? 1 : 0.58;
          const available = Math.max(0.2, cycleEnd - beatStart - 0.02);
          const duration = Math.min(0.58, available);

          chord.forEach((frequency, noteIndex) => {
            const level = (noteIndex === 0 ? 0.10 : 0.065) * accent;
            this.scheduleVoice(
              context,
              master,
              frequency,
              beatStart,
              duration,
              level,
              noteIndex === 0 ? "triangle" : "sine",
            );
          });

          this.scheduleVoice(
            context,
            master,
            chord[0] * 2,
            beatStart,
            Math.min(0.48, available),
            0.12 * accent,
            "sine",
          );
          this.scheduleVoice(
            context,
            master,
            chord[2] * 2,
            beatStart + 0.015,
            Math.min(0.34, available),
            0.045 * accent,
            "sine",
          );
        }
      });

      this.scheduleDisconnect(master, Math.max(0, (cycleEnd - context.currentTime) * 1000 + 220));
      return true;
    }

    isCurrentRun(generation, callId) {
      return generation === this.generation && this.activeCallId === String(callId || "");
    }

    async scheduleNextCycle(generation, callId) {
      if (!this.isCurrentRun(generation, callId)) return false;
      const remaining = this.ringEndsAt - Date.now();
      if (remaining <= 0) {
        this.stop(callId);
        return false;
      }
      const context = this.ensureContext();
      if (!context) return false;
      try {
        if (context.state !== "running") await context.resume();
      } catch (_error) {
        return false;
      }
      if (!this.isCurrentRun(generation, callId) || this.context !== context) return false;
      const scheduled = this.scheduleCycle(context.currentTime + 0.04);
      if (scheduled && remaining > CYCLE_MS) {
        this.cycleTimer = window.setTimeout(() => {
          this.cycleTimer = null;
          this.scheduleNextCycle(generation, callId).catch(() => undefined);
        }, CYCLE_MS);
      }
      return scheduled;
    }

    startVibration() {
      this.stopVibration();
      if (!this.preferences.vibrationEnabled || typeof window.navigator?.vibrate !== "function") return false;
      const vibrate = () => {
        if (!this.activeCallId || !this.preferences.vibrationEnabled) return;
        try {
          window.navigator.vibrate(Array.from(VIBRATION_PATTERN));
        } catch (_error) {
          // iOS Safari and restricted Android contexts may not expose vibration.
        }
      };
      vibrate();
      if (this.preferences.vibrationSyncEnabled) {
        this.interval = window.setInterval(vibrate, CYCLE_MS);
      }
      return true;
    }

    stopVibration() {
      if (this.interval) window.clearInterval(this.interval);
      this.interval = null;
      if (typeof window.navigator?.vibrate === "function") {
        try {
          window.navigator.vibrate(0);
        } catch (_error) {
          // Vibration is best-effort and may be blocked by the operating system.
        }
      }
    }

    releaseContext() {
      const context = this.context;
      this.context = null;
      this.armed = false;
      if (!context || context.state === "closed") return;
      try {
        const closed = context.close();
        closed?.catch?.(() => {
          try { context.suspend?.(); } catch (_error) { /* noop */ }
        });
      } catch (_error) {
        try { context.suspend?.(); } catch (_ignored) { /* noop */ }
      }
    }

    clearPlayback() {
      if (this.deadline) window.clearTimeout(this.deadline);
      this.deadline = null;
      if (this.cycleTimer) window.clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
      this.ringEndsAt = 0;
      this.stopVibration();
      this.activeCallId = "";
      Array.from(this.timers).forEach((timer) => window.clearTimeout(timer));
      this.timers.clear();

      const nodes = Array.from(this.nodes);
      this.nodes.clear();
      nodes.forEach((node) => {
        try { node.stop?.(0); } catch (_error) { /* GainNodes and already-stopped sources are harmless. */ }
        try { node.disconnect(); } catch (_error) { /* The browser may already have disconnected it. */ }
      });
      this.releaseContext();
    }

    async start(callId, options = {}) {
      const normalizedCallId = String(callId || "").trim();
      if (!normalizedCallId) return false;
      if (this.activeCallId === normalizedCallId) return true;

      const generation = this.generation + 1;
      this.generation = generation;
      this.clearPlayback();

      await this.syncPromise?.catch(() => false);
      if (generation !== this.generation) return false;

      const soundEnabled = options.media === "video"
        ? this.preferences.videoEnabled
        : this.preferences.enabled;
      if (!soundEnabled && !this.preferences.vibrationEnabled) return false;

      this.activeCallId = normalizedCallId;
      const previewDuration = Number(options.maxDurationMs) === CYCLE_MS && options.preview === true;
      const duration = previewDuration
        ? CYCLE_MS
        : this.normalizeDuration(options.maxDurationMs || this.preferences.maxDurationMs);
      this.ringEndsAt = Date.now() + duration;

      const ready = soundEnabled ? await this.arm() : false;
      if (!this.isCurrentRun(generation, normalizedCallId)) return false;

      const audioStarted = ready
        ? await this.scheduleNextCycle(generation, normalizedCallId)
        : false;
      if (!this.isCurrentRun(generation, normalizedCallId)) return false;

      const vibrationStarted = this.startVibration();
      if (!audioStarted && !vibrationStarted) {
        this.stop(normalizedCallId);
        return false;
      }

      const remaining = Math.max(0, this.ringEndsAt - Date.now());
      this.deadline = window.setTimeout(() => this.stop(normalizedCallId), remaining);
      return true;
    }

    async preview() {
      await this.syncPromise?.catch(() => false);
      if (this.activeCallId && !this.activeCallId.startsWith("preview-")) return false;
      const previousEnabled = this.preferences.enabled;
      const previousVibration = this.preferences.vibrationEnabled;
      this.preferences.enabled = true;
      this.preferences.vibrationEnabled = true;
      const started = await this.start(`preview-${Date.now()}`, {
        maxDurationMs: CYCLE_MS,
        preview: true,
      });
      this.preferences.enabled = previousEnabled;
      this.preferences.vibrationEnabled = previousVibration;
      return started;
    }

    stop(callId = "") {
      if (callId && this.activeCallId && String(callId) !== this.activeCallId) return false;
      this.generation += 1;
      this.clearPlayback();
      return true;
    }

    async destroy() {
      if (this.saveTimer) window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.generation += 1;
      this.clearPlayback();
    }
  }

  IncomingCallRingtoneController.METADATA = RINGTONE_METADATA;
  IncomingCallRingtoneController.VIBRATION_PATTERN = VIBRATION_PATTERN;
  window.TIMEBLOCK_RINGTONE_METADATA = RINGTONE_METADATA;
  window.TIMEBLOCK_RINGTONE_VIBRATION_PATTERN = VIBRATION_PATTERN;
  window.IncomingCallRingtoneController = IncomingCallRingtoneController;
}());
