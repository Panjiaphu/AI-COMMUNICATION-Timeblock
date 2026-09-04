(function installGroupTranslationView(window) {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function languageOptions(selected, labels) {
    return ["vi", "en", "zh-TW"].map(function (language) {
      return '<option value="' + language + '" ' + (language === selected ? "selected" : "") + ">" +
        esc((labels && labels[language]) || language) + "</option>";
    }).join("");
  }

  function panel(options) {
    options = options || {};
    var labels = options.labels || {};
    return '<section class="group-translation-v2" aria-labelledby="group-translation-v2-title">' +
      '<div class="group-translation-v2__header"><div><span class="group-translation-v2__eyebrow">' +
      esc(options.title || "Group Translation") + '</span><h2 id="group-translation-v2-title">' +
      esc(options.subtitle || "Text first · voice on demand") + '</h2></div><span data-v2-status class="group-translation-v2__status">' +
      esc(options.readyLabel || "Ready") + '</span></div><div class="group-translation-v2__languages"><label><span>' +
      esc(options.sourceLabel || "Spoken language") + '</span><select data-v2-source>' + languageOptions(options.source || "vi", labels) +
      '</select></label><label><span>' + esc(options.targetLabel || "Recipient language") + '</span><select data-v2-target>' +
      languageOptions(options.target || "en", labels) + '</select></label></div><div class="group-translation-v2__composer">' +
      '<textarea data-v2-text rows="2" maxlength="12000" placeholder="' + esc(options.placeholder || "Type a message to translate") + '"></textarea>' +
      '<div class="group-translation-v2__actions"><button type="button" class="action-button action-primary" data-v2-action="send">' +
      esc(options.sendLabel || "Send") + '</button><button type="button" class="action-button action-secondary" data-v2-action="record" aria-pressed="false">' +
      esc(options.recordLabel || "Voice") + '</button></div></div><label class="group-translation-v2__auto-read"><input type="checkbox" data-v2-auto-read ' +
      (options.autoRead ? "checked" : "") + '> ' + esc(options.autoReadLabel || "Auto Read on recipient device") +
      '</label><div data-v2-error class="group-translation-v2__error" role="alert" hidden></div><div class="group-translation-v2__history" data-v2-history>' +
      '<p class="group-translation-v2__empty">' + esc(options.emptyLabel || "No FINAL translations yet.") + '</p></div></section>';
  }

  function historyItem(item, labels) {
    var finalText = item.translated_text == null ? (labels.pending || "Processing…") : item.translated_text;
    var failed = item.state === "FAILED";
    var variants = (item.variants || []).map(function (variant) {
      var text = variant.translated_text == null ? (labels.pending || "Processing…") : variant.translated_text;
      return '<div class="group-translation-v2__variant" data-variant-language="' + esc(variant.target_language) + '"><span>' +
        esc(variant.target_language) + ' · ' + esc(variant.state) + ' · ' + esc(String(variant.recipient_count || 0)) +
        ' ' + esc(labels.recipients || "recipient(s)") + '</span><strong>' + esc(text) + '</strong><button type="button" class="group-translation-v2__play" data-v2-play="' +
        esc(text) + '" data-v2-language="' + esc(variant.target_language) + '" aria-label="' + esc(labels.play || "Play translation") + '">▶</button>' +
        (variant.state === "FAILED" ? '<button type="button" class="group-translation-v2__retry" data-v2-retry="' + esc(item.id) + '" data-v2-target-language="' + esc(variant.target_language) + '">' +
          esc(labels.retry || "Retry") + '</button>' : '') + '</div>';
    }).join("");
    return '<article class="group-translation-v2__item ' + (failed ? "is-failed" : "") + '" data-segment-id="' + esc(item.id) + '"><div class="group-translation-v2__item-meta"><span>' +
      esc(item.source_language) + ' → ' + esc(item.target_language) + '</span><span>' + esc(item.state) + '</span></div><p class="group-translation-v2__source">' +
      esc(item.source_text) + '</p><p class="group-translation-v2__result">' + esc(finalText) + '</p>' + variants +
      '<div class="group-translation-v2__item-actions"><button type="button" class="group-translation-v2__play" data-v2-play="' + esc(item.translated_text || "") + '" data-v2-language="' +
      esc(item.target_language) + '" aria-label="' + esc(labels.play || "Play translation") + '">' + esc(labels.play || "Play") + '</button>' +
      (failed ? '<button type="button" class="group-translation-v2__retry" data-v2-retry="' + esc(item.id) + '" data-v2-target-language="' + esc(item.target_language) + '">' + esc(labels.retry || "Retry") + '</button>' : '') +
      '</div></article>';
  }

  window.GroupV3TranslationView = Object.freeze({
    panel: panel,
    historyItem: historyItem
  });
}(window));
