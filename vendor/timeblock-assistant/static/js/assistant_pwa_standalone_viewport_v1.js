(() => {
  "use strict";

  const STANDALONE_CLASS = "assistant-pwa-standalone";
  const KEYBOARD_CLASS = "is-keyboard-open";
  const EDITABLE_SELECTOR = [
    "textarea",
    "[contenteditable='true']",
    "input:not([type])",
    "input[type='text']",
    "input[type='search']",
    "input[type='email']",
    "input[type='url']",
    "input[type='tel']",
    "input[type='password']",
    "input[type='number']",
  ].join(",");

  const isStandalone = () => document.body?.classList.contains(STANDALONE_CLASS) === true;
  const hasEditableFocus = () => {
    const active = document.activeElement;
    return Boolean(active?.matches?.(EDITABLE_SELECTOR));
  };

  const restoreClosedKeyboardLayout = () => {
    if (!isStandalone() || hasEditableFocus()) return false;
    document.body.classList.remove(KEYBOARD_CLASS);
    document.body.style.setProperty("--assistant-keyboard-height", "0px");
    return true;
  };

  let restoreFrame = 0;
  const scheduleRestore = () => {
    if (!isStandalone()) return;
    if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = 0;
        restoreClosedKeyboardLayout();
      });
    });
  };

  document.addEventListener("focusout", scheduleRestore);
  window.addEventListener("orientationchange", scheduleRestore, { passive: true });
  window.addEventListener("pageshow", scheduleRestore, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleRestore();
  });

  window.TimeblockAssistantStandaloneViewportV1 = Object.freeze({
    restoreClosedKeyboardLayout,
    scheduleRestore,
  });
})();
