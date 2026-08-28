(function installGroupTranslationTTSQueue(window) {
  "use strict";

  const safeText = (value, max = 4096) => {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized && normalized.length <= max ? normalized : "";
  };

  class GroupTranslationTTSQueue {
    constructor({ host, onState } = {}) {
      this.host = host || null;
      this.onState = onState;
      this.pending = [];
      this.seen = new Set();
      this.active = null;
      this.transmitting = false;
      this.disposed = false;
      this.pumping = false;
    }

    enqueue({ id, text, language, audio } = {}) {
      if (this.disposed || !audio) return false;
      const key = safeText(id, 256) || `${safeText(language, 16)}:${safeText(text)}`;
      if (!key || this.seen.has(key)) return false;
      this.seen.add(key);
      audio.autoplay = false;
      audio.playsInline = true;
      audio.dataset.groupTranslationTts = safeText(language, 16);
      if (this.host && !audio.parentNode) this.host.appendChild(audio);
      this.pending.push({ id: key, text: safeText(text), language: safeText(language, 16), audio });
      void this._pump();
      return true;
    }

    setTransmitting(value) {
      this.transmitting = Boolean(value);
      if (this.transmitting && this.active?.audio) {
        try { this.active.audio.pause(); } catch (_error) {}
        this.onState?.("PAUSED_TRANSMIT");
      } else if (!this.transmitting) {
        void this._pump();
      }
    }

    retry() {
      if (this.disposed) return;
      if (this.active?.audio && !this.transmitting) {
        void this.active.audio.play().then(() => this.onState?.("PLAYING")).catch(() => this.onState?.("AUTOPLAY_BLOCKED"));
        return;
      }
      if (!this.active) {
        void this._pump();
      }
    }

    async _pump() {
      if (this.pumping || this.disposed || this.transmitting || this.active) return;
      const item = this.pending.shift();
      if (!item) {
        this.onState?.("IDLE");
        return;
      }
      this.pumping = true;
      this.active = item;
      const audio = item.audio;
      const finish = () => {
        if (this.active?.id !== item.id) return;
        audio.removeEventListener?.("ended", finish);
        audio.removeEventListener?.("error", finish);
        try { audio.pause(); } catch (_error) {}
        try { audio.srcObject = null; } catch (_error) {}
        audio.remove?.();
        this.active = null;
        this.pumping = false;
        void this._pump();
      };
      audio.addEventListener?.("ended", finish, { once: true });
      audio.addEventListener?.("error", finish, { once: true });
      this.onState?.("PLAYING");
      try {
        await audio.play();
      } catch (_error) {
        // Keep the item active so the UI can retry after a user gesture.
        this.pumping = false;
        this.onState?.("AUTOPLAY_BLOCKED");
      }
    }

    stopActive() {
      if (!this.active) return;
      const item = this.active;
      try { item.audio.pause(); } catch (_error) {}
      try { item.audio.srcObject = null; } catch (_error) {}
      item.audio.remove?.();
      this.active = null;
      this.pumping = false;
      void this._pump();
    }

    remove(audio) {
      if (!audio) return;
      if (this.active?.audio === audio) this.stopActive();
      const kept = [];
      for (const item of this.pending) {
        if (item.audio !== audio) {
          kept.push(item);
          continue;
        }
        try { item.audio.pause(); } catch (_error) {}
        try { item.audio.srcObject = null; } catch (_error) {}
        item.audio.remove?.();
        this.seen.delete(item.id);
      }
      this.pending = kept;
    }

    clear() {
      this.stopActive();
      for (const item of this.pending.splice(0)) {
        try { item.audio.pause(); } catch (_error) {}
        try { item.audio.srcObject = null; } catch (_error) {}
        item.audio.remove?.();
      }
      this.seen.clear();
      this.onState?.("IDLE");
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.clear();
      this.host = null;
    }
  }

  window.GroupTranslationTTSQueue = Object.freeze({
    create: (options) => new GroupTranslationTTSQueue(options),
  });
}(window));
