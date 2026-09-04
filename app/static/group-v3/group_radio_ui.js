(function installGroupRadioUi(window) {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name, size) {
    if (typeof window.GroupV3Icon === "function") return window.GroupV3Icon(name, size || 19);
    var path = name === "plus" ? '<path d="M12 5v14M5 12h14"/>' : '<path d="M5 12h14"/>';
    return '<svg class="ui-icon ui-icon-fallback" width="' + (size || 19) + '" height="' + (size || 19) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + path + '</svg>';
  }

  function panelControls(labels) {
    labels = labels || {};
    return '<div class="group-radio-translation-controls panel-resize-controls" role="group" aria-label="' + esc(labels.translation || "Radio translation") + '">' +
      '<button type="button" class="icon-button" data-workspace-action="radio-translation-minus" aria-label="' + esc(labels.minus || "Collapse translation") + '" title="' + esc(labels.minus || "Collapse translation") + '">' + icon("minus", 19) + '</button>' +
      '<span data-radio-translation-mode-label>COLLAPSED</span>' +
      '<button type="button" class="icon-button" data-workspace-action="radio-translation-plus" aria-label="' + esc(labels.plus || "Expand translation") + '" title="' + esc(labels.plus || "Expand translation") + '">' + icon("plus", 19) + '</button>' +
      '</div>';
  }

  window.GroupV3RadioUi = Object.freeze({ panelControls: panelControls });
}(window));
