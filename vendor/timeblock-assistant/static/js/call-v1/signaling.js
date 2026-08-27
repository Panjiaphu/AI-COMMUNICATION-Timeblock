(() => {
  "use strict";

  const root = globalThis;
  const namespace = root.TimeblockCallV1 || {};

  function createRequestId() {
    try {
      return root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    } catch (_error) {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function isUsableIceCandidate(candidate) {
    return Boolean(candidate && typeof candidate === "object" && String(candidate.candidate || "").trim());
  }

  class CallV1Signaling {
    constructor({
      session = null,
      fetcher = root.fetch?.bind(root),
      basePath = "/api/messaging",
      timeoutMs = 10000,
      onTelemetry = null,
    } = {}) {
      if (typeof fetcher !== "function") throw new TypeError("call-v1.signaling-fetch-required");
      this.session = session;
      this.fetcher = fetcher;
      this.basePath = String(basePath).replace(/\/$/, "");
      this.timeoutMs = Math.max(25, Number(timeoutMs) || 10000);
      this.onTelemetry = typeof onTelemetry === "function" ? onTelemetry : null;
      this._requests = new Set();
    }

    async request(
      path,
      options = {},
      generation = this.session?.callbackToken(),
      telemetry = {},
      requestSettings = {},
    ) {
      if (this.session && generation !== null && !this.session.isCurrent(generation)) {
        throw new Error("call-v1.stale-generation");
      }
      const requestId = createRequestId();
      const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
      const requestEntry = controller
        ? { controller, terminal: Boolean(requestSettings.terminal) }
        : null;
      if (requestEntry) this._requests.add(requestEntry);
      let timedOut = false;
      const timeoutMs = Math.max(25, Number(requestSettings.timeoutMs) || this.timeoutMs);
      const timer = controller
        ? root.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
        : null;
      const requestOptions = {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        signal: options.signal || controller?.signal,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Timeblock-Call-V1-Request-ID": requestId,
          ...(options.headers || {}),
        },
      };
      try {
        const response = await this.fetcher(`${this.basePath}${path}`, requestOptions);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error || `HTTP ${response.status}`);
          error.status = response.status;
          this.onTelemetry?.({
            event: "signaling_error",
            request_id: requestId,
            call_id: telemetry.callId || "",
            kind: telemetry.kind || telemetry.action || "",
            http_status: response.status,
          });
          throw error;
        }
        if (this.session && generation !== null && !this.session.isCurrent(generation)) {
          throw new Error("call-v1.stale-generation");
        }
        return payload;
      } catch (error) {
        if (timedOut) {
          const timeoutError = new Error("call-v1.signaling-timeout");
          timeoutError.code = "call-v1.signaling-timeout";
          timeoutError.status = 408;
          this.onTelemetry?.({
            event: "signaling_timeout",
            request_id: requestId,
            call_id: telemetry.callId || "",
            kind: telemetry.kind || telemetry.action || "",
            http_status: 408,
          });
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timer) root.clearTimeout(timer);
        if (requestEntry) this._requests.delete(requestEntry);
      }
    }

    abortAll({ includeTerminal = false } = {}) {
      let aborted = 0;
      for (const entry of Array.from(this._requests)) {
        if (!includeTerminal && entry.terminal) continue;
        if (entry.controller.signal?.aborted) continue;
        try {
          entry.controller.abort();
          aborted += 1;
        } catch (_error) {
          // Abort is best effort; local call cleanup must continue.
        }
      }
      return aborted;
    }

    close() {
      return this.abortAll({ includeTerminal: true });
    }

    getIceServers(generation) {
      return this.request("/ice-servers", {}, generation);
    }

    create(conversationId, media, offer, generation) {
      return this.request(`/conversations/${encodeURIComponent(conversationId)}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media, offer }),
      }, generation);
    }

    get(callId, generation) {
      return this.request(`/calls/${encodeURIComponent(callId)}`, {}, generation);
    }

    heartbeat(callId, generation) {
      return this.request(`/calls/${encodeURIComponent(callId)}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, generation);
    }

    answer(callId, answer, generation) {
      return this.request(`/calls/${encodeURIComponent(callId)}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "answer", payload: answer }),
      }, generation, { callId, kind: "answer" });
    }

    sendIce(callId, candidate, generation) {
      if (!isUsableIceCandidate(candidate)) {
        const error = new Error("call-v1.invalid-ice-candidate");
        error.code = "call-v1.invalid-ice-candidate";
        return Promise.reject(error);
      }
      return this.request(`/calls/${encodeURIComponent(callId)}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ice", payload: { candidate } }),
      }, generation, { callId, kind: "ice" });
    }

    action(callId, action, generation = null, { timeoutMs = this.timeoutMs, keepalive = false } = {}) {
      return this.request(`/calls/${encodeURIComponent(callId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        keepalive: Boolean(keepalive),
      }, generation, { callId, action }, { terminal: true, timeoutMs });
    }

    reject(callId, generation) {
      return this.action(callId, "reject", generation);
    }

    cancel(callId, generation) {
      return this.action(callId, "cancel", generation);
    }

    end(callId, generation = null) {
      return this.action(callId, "end", generation);
    }
  }

  namespace.CallV1Signaling = CallV1Signaling;
  root.TimeblockCallV1 = namespace;
})();
