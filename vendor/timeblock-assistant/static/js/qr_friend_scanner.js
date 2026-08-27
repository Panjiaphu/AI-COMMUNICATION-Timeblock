(function () {
  "use strict";


  class TimeblockQrScanner {
    constructor(options = {}) {
      this.video = options.video || null;
      this.scanIntervalMs = Math.max(200, Number(options.scanIntervalMs) || 320);
      this.onValue = typeof options.onValue === "function" ? options.onValue : () => {};
      this.stream = null;
      this.detector = null;
      this.timer = null;
      this.scanning = false;
      this.canvas = document.createElement("canvas");
      this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    }

    async prepareNativeDetector() {
      if (!("BarcodeDetector" in window)) return null;
      const formats = typeof window.BarcodeDetector.getSupportedFormats === "function"
        ? await window.BarcodeDetector.getSupportedFormats()
        : ["qr_code"];
      if (!formats.includes("qr_code")) return null;
      if (!this.detector) this.detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      return this.detector;
    }

    hasFallbackDecoder() {
      return typeof window.jsQR === "function" && Boolean(this.context);
    }

    drawSource(source, width, height) {
      if (!this.context || !width || !height) return null;
      const maxEdge = 960;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this.context.drawImage(source, 0, 0, targetWidth, targetHeight);
      return this.context.getImageData(0, 0, targetWidth, targetHeight);
    }

    async decode(source, width, height) {
      const nativeDetector = await this.prepareNativeDetector().catch(() => null);
      if (nativeDetector) {
        const codes = await nativeDetector.detect(source);
        if (codes && codes[0] && codes[0].rawValue) return String(codes[0].rawValue);
      }
      if (!this.hasFallbackDecoder()) return "";
      const imageData = this.drawSource(source, width, height);
      if (!imageData) return "";
      const result = window.jsQR(
        imageData.data,
        imageData.width,
        imageData.height,
        { inversionAttempts: "attemptBoth" },
      );
      return result && result.data ? String(result.data) : "";
    }

    scheduleNextFrame() {
      if (!this.scanning) return;
      this.timer = window.setTimeout(() => this.scanVideoFrame(), this.scanIntervalMs);
    }

    async scanVideoFrame() {
      if (!this.scanning || !this.video || !this.stream) return;
      try {
        if (this.video.readyState >= 2) {
          const value = await this.decode(
            this.video,
            this.video.videoWidth,
            this.video.videoHeight,
          );
          if (value) {
            this.stop();
            await this.onValue(value);
            return;
          }
        }
      } catch (_error) {
        // Autofocus and exposure changes can temporarily make a frame unreadable.
      }
      this.scheduleNextFrame();
    }

    async startCamera() {
      if (!this.video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const error = new Error("qr-unsupported");
        error.name = "NotSupportedError";
        throw error;
      }
      const nativeDetector = await this.prepareNativeDetector().catch(() => null);
      if (!nativeDetector && !this.hasFallbackDecoder()) {
        const error = new Error("qr-unsupported");
        error.name = "NotSupportedError";
        throw error;
      }
      this.stop();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.scanning = true;
      this.scheduleNextFrame();
    }

    async decodeFile(file) {
      if (!file || !file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) {
        throw new Error("qr-invalid-file");
      }
      if (!("createImageBitmap" in window)) throw new Error("qr-unsupported");
      const bitmap = await createImageBitmap(file);
      try {
        return await this.decode(bitmap, bitmap.width, bitmap.height);
      } finally {
        if (typeof bitmap.close === "function") bitmap.close();
      }
    }

    stop() {
      this.scanning = false;
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = null;
      if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      if (this.video) {
        this.video.pause();
        this.video.srcObject = null;
      }
      this.canvas.width = 1;
      this.canvas.height = 1;
    }

    destroy() {
      this.stop();
      this.detector = null;
      this.context = null;
      this.canvas.remove();
    }
  }

  window.TimeblockQrScanner = TimeblockQrScanner;
}());
