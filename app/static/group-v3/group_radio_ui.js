(function installGroupRadioUi(window) {
  "use strict";

  function panelControls(labels) {
    labels = labels || {};
    return '<div class="group-radio-translation-controls" role="group" aria-label="' + (labels.translation || "Radio translation") + '"><button type="button" class="icon-button" data-workspace-action="radio-translation-minus" aria-label="' +
      (labels.minus || "Collapse translation") + '">−</button><span data-radio-translation-mode>COLLAPSED</span><button type="button" class="icon-button" data-workspace-action="radio-translation-plus" aria-label="' +
      (labels.plus || "Expand translation") + '">+</button></div>';
  }

  window.GroupV3RadioUi = Object.freeze({ panelControls: panelControls });
}(window));
