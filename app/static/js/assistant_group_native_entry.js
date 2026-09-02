(function assistantGroupNativeEntry(window, document) {
  "use strict";

  const allowedSurfaces = new Set(["chat", "call", "video", "radio"]);

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-group-launch]")
      : null;
    if (!button || !button.closest("[data-group-launcher-v3]")) return;

    const surface = String(button.dataset.groupLaunch || "").toLowerCase();
    const targetPath = allowedSurfaces.has(surface) ? `/group/${surface}` : "/group";

    event.preventDefault();
    event.stopImmediatePropagation();
    const target = new URL(targetPath, window.location.origin);
    target.searchParams.set("lang", document.documentElement.lang || "vi");
    window.location.assign(target.href);
  }, true);
}(window, document));
