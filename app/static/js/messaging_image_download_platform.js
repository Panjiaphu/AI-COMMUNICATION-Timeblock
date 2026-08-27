(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const MOBILE_QUERY = window.matchMedia(
    "(max-width: 760px), (max-height: 500px) and (max-width: 900px)",
  );
  const PREPARATION_DEADLINE_MS = 8000;
  const IMAGE_EXTENSIONS = Object.freeze({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  });
  const COPY = {
    vi: {
      saveShare: "Lưu / Chia sẻ", download: "Tải xuống", preparing: "Đang chuẩn bị ảnh…",
      unavailable: "Ảnh không còn khả dụng hoặc bạn không có quyền truy cập.", expired: "Ảnh này đã hết hạn.",
      retry: "Không thể chuẩn bị ảnh. Vui lòng thử lại.",
      externalCopyWarning: "Bản ảnh bạn lưu hoặc chia sẻ ra ngoài Timeblock sẽ không bị Timeblock tự động xóa.",
      downloadSavedWarning: "Bản ảnh đã tải xuống thiết bị sẽ không bị Timeblock tự động xóa.",
      longPressFallback: "Trình duyệt này chưa hỗ trợ chia sẻ tệp. Nhấn giữ ảnh rồi chọn “Lưu hình ảnh”.",
      downloadFallback: "Trình duyệt này chưa hỗ trợ chia sẻ tệp. Tải xuống là phương án dự phòng.",
      systemComplete: "Đã hoàn tất thao tác hệ thống.", systemCancelled: "Đã hủy thao tác hệ thống.",
      downloadStarted: "Đã bắt đầu tải xuống.",
    },
    en: {
      saveShare: "Save / Share", download: "Download", preparing: "Preparing image…",
      unavailable: "The image is unavailable or you are not authorized to access it.", expired: "This image has expired.",
      retry: "The image could not be prepared. Please try again.",
      externalCopyWarning: "A copy you save or share outside Timeblock will not be automatically deleted by Timeblock.",
      downloadSavedWarning: "A copy downloaded to your device will not be automatically deleted by Timeblock.",
      longPressFallback: "This browser cannot share image files. Press and hold the image, then choose Save Image.",
      downloadFallback: "This browser cannot share image files. Download is available as a fallback.",
      systemComplete: "The system action completed.", systemCancelled: "The system action was cancelled.",
      downloadStarted: "The download has started.",
    },
    "zh-TW": {
      saveShare: "儲存 / 分享", download: "下載", preparing: "正在準備圖片…",
      unavailable: "圖片已無法取得，或您沒有存取權限。", expired: "此圖片已過期。", retry: "無法準備圖片，請再試一次。",
      externalCopyWarning: "您儲存或分享到 Timeblock 之外的圖片副本，不會由 Timeblock 自動刪除。",
      downloadSavedWarning: "下載到裝置的圖片副本不會由 Timeblock 自動刪除。",
      longPressFallback: "此瀏覽器不支援分享圖片檔案。請長按圖片，然後選擇「儲存影像」。",
      downloadFallback: "此瀏覽器不支援分享圖片檔案。可改用下載作為備用方式。",
      systemComplete: "系統操作已完成。", systemCancelled: "已取消系統操作。", downloadStarted: "已開始下載。",
    },
  };
  const copy = COPY[String(app.dataset.locale || "vi")] || COPY.en;
  const state = {
    attachmentId: "", blob: null, file: null, downloadName: "", mode: "", phase: "idle",
    controller: null, serial: 0,
  };

  function isIOSLike() {
    const ua = String(window.navigator?.userAgent || "");
    return /iPad|iPhone|iPod/i.test(ua)
      || (String(window.navigator?.platform || "") === "MacIntel" && Number(window.navigator?.maxTouchPoints || 0) > 1);
  }
  function isAndroidLike() { return /Android/i.test(String(window.navigator?.userAgent || "")); }
  function isMobileExportContext() { return MOBILE_QUERY.matches || isIOSLike() || isAndroidLike(); }
  function hasFileShareApi() {
    return typeof window.navigator?.share === "function" && typeof window.navigator?.canShare === "function";
  }

  function canonicalDownloadUrl(viewer) {
    const attachmentId = String(viewer?.dataset.attachmentId || "").trim();
    if (!/^\d+$/.test(attachmentId)) return "";
    const builder = window.TimeblockMessagingMobile?.buildMessagingDownloadUrl;
    const relative = typeof builder === "function"
      ? builder(attachmentId)
      : `/api/messaging/media/${encodeURIComponent(attachmentId)}/download`;
    try {
      const url = new URL(relative, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== `/api/messaging/media/${attachmentId}/download`) return "";
      return url.href;
    } catch (_error) { return ""; }
  }

  function feedback(viewer, message, isError = false) {
    const target = viewer?.querySelector(".messaging-mobile-image-feedback");
    if (!target) return;
    target.textContent = message || "";
    target.hidden = !message;
    target.setAttribute("role", isError ? "alert" : "status");
    target.setAttribute("aria-live", isError ? "assertive" : "polite");
  }
  function exportButton(viewer) { return viewer?.querySelector(".messaging-mobile-image-download") || null; }
  function setButton(viewer, label, disabled = false, hidden = false) {
    const button = exportButton(viewer);
    if (!button) return;
    button.textContent = label;
    button.disabled = disabled;
    button.hidden = hidden;
  }
  function locallyExpired(viewer) {
    const value = Date.parse(String(viewer?.dataset.expiresAt || ""));
    return Number.isFinite(value) && value <= Date.now();
  }
  function cleanupPreparedFile(viewer, { restoreButton = true } = {}) {
    state.serial += 1;
    state.controller?.abort();
    state.controller = null;
    state.attachmentId = "";
    state.blob = null;
    state.file = null;
    state.downloadName = "";
    state.mode = "";
    state.phase = "idle";
    if (restoreButton) setButton(viewer, copy.download, false, false);
  }
  function abortError() {
    try { return new DOMException("Image export preparation aborted", "AbortError"); }
    catch (_error) { const error = new Error("Image export preparation aborted"); error.name = "AbortError"; return error; }
  }

  function restoreViewerScroll(options) {
    window.TimeblockMessagingImageViewerScrollGuard?.restore(options);
  }
  function canShareFile(file) {
    if (!file || !hasFileShareApi()) return false;
    try { return Boolean(window.navigator.canShare({ files: [file] })); }
    catch (_error) { return false; }
  }
  function allowedMime(type) {
    const normalized = String(type || "").toLowerCase().split(";", 1)[0].trim();
    return Object.hasOwn(IMAGE_EXTENSIONS, normalized) ? normalized : "";
  }
  function sourceFileFromBlob(blob, attachmentId) {
    const mime = allowedMime(blob?.type);
    if (!blob?.size || !mime) return null;
    const extension = IMAGE_EXTENSIONS[mime];
    return new File(
      [blob],
      `timeblock-image-${attachmentId}.${extension}`,
      { type: mime, lastModified: Date.now() },
    );
  }
  function fallbackMessage() {
    return isIOSLike() ? `${copy.longPressFallback} ${copy.downloadFallback}` : copy.downloadFallback;
  }
  function enterDownloadMode(viewer, blob, downloadName) {
    state.blob = blob;
    state.file = null;
    state.downloadName = downloadName;
    state.mode = "download";
    state.phase = "ready";
    setButton(viewer, copy.download, false, false);
    feedback(viewer, fallbackMessage(), false);
    restoreViewerScroll();
  }
  function enterShareMode(viewer, sourceBlob, sourceDownloadName, shareFile) {
    state.blob = sourceBlob;
    state.file = shareFile;
    state.downloadName = sourceDownloadName;
    state.mode = "share";
    state.phase = "ready";
    setButton(viewer, copy.saveShare, false, false);
    feedback(viewer, String(viewer.dataset.expiresAt || "").trim() ? copy.externalCopyWarning : "", false);
    restoreViewerScroll();
  }

  function waitForImage(image, objectUrl, signal) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return;
        done = true;
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, abortError());
      image.onload = () => finish(resolve, image);
      image.onerror = () => finish(reject, new Error("image_decode_failed"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      else image.src = objectUrl;
    });
  }
  function canvasToBlob(canvas, signal) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      canvas.toBlob((blob) => {
        if (signal.aborted) {
          onAbort();
          return;
        }
        if (!blob?.size) {
          finish(reject, new Error("image_encode_failed"));
          return;
        }
        finish(resolve, blob);
      }, "image/jpeg", 0.92);
    });
  }
  async function compatibilityJpeg(blob, signal, setPhase) {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    try {
      setPhase("decoding");
      await waitForImage(image, objectUrl, signal);
      if (signal.aborted) throw abortError();
      const width = Number(image.naturalWidth || image.width || 0);
      const height = Number(image.naturalHeight || image.height || 0);
      if (!width || !height) throw new Error("image_decode_failed");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(image, 0, 0, width, height);
      setPhase("encoding");
      return await canvasToBlob(canvas, signal);
    } finally {
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    }
  }

  function isCurrentPreparation(viewer, attempt) {
    return Boolean(
      viewer?.hasAttribute("open")
      && state.serial === attempt.serial
      && state.controller === attempt.controller
      && state.attachmentId === attempt.attachmentId
      && String(viewer.dataset.attachmentId || "").trim() === attempt.attachmentId
    );
  }
  function setPreparationPhase(viewer, attempt, phase) {
    if (!isCurrentPreparation(viewer, attempt)) throw abortError();
    state.phase = phase;
  }

  async function prepareExportFile(viewer) {
    cleanupPreparedFile(viewer, { restoreButton: false });
    if (!viewer?.hasAttribute("open") || !isMobileExportContext()) return false;
    const url = canonicalDownloadUrl(viewer);
    const attachmentId = String(viewer.dataset.attachmentId || "").trim();
    if (!url || !attachmentId) {
      setButton(viewer, copy.saveShare, true, true);
      feedback(viewer, copy.unavailable, true);
      restoreViewerScroll();
      return false;
    }
    if (locallyExpired(viewer)) {
      state.phase = "error";
      setButton(viewer, copy.saveShare, true, false);
      feedback(viewer, copy.expired, true);
      restoreViewerScroll();
      return false;
    }

    const controller = new AbortController();
    const attempt = {
      attachmentId,
      controller,
      serial: state.serial,
      timedOut: false,
    };
    let sourceBlob = null;
    let sourceFile = null;
    state.controller = controller;
    state.attachmentId = attachmentId;
    state.phase = "loading";
    setButton(viewer, copy.preparing, true, false);
    feedback(viewer, copy.preparing, false);
    const deadlineTimer = window.setTimeout(() => {
      if (!isCurrentPreparation(viewer, attempt)) return;
      attempt.timedOut = true;
      controller.abort();
    }, PREPARATION_DEADLINE_MS);

    try {
      const response = await fetch(url, {
        method: "GET", credentials: "same-origin", cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" }, signal: controller.signal,
      });
      if (!isCurrentPreparation(viewer, attempt)) throw abortError();
      if (response.status === 404) {
        state.phase = "error";
        setButton(viewer, copy.saveShare, true, false);
        feedback(viewer, copy.unavailable, true);
        restoreViewerScroll();
        return false;
      }
      if (response.status === 410) {
        state.phase = "error";
        setButton(viewer, copy.saveShare, true, false);
        feedback(viewer, copy.expired, true);
        restoreViewerScroll();
        return false;
      }
      if (!response.ok) throw new Error(`image_export_http_${response.status}`);

      sourceBlob = await response.blob();
      if (!isCurrentPreparation(viewer, attempt)) throw abortError();
      sourceFile = sourceFileFromBlob(sourceBlob, attachmentId);
      if (!sourceFile) throw new Error("image_export_invalid_type");
      state.blob = sourceBlob;
      state.downloadName = sourceFile.name;

      if (!hasFileShareApi()) {
        enterDownloadMode(viewer, sourceBlob, sourceFile.name);
        return true;
      }
      if (canShareFile(sourceFile)) {
        enterShareMode(viewer, sourceBlob, sourceFile.name, sourceFile);
        return true;
      }

      try {
        const jpegBlob = await compatibilityJpeg(
          sourceBlob,
          controller.signal,
          (phase) => setPreparationPhase(viewer, attempt, phase),
        );
        if (!isCurrentPreparation(viewer, attempt)) throw abortError();
        const jpegFile = new File(
          [jpegBlob],
          `timeblock-image-${attachmentId}.jpg`,
          { type: "image/jpeg", lastModified: Date.now() },
        );
        if (canShareFile(jpegFile)) {
          enterShareMode(viewer, sourceBlob, sourceFile.name, jpegFile);
          return true;
        }
      } catch (conversionError) {
        if (!isCurrentPreparation(viewer, attempt)) throw conversionError;
        if (conversionError?.name === "AbortError" && !attempt.timedOut) throw conversionError;
      }

      if (!isCurrentPreparation(viewer, attempt)) throw abortError();
      enterDownloadMode(viewer, sourceBlob, sourceFile.name);
      return true;
    } catch (error) {
      if (!isCurrentPreparation(viewer, attempt)) return false;
      if (attempt.timedOut && sourceBlob && sourceFile) {
        enterDownloadMode(viewer, sourceBlob, sourceFile.name);
        return true;
      }
      if (error?.name === "AbortError" || controller.signal.aborted) {
        if (!viewer.hasAttribute("open")) return false;
        state.phase = "error";
        setButton(viewer, copy.saveShare, false, false);
        feedback(viewer, copy.retry, true);
        restoreViewerScroll();
        return false;
      }
      state.phase = "error";
      setButton(viewer, copy.saveShare, false, false);
      feedback(viewer, copy.retry, true);
      restoreViewerScroll();
      return false;
    } finally {
      window.clearTimeout(deadlineTimer);
      if (state.controller === controller) state.controller = null;
    }
  }

  function isCurrentShare(viewer, snapshot) {
    return Boolean(
      viewer?.hasAttribute("open")
      && state.serial === snapshot.serial
      && state.attachmentId === snapshot.attachmentId
      && state.file === snapshot.file
      && String(viewer.dataset.attachmentId || "").trim() === snapshot.attachmentId
    );
  }
  function fallbackAfterShareFailure(viewer) {
    if (!state.blob) return false;
    state.file = null;
    state.mode = "download";
    setButton(viewer, copy.download, false, false);
    feedback(viewer, fallbackMessage(), false);
    restoreViewerScroll();
    return true;
  }
  function triggerSystemShare(viewer) {
    if (state.phase !== "ready" || state.mode !== "share" || !state.file) return false;
    const snapshot = {
      attachmentId: state.attachmentId,
      file: state.file,
      serial: state.serial,
    };
    let result;
    try {
      result = window.navigator.share({ files: [snapshot.file] });
    } catch (_error) {
      if (isCurrentShare(viewer, snapshot)) fallbackAfterShareFailure(viewer);
      return true;
    }
    if (!result || typeof result.then !== "function") {
      if (isCurrentShare(viewer, snapshot)) fallbackAfterShareFailure(viewer);
      return true;
    }
    result.then(
      () => {
        if (!isCurrentShare(viewer, snapshot)) return;
        restoreViewerScroll();
        feedback(viewer, copy.systemComplete, false);
      },
      (error) => {
        if (!isCurrentShare(viewer, snapshot)) return;
        restoreViewerScroll();
        if (error?.name === "AbortError") feedback(viewer, copy.systemCancelled, false);
        else fallbackAfterShareFailure(viewer);
      },
    );
    return true;
  }
  function triggerPreparedDownload(viewer) {
    if (state.phase !== "ready" || state.mode !== "download" || !state.blob) return false;
    const objectUrl = URL.createObjectURL(state.blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = state.downloadName || `timeblock-image-${state.attachmentId}`;
    anchor.rel = "noopener";
    anchor.setAttribute("aria-hidden", "true");
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    feedback(viewer, `${copy.downloadStarted} ${copy.downloadSavedWarning}`, false);
    restoreViewerScroll();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  }

  function getExportState() {
    return Object.freeze({
      attachmentId: state.attachmentId,
      mode: state.mode,
      phase: state.phase,
      hasBlob: Boolean(state.blob),
      hasFile: Boolean(state.file),
      fileType: String(state.file?.type || ""),
      serial: state.serial,
    });
  }
  function syncViewer(viewer) {
    if (!viewer) return;
    if (!viewer.hasAttribute("open") || !isMobileExportContext()) {
      cleanupPreparedFile(viewer);
      return;
    }
    const attachmentId = String(viewer.dataset.attachmentId || "").trim();
    if (
      attachmentId
      && attachmentId === state.attachmentId
      && ["loading", "decoding", "encoding", "ready"].includes(state.phase)
    ) return;
    prepareExportFile(viewer);
  }

  document.addEventListener("click", (event) => {
    if (!isMobileExportContext()) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(".messaging-mobile-image-download");
    if (!button || button.hidden || button.disabled) return;
    const viewer = button.closest(".messaging-mobile-image-viewer");
    if (!viewer?.hasAttribute("open")) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (state.phase !== "ready") { prepareExportFile(viewer); return; }
    if (state.mode === "share") { triggerSystemShare(viewer); return; }
    if (state.mode === "download") triggerPreparedDownload(viewer);
  }, true);

  const viewer = document.querySelector(".messaging-mobile-image-viewer");
  if (viewer) {
    const observer = new MutationObserver(() => syncViewer(viewer));
    observer.observe(viewer, {
      attributes: true,
      attributeFilter: ["open", "data-attachment-id", "data-expires-at"],
    });
    if (viewer.hasAttribute("open")) syncViewer(viewer);
  }

  window.TimeblockMessagingImageDownloadPlatform = Object.freeze({
    canShareFile, canonicalDownloadUrl, cleanupPreparedFile, getExportState,
    isAndroidLike, isIOSLike, isMobileExportContext, prepareExportFile,
    preparationDeadlineMs: PREPARATION_DEADLINE_MS,
    triggerPreparedDownload, triggerSystemShare,
  });
}());
