(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "N/A" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function translate(payload, key, fallback) {
    return ((payload || {}).i18n || {})[key] || fallback || key;
  }

  function findPanel(symbol) {
    try {
      return document.querySelector('.market-lab-panel[data-lab-panel="' + CSS.escape(symbol) + '"]');
    } catch (error) {
      return document.querySelector('.market-lab-panel[data-lab-panel="' + symbol + '"]');
    }
  }

  function scoreItem(label, value) {
    if (value === null || value === undefined) return "";
    return '<div><span>' + esc(label) + '</span><meter min="0" max="100" value="' + esc(value) + '"></meter><strong>' + esc(value) + '/100</strong></div>';
  }

  function renderRuleScore(panel, asset, payload) {
    var breakdown = asset.rule_score_breakdown;
    if (!breakdown || breakdown.final === null || breakdown.final === undefined) return;
    var strip = panel.querySelector(".rule-score-breakdown-strip") || document.createElement("section");
    strip.className = "confidence-breakdown-strip rule-score-breakdown-strip backend-rule-score-strip";
    strip.innerHTML = '<h4>' + esc(translate(payload, "market.confidence.title")) + '</h4>' +
      scoreItem(translate(payload, "market.confidence.technical"), breakdown.technical) +
      scoreItem(translate(payload, "market.confidence.structure"), breakdown.structure) +
      scoreItem(translate(payload, "market.confidence.volume"), breakdown.volume) +
      scoreItem(translate(payload, "market.confidence.macro"), breakdown.macro) +
      scoreItem(translate(payload, "market.confidence.news"), breakdown.news) +
      scoreItem(translate(payload, "market.confidence.futures"), breakdown.futures) +
      scoreItem(translate(payload, "market.confidence.risk_penalty"), breakdown.risk_penalty) +
      scoreItem(translate(payload, "market.confidence.final"), breakdown.final);
    if (!strip.parentNode) {
      var anchor = panel.querySelector(".lab-plan-grid");
      if (anchor) anchor.insertAdjacentElement("afterend", strip);
    }
  }

  function flattenBacktests(asset) {
    var horizons = ((asset || {}).backtests_real || {}).horizons || {};
    var rows = [];
    Object.keys(horizons).forEach(function (horizon) {
      Object.keys(horizons[horizon] || {}).forEach(function (ruleKey) {
        rows.push({ horizon: horizon, rule: ruleKey, item: horizons[horizon][ruleKey] || {} });
      });
    });
    return rows;
  }

  function renderRealBacktest(panel, asset, payload) {
    if (!asset.backtests_real || panel.querySelector(".backend-real-backtest")) return;
    var rows = flattenBacktests(asset);
    if (!rows.length) return;
    var html = rows.slice(0, 10).map(function (row) {
      var item = row.item;
      var status = translate(payload, item.status_key || "market.backtest.insufficient");
      return '<article class="backtest-card tone-' + esc(item.tone || "neutral") + '">' +
        '<span>' + esc(row.horizon) + ' · ' + esc(row.rule).toUpperCase() + '</span>' +
        '<strong>' + esc(status) + '</strong>' +
        '<dl>' +
          '<div><dt>' + esc(translate(payload, "market.backtest.win_rate")) + '</dt><dd>' + esc(item.win_rate) + '</dd></div>' +
          '<div><dt>' + esc(translate(payload, "market.backtest.sample")) + '</dt><dd>' + esc(item.sample_size) + '</dd></div>' +
          '<div><dt>' + esc(translate(payload, "market.backtest.avg_r")) + '</dt><dd>' + esc(item.average_r) + '</dd></div>' +
          '<div><dt>' + esc(translate(payload, "market.backtest.max_dd")) + '</dt><dd>' + esc(item.max_drawdown) + '</dd></div>' +
        '</dl>' +
      '</article>';
    }).join("");
    var section = document.createElement("section");
    section.className = "lab-block backend-real-backtest";
    section.innerHTML = '<div class="lab-block-heading"><span>' + esc(translate(payload, "market.backtest.real_badge")) + '</span><strong>' + esc(translate(payload, "market.backtest.real_title")) + '</strong></div><div class="backtest-grid">' + html + '</div>';
    var anchor = panel.querySelector(".lab-session-risk-stack");
    if (anchor) anchor.insertAdjacentElement("afterend", section);
  }

  function renderWyckoff(panel, asset, payload) {
    var analysis = asset.wyckoff_analysis;
    if (!analysis || panel.querySelector(".backend-wyckoff")) return;
    var section = document.createElement("section");
    var family = String(analysis.family || "none").toLowerCase();
    var bullish = family.indexOf("accumulation") >= 0 || family.indexOf("reaccumulation") >= 0;
    var bearish = family.indexOf("distribution") >= 0 || family.indexOf("redistribution") >= 0;
    var wyckoffTone = bullish ? "wyckoff-accumulation" : bearish ? "wyckoff-distribution" : "wyckoff-watch";
    var wyckoffPath = bullish ? "M12 86 C45 70 55 94 83 68 S126 76 151 48 S190 68 218 42 S260 56 294 22" : bearish ? "M12 24 C45 40 55 16 83 38 S126 30 151 60 S190 34 218 68 S260 46 294 84" : "M12 56 C48 42 74 70 106 54 S156 64 188 51 S245 62 294 54";
    var wyckoffLabel = bullish ? "Spring / SOS / LPS" : bearish ? "UTAD / SOW / LPSY" : "Trading range / confirmation";
    section.className = "lab-block backend-wyckoff wyckoff-playbook-block " + wyckoffTone;
    var score = analysis.rule_score == null ? "N/A" : analysis.rule_score + "/100";
    var familyKey = "market.wyckoff.pattern." + String(analysis.family || "none").replace("reaccumulation", "accumulation").replace("redistribution", "distribution");
    section.innerHTML = '<div class="lab-block-heading"><span>' + esc(translate(payload, "market.wyckoff.title")) + '</span><strong>' + esc(translate(payload, familyKey, analysis.state || "WATCH_ONLY")) + ' · ' + esc(score) + '</strong></div>' +
      '<div class="backend-context-grid">' +
        '<article><span>' + esc(translate(payload, "market.wyckoff.phase")) + '</span><strong>' + esc(analysis.phase || "N/A") + '</strong></article>' +
        '<article><span>' + esc(translate(payload, "market.wyckoff.event")) + '</span><strong>' + esc((analysis.events || []).join(" / ") || "N/A") + '</strong></article>' +
        '<article><span>' + esc(translate(payload, "market.wyckoff.missing")) + '</span><strong>' + esc((analysis.missing_conditions || []).slice(0, 3).join(" / ") || "N/A") + '</strong></article>' +
      '</div>';
    section.innerHTML += '<div class="wyckoff-playbook-grid"><article class="wyckoff-card wyckoff-schematic"><svg viewBox="0 0 306 112" role="img" aria-label="' + esc(wyckoffLabel) + '"><line x1="12" y1="32" x2="294" y2="32" class="wy-range"></line><line x1="12" y1="84" x2="294" y2="84" class="wy-range"></line><path d="' + wyckoffPath + '" class="wy-line ' + (bullish ? "wy-bull" : bearish ? "wy-bear" : "wy-watch") + '"></path><text x="15" y="105">' + esc(wyckoffLabel) + '</text></svg></article><article class="wyckoff-card wyckoff-analysis"><span>' + esc(translate(payload, "market.wyckoff.next_confirmation", "Next confirmation")) + '</span><p>' + esc(analysis.entry_zone || "N/A") + '</p><p><strong>' + esc(translate(payload, "market.wyckoff.invalid_if", "Invalid if")) + ':</strong> ' + esc(analysis.invalidated_if || "N/A") + '</p><p><strong>Matched:</strong> ' + esc((analysis.matched_conditions || []).join(" / ") || "N/A") + '</p><p><strong>Explanation:</strong> ' + esc(analysis.explanation_key ? translate(payload, analysis.explanation_key, analysis.explanation_key) : "Structure and volume remain under review.") + '</p></article></div>';
    var anchor = panel.querySelector(".lab-session-risk-stack");
    if (anchor) anchor.insertAdjacentElement("afterend", section);
  }

  function renderFutures(panel, asset, payload) {
    var context = asset.futures_context;
    if (!context || context.status !== "live" || panel.querySelector(".backend-futures-context")) return;
    var section = document.createElement("section");
    section.className = "lab-block backend-futures-context";
    section.innerHTML = '<div class="lab-block-heading"><span>' + esc(translate(payload, "market.futures.title")) + '</span><strong>' + esc(translate(payload, "market.futures.status.live")) + '</strong></div>' +
      '<div class="backend-context-grid">' +
        '<article><span>' + esc(translate(payload, "market.futures.funding")) + '</span><strong>' + esc(context.funding_rate_label || "N/A") + '</strong></article>' +
        '<article><span>' + esc(translate(payload, "market.futures.open_interest")) + '</span><strong>' + esc(context.open_interest_label || "N/A") + '</strong></article>' +
        '<article><span>' + esc(translate(payload, "market.futures.ratio")) + '</span><strong>' + esc(context.long_short_ratio_label || "N/A") + '</strong></article>' +
      '</div>';
    var anchor = panel.querySelector(".market-mode-summary-grid");
    if (anchor) anchor.insertAdjacentElement("afterend", section);
  }

  function apply(payload) {
    ((((payload || {}).signal_lab || {}).assets) || []).forEach(function (asset) {
      var panel = findPanel(asset.symbol);
      if (!panel) return;
      renderRuleScore(panel, asset, payload);
      renderRealBacktest(panel, asset, payload);
      renderWyckoff(panel, asset, payload);
      renderFutures(panel, asset, payload);
    });
  }

  function init() {
    if (!document.querySelector(".market-signal-lab")) return;
    var loader = window.TimeblockMarketEnterprise && window.TimeblockMarketEnterprise.loadIntelligence;
    if (loader) loader().then(apply).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
