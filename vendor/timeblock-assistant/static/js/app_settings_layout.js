(function () {
  const root = document.getElementById("app-settings");
  const header = document.querySelector("[data-header]");
  if (!root || !header) return;

  let frame = 0;

  function syncHeaderOffset() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      const headerBottom = Math.max(0, Math.ceil(header.getBoundingClientRect().bottom));
      document.body.style.setProperty("--app-settings-header-offset", `${headerBottom}px`);
    });
  }

  const resizeObserver = "ResizeObserver" in window
    ? new ResizeObserver(syncHeaderOffset)
    : null;

  resizeObserver?.observe(header);
  window.addEventListener("resize", syncHeaderOffset, { passive: true });
  window.addEventListener("orientationchange", syncHeaderOffset, { passive: true });
  window.visualViewport?.addEventListener("resize", syncHeaderOffset, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncHeaderOffset, { passive: true });
  document.fonts?.ready.then(syncHeaderOffset).catch(() => {});

  syncHeaderOffset();

  window.addEventListener("pagehide", () => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", syncHeaderOffset);
    window.removeEventListener("orientationchange", syncHeaderOffset);
    window.visualViewport?.removeEventListener("resize", syncHeaderOffset);
    window.visualViewport?.removeEventListener("scroll", syncHeaderOffset);
  }, { once: true });
})();
