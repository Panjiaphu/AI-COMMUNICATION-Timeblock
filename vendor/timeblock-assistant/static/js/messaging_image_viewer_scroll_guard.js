(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const MOBILE_QUERY = window.matchMedia(
    "(max-width: 760px), (max-height: 500px) and (max-width: 900px)",
  );
  let savedScrollTop = null;
  let captureSerial = 0;
  let restoreSerial = 0;

  function timeline() {
    return app.querySelector("[data-thread-messages]");
  }

  function isIOSLike() {
    const ua = String(window.navigator?.userAgent || "");
    return /iPad|iPhone|iPod/i.test(ua)
      || (String(window.navigator?.platform || "") === "MacIntel" && Number(window.navigator?.maxTouchPoints || 0) > 1);
  }

  function isAndroidLike() {
    return /Android/i.test(String(window.navigator?.userAgent || ""));
  }

  function isMobileContext() {
    return MOBILE_QUERY.matches || isIOSLike() || isAndroidLike();
  }

  function isImageTarget(target) {
    return Boolean(target?.closest?.("figure.assistant-thread-image img"));
  }

  function capture() {
    if (!isMobileContext()) return;
    const node = timeline();
    if (!node) return;
    captureSerial += 1;
    restoreSerial += 1;
    savedScrollTop = Number(node.scrollTop || 0);
  }

  function restore({ clear = false } = {}) {
    if (!Number.isFinite(savedScrollTop)) return;
    const node = timeline();
    if (!node) {
      if (clear) savedScrollTop = null;
      return;
    }
    const expected = savedScrollTop;
    const captureGeneration = captureSerial;
    const serial = ++restoreSerial;
    const apply = () => {
      if (serial !== restoreSerial || captureGeneration !== captureSerial) return;
      node.scrollTop = expected;
    };
    apply();
    window.requestAnimationFrame(() => {
      apply();
      window.requestAnimationFrame(() => {
        apply();
        if (clear && serial === restoreSerial && captureGeneration === captureSerial) {
          savedScrollTop = null;
        }
      });
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!isMobileContext()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (isImageTarget(target)) capture();
  }, true);

  const viewer = document.querySelector(".messaging-mobile-image-viewer");
  if (!viewer) return;

  const observer = new MutationObserver(() => {
    if (viewer.hasAttribute("open")) restore();
    else restore({ clear: true });
  });
  observer.observe(viewer, { attributes: true, attributeFilter: ["open"] });

  viewer.addEventListener("close", () => restore({ clear: true }));

  window.TimeblockMessagingImageViewerScrollGuard = Object.freeze({
    capture,
    restore,
    isMobileContext,
    getSavedScrollTop: () => savedScrollTop,
  });
}());
