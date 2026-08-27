(function (root) {
  "use strict";
  const kit = root.TimeblockLiveTranslateHotfixKit;
  if (kit?.installMedia) kit.installMedia(root.TimeblockLiveTranslate || null);
}(typeof window !== "undefined" ? window : globalThis));
