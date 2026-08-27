(function () {
  "use strict";

  var root = document.querySelector("[data-equities-page]");
  if (!root) return;

  var lang = root.dataset.equitiesLang || document.documentElement.lang || "vi";
  var country = root.dataset.equitiesCountry || "usa";
  var symbol = root.dataset.equitiesSymbol || "";
  var payload = null;
  var countrySummary = null;
  var requestId = 0;
  var chartToken = 0;
  var chartScriptPromise = null;
  var chartTimeout = null;
  var resizeObserver = null;
  var chartMutationObserver = null;
  var chromeResizeObserver = null;
  var resizeTimer = null;
  var viewportFrame = null;
  var rankingMode = "buy";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function tr(key, fallback) {
    var sources = [payload && payload.i18n, countrySummary && countrySummary.i18n];
    for (var index = 0; index < sources.length; index += 1) {
      if (sources[index] && sources[index][key]) return sources[index][key];
    }
    return fallback || key;
  }

  function number(value, digits) {
    var parsed = Number(value);
    if (value == null || value === "" || !Number.isFinite(parsed)) return tr("market.equities.unavailable");
    return new Intl.NumberFormat(document.documentElement.lang || "vi", { maximumFractionDigits: digits == null ? 2 : digits }).format(parsed);
  }

  function price(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return tr("market.equities.unavailable");
    return number(parsed, Math.abs(parsed) >= 1000 ? 0 : Math.abs(parsed) >= 1 ? 2 : 6);
  }

  function percent(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return tr("market.equities.unavailable");
    return (parsed >= 0 ? "+" : "") + parsed.toFixed(2) + "%";
  }

  function dateTime(value) {
    if (!value) return tr("market.equities.unavailable");
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(document.documentElement.lang || "vi", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: payload && payload.country ? payload.country.timezone : "UTC",
    }).format(date);
  }

  function statusLabel(value) { return tr("market.equities.status." + (value || "offline"), value || "offline"); }
  function countryLabel(value) { return tr("market.equities.country." + value, value); }
  function structureLabel(value) { return tr("market.structure." + (value || "range"), String(value || "range").replace(/_/g, " ")); }
  function stateLabel(value) { return tr("market.equities.state." + (value || "mixed"), value || "mixed"); }
  function codeLabel(group, value) { return tr("market.equities." + group + "." + value, String(value || "").replace(/_/g, " ")); }

  function actionLabel(value) {
    var key = {
      strong_buy: "market.equities.action.strong_buy", buy: "market.equities.action.buy",
      strong_sell: "market.equities.action.strong_sell", sell: "market.equities.action.sell",
      unavailable: "market.equities.action.unavailable", observe: "market.equities.action.observe", hold: "market.equities.action.observe",
    }[value] || "market.equities.action.observe";
    return tr(key, value || "observe");
  }

  function actionClass(value) {
    if (["strong_buy", "buy"].includes(value)) return "is-buy";
    if (["strong_sell", "sell"].includes(value)) return "is-sell";
    return value === "unavailable" ? "is-unavailable" : "is-observe";
  }

  function allItems() {
    if (!payload) return [];
    return (payload.items || []).concat([payload.index, payload.secondary_index].filter(Boolean));
  }

  function itemFor(value) {
    var normalized = String(value || "").toUpperCase();
    return allItems().find(function (item) {
      return String(item.provider_symbol || item.symbol || "").toUpperCase() === normalized || String(item.display_symbol || "").toUpperCase() === normalized;
    }) || null;
  }

  function currentItem() { return itemFor(symbol) || (payload && payload.selected_asset) || null; }

  function setUrl(replace) {
    var url = new URL(window.location.href);
    url.searchParams.set("country", country);
    if (symbol) url.searchParams.set("symbol", symbol); else url.searchParams.delete("symbol");
    url.searchParams.set("lang", lang);
    window.history[replace ? "replaceState" : "pushState"]({ country: country, symbol: symbol }, "", url.pathname + "?" + url.searchParams.toString());
  }

  function setStatus(value, detail) {
    var node = root.querySelector("[data-equities-status]");
    if (!node) return;
    node.className = "equities-hero-status is-" + esc(value || "offline");
    node.querySelector("strong").textContent = statusLabel(value);
    var updated = node.querySelector("[data-equities-updated]");
    if (updated) updated.textContent = detail || "";
  }

  function syncViewportMetrics() {
    viewportFrame = null;
    var visualHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var header = document.querySelector(".site-header");
    var bottomNavigation = document.querySelector(".mobile-bottom-nav");
    var toolbar = root.querySelector(".equity-chart-header");
    var headerRect = header ? header.getBoundingClientRect() : null;
    var navigationRect = bottomNavigation ? bottomNavigation.getBoundingClientRect() : null;
    var navigationVisible = Boolean(bottomNavigation && window.getComputedStyle(bottomNavigation).display !== "none");
    var headerHeight = headerRect ? headerRect.height : 0;
    var topChrome = headerRect ? Math.max(0, headerRect.bottom) : 0;
    var bottomChrome = navigationVisible && navigationRect ? Math.max(0, visualHeight - navigationRect.top) : 0;

    root.style.setProperty("--equities-visual-viewport-height", Math.round(visualHeight) + "px");
    root.style.setProperty("--equities-fixed-header-height", Math.round(headerHeight) + "px");
    root.style.setProperty("--equities-bottom-navigation-height", Math.round(navigationVisible && navigationRect ? navigationRect.height : 0) + "px");
    root.style.setProperty("--equities-fixed-top-chrome", Math.round(topChrome) + "px");
    root.style.setProperty("--equities-fixed-bottom-chrome", Math.round(bottomChrome) + "px");
    root.style.setProperty("--equities-chart-toolbar-height", Math.round(toolbar ? toolbar.getBoundingClientRect().height : 0) + "px");
  }

  function scheduleViewportMetrics() {
    if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
    viewportFrame = window.requestAnimationFrame(syncViewportMetrics);
  }

  function watchViewportChrome() {
    scheduleViewportMetrics();
    if (!("ResizeObserver" in window)) return;
    if (chromeResizeObserver) chromeResizeObserver.disconnect();
    chromeResizeObserver = new ResizeObserver(scheduleViewportMetrics);
    [document.querySelector(".site-header"), document.querySelector(".mobile-bottom-nav"), root.querySelector(".equity-chart-header")].filter(Boolean).forEach(function (node) {
      chromeResizeObserver.observe(node);
    });
  }

  function renderCountryTabs() {
    var summaries = countrySummary && countrySummary.countries ? countrySummary.countries : [];
    root.querySelectorAll("[data-equity-country]").forEach(function (button) {
      var key = button.dataset.equityCountry;
      var selected = key === country;
      var summary = summaries.find(function (row) { return row.key === key; });
      if (payload && payload.country && payload.country.key === key) {
        summary = Object.assign({}, summary || {}, payload.country);
        var stored = summaries.find(function (row) { return row.key === key; });
        if (stored) Object.assign(stored, payload.country);
      }
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("tabindex", selected ? "0" : "-1");
      button.innerHTML = '<span>' + esc((summary && summary.country_code) || key.toUpperCase()) + '</span><strong>' + esc(countryLabel(key)) + '</strong>' + (summary ? '<small>' + esc(summary.live_count + "/" + summary.coverage_count) + "</small>" : "");
    });
  }

  function indexCard(item, title) {
    if (!item) return "";
    return '<article class="equity-index-card"><span>' + esc(title) + '</span><strong>' + esc(item.display_symbol || item.symbol) + '</strong><b>' + esc(price(item.price)) + '</b><small class="equity-change ' + (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") + '">' + esc(percent(item.change_pct)) + '</small><button type="button" data-equity-symbol="' + esc(item.provider_symbol || item.symbol) + '">' + esc(tr("market.equities.view_details")) + "</button></article>";
  }

  function renderOverview() {
    var target = root.querySelector("[data-equity-country-overview]");
    if (!target || !payload || !payload.country) return;
    var meta = payload.country;
    target.innerHTML = '<div class="equity-country-summary"><div><span>' + esc(meta.country_code) + "</span><strong>" + esc(countryLabel(meta.key)) + '</strong></div><dl><div><dt>' + esc(tr("market.equities.data_status")) + "</dt><dd>" + esc(statusLabel(payload.status)) + '</dd></div><div><dt>' + esc(tr("market.equities.workspace_coverage")) + "</dt><dd>" + esc(meta.live_count + "/" + meta.coverage_count) + '</dd></div><div><dt>' + esc(tr("market.equities.market")) + "</dt><dd>" + esc(meta.currency + " · " + meta.timezone) + '</dd></div><div><dt>' + esc(tr("market.equities.data_timestamp")) + "</dt><dd>" + esc(dateTime(payload.updated_at)) + '</dd></div></dl></div><div class="equity-country-indices">' + indexCard(payload.index, tr("market.equities.primary_index")) + indexCard(payload.secondary_index, tr("market.equities.secondary_index")) + "</div>";
  }

  function renderQuote() {
    var target = root.querySelector("[data-equity-selected-quote]");
    var analysisTarget = root.querySelector("[data-equity-selected-analysis]");
    var item = currentItem();
    if (!target || !item) return;
    var analysis = item.analysis || {};
    target.innerHTML = '<div class="equity-selected-name"><span>' + esc(item.exchange || item.market || "") + " · " + esc(item.currency || "") + '</span><h2><b>' + esc(item.display_symbol || item.symbol || "") + "</b><small>" + esc(item.name || "") + '</small></h2></div><div class="equity-selected-metrics"><div data-equity-metric="price"><span>' + esc(tr("market.equities.price")) + "</span><strong>" + esc(price(item.price)) + '</strong></div><div data-equity-metric="change"><span>' + esc(tr("market.equities.change")) + '</span><strong class="equity-change ' + (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") + '">' + esc(percent(item.change_pct)) + '</strong></div><div data-equity-metric="action"><span>' + esc(tr("market.equities.action")) + '</span><strong class="equity-action-text ' + actionClass(analysis.action_key) + '">' + esc(actionLabel(analysis.action_key)) + '</strong></div><div data-equity-metric="strength"><span>' + esc(tr("market.equities.strength")) + "</span><strong>" + esc(number(analysis.strength, 0)) + "/100</strong></div></div>";
    if (analysisTarget) {
      analysisTarget.innerHTML = '<div><span>' + esc(tr("market.equities.action")) + '</span><strong class="equity-action-text ' + actionClass(analysis.action_key) + '">' + esc(actionLabel(analysis.action_key)) + '</strong></div><div><span>' + esc(tr("market.equities.strength")) + "</span><strong>" + esc(number(analysis.strength, 0)) + "/100</strong></div>";
    }
    var meta = root.querySelector("[data-equity-chart-meta]");
    if (meta) meta.textContent = (item.display_symbol || item.symbol) + " · " + (item.exchange || "") + " · " + tr("market.equities.playbook_timeframe") + ": " + (analysis.playbook_timeframe || "1D");
    var external = root.querySelector("[data-equity-chart-external]");
    if (external) external.href = item.tradingview_symbol ? "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(item.tradingview_symbol) : item.chart_url || "#";
    scheduleViewportMetrics();
  }

  function rankingRow(item, index) {
    var analysis = item.analysis || {};
    return '<button type="button" class="equity-ranking-row ' + actionClass(analysis.action_key) + (String(item.provider_symbol) === String(symbol) ? " selected" : "") + '" data-equity-symbol="' + esc(item.provider_symbol || item.symbol) + '"><span class="equity-rank-number">' + (index + 1) + '</span><span class="equity-ranking-name"><strong>' + esc(item.display_symbol || item.symbol) + "</strong><small>" + esc(item.name + " · " + item.exchange) + "</small></span><span><strong>" + esc(price(item.price)) + '</strong><small class="equity-change ' + (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") + '">' + esc(percent(item.change_pct)) + "</small></span><span><strong>" + esc(number(analysis.direction_score, 0)) + "</strong><small>" + esc(tr("market.equities.direction_score")) + "</small></span><span><strong>" + esc(number(analysis.strength, 0)) + "</strong><small>" + esc(tr("market.equities.strength")) + '</small></span><span><strong class="equity-action-text ' + actionClass(analysis.action_key) + '">' + esc(actionLabel(analysis.action_key)) + "</strong><small>" + esc(structureLabel(analysis.structure)) + '</small></span><time datetime="' + esc(item.as_of || "") + '">' + esc(dateTime(item.as_of)) + "</time></button>";
  }

  function renderLane(target, items, title, side) {
    if (!target) return;
    target.innerHTML = "<header><div><span>" + side.toUpperCase() + "</span><h3>" + esc(title) + "</h3></div><strong>" + esc(tr("market.equities.qualified_count").replace("{count}", items.length)) + "</strong></header>" + (items.length ? '<div class="equity-ranking-list">' + items.map(rankingRow).join("") + "</div>" : '<p class="equities-empty">' + esc(tr("market.equities.no_signal")) + "</p>");
  }

  function renderRankings() {
    if (!payload) return;
    renderLane(root.querySelector("[data-equity-ranking-buy]"), payload.top_buy || [], tr("market.equities.top_buy"), "buy");
    renderLane(root.querySelector("[data-equity-ranking-sell]"), payload.top_sell || [], tr("market.equities.top_sell"), "sell");
    var panel = root.querySelector(".equities-rankings-panel");
    if (panel) panel.dataset.rankingMode = rankingMode;
  }

  function renderUniverse() {
    var target = root.querySelector("[data-equity-stocks]");
    if (!target || !payload) return;
    var rows = (payload.items || []).map(function (item) {
      var analysis = item.analysis || {};
      var indicators = analysis.indicators || {};
      return '<button type="button" class="equity-stock-row ' + (String(item.provider_symbol) === String(symbol) ? "selected" : "") + '" data-equity-symbol="' + esc(item.provider_symbol || item.symbol) + '"><span class="equity-stock-name"><strong>' + esc(item.display_symbol || item.symbol) + "</strong><small>" + esc(item.name || "") + '</small></span><span class="equity-stock-market"><strong>' + esc(item.exchange || "") + "</strong><small>" + esc(item.currency || "") + '</small></span><span class="equity-stock-price"><strong>' + esc(price(item.price)) + '</strong><small class="equity-change ' + (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") + '">' + esc(percent(item.change_pct)) + '</small></span><span class="equity-stock-action"><strong class="equity-action-text ' + actionClass(analysis.action_key) + '">' + esc(actionLabel(analysis.action_key)) + "</strong><small>" + esc(number(analysis.strength, 0)) + '/100</small></span><span class="equity-stock-structure"><strong>' + esc(structureLabel(analysis.structure)) + "</strong><small>" + esc(analysis.structure_event || "—") + '</small></span><span class="equity-stock-indicators"><strong>RSI ' + esc(number(indicators.rsi14, 1)) + "</strong><small>EMA " + esc(number(indicators.ema20, 2)) + " / " + esc(number(indicators.ema50, 2)) + "</small></span></button>";
    }).join("");
    target.innerHTML = '<div class="equity-stock-table" role="table"><div class="equity-stock-head" role="row"><span>' + esc(tr("market.equities.symbol")) + "</span><span>" + esc(tr("market.equities.market")) + "</span><span>" + esc(tr("market.equities.price")) + "</span><span>" + esc(tr("market.equities.action")) + "</span><span>" + esc(tr("market.equities.structure")) + "</span><span>" + esc(tr("market.equities.indicators")) + "</span></div>" + rows + "</div>";
  }

  function metric(label, value, tone) {
    return '<div class="equity-playbook-metric ' + esc(tone || "") + '"><span>' + esc(label) + "</span><strong>" + esc(value == null ? tr("market.equities.unavailable") : value) + "</strong></div>";
  }

  function list(title, values, group) {
    return '<div class="equity-evidence-list"><h4>' + esc(title) + "</h4>" + (values.length ? "<ul>" + values.map(function (value) { return "<li>" + esc(codeLabel(group, value)) + "</li>"; }).join("") + "</ul>" : "<p>" + esc(tr("market.equities.unavailable")) + "</p>") + "</div>";
  }

  function disclosure(title, body, open) {
    return '<details class="equity-playbook-section"' + (open ? " open" : "") + "><summary><span>" + esc(title) + '</span><i aria-hidden="true"></i></summary><div class="equity-playbook-body">' + body + "</div></details>";
  }

  function renderPlaybook() {
    var target = root.querySelector("[data-equity-playbook]");
    var item = currentItem();
    if (!target || !item) return;
    var analysis = item.analysis || {}, indicators = analysis.indicators || {}, trade = analysis.trade_plan || {}, wyckoff = analysis.wyckoff_analysis || {};
    var summary = '<div class="equity-playbook-summary">' + metric(tr("market.equities.action"), actionLabel(analysis.action_key), actionClass(analysis.action_key)) + metric(tr("market.equities.direction_score"), number(analysis.direction_score, 0)) + metric(tr("market.equities.strength"), number(analysis.strength, 0) + "/100") + metric(tr("market.equities.confidence"), number(analysis.confidence_score, 0) + "/100") + metric(tr("market.equities.playbook_timeframe"), analysis.playbook_timeframe || "1D") + metric(tr("market.equities.data_status"), statusLabel(item.status === "live" ? payload.status : item.status)) + metric(tr("market.equities.last_closed_candle"), dateTime(item.last_closed_at)) + "</div>";
    var structure = '<div class="equity-playbook-grid">' + metric(tr("market.equities.structure"), structureLabel(analysis.structure)) + metric(tr("market.equities.structure_event"), analysis.structure_event || "—") + metric(tr("market.equities.support"), price(indicators.support)) + metric(tr("market.equities.resistance"), price(indicators.resistance)) + metric(tr("market.equities.invalidation"), price(trade.stop_loss)) + "</div>";
    var momentum = '<div class="equity-playbook-grid">' + metric("RSI 14", number(indicators.rsi14, 2)) + metric("RSI 20", number(indicators.rsi20, 2)) + metric("MACD", number(indicators.macd_line, 5)) + metric("MACD Signal", number(indicators.macd_signal, 5)) + metric("MACD Histogram", number(indicators.macd_histogram, 5)) + metric(tr("market.equities.momentum"), stateLabel(analysis.macd_state)) + "</div>";
    var trend = '<div class="equity-playbook-grid">' + metric("EMA 20", price(indicators.ema20)) + metric("EMA 50", price(indicators.ema50)) + metric("EMA 100", price(indicators.ema100)) + metric(tr("market.equities.trend_alignment"), stateLabel(analysis.trend_alignment)) + "</div>";
    var volatility = '<div class="equity-playbook-grid">' + metric("Bollinger Middle", price(indicators.bollinger_middle)) + metric("Bollinger Upper", price(indicators.bollinger_upper)) + metric("Bollinger Lower", price(indicators.bollinger_lower)) + metric("Bollinger Position", indicators.bollinger_position == null ? null : number(Number(indicators.bollinger_position) * 100, 1) + "%") + metric("Bollinger Bandwidth", analysis.bollinger_bandwidth == null ? null : number(Number(analysis.bollinger_bandwidth) * 100, 2) + "%") + metric("ATR", price(indicators.atr_proxy)) + metric(tr("market.equities.volatility"), stateLabel(analysis.volatility_state)) + "</div>";
    var volume = '<div class="equity-playbook-grid">' + metric(tr("market.equities.volume"), number(indicators.volume_latest, 0)) + metric("Volume Average 20", number(indicators.volume_average, 0)) + metric("Volume Ratio", indicators.volume_ratio == null ? null : number(indicators.volume_ratio, 2) + "x") + metric(tr("market.equities.data_status"), stateLabel(analysis.volume_state)) + "</div>";
    var wyckoffBody = '<div class="equity-playbook-grid">' + metric(tr("market.equities.wyckoff"), wyckoff.family) + metric(tr("market.equities.data_status"), wyckoff.state) + metric(tr("market.equities.playbook_timeframe"), wyckoff.phase) + metric(tr("market.equities.confidence"), wyckoff.confidence == null ? null : number(wyckoff.confidence, 0) + "/100") + '</div><div class="equity-wyckoff-events"><strong>' + esc(tr("market.equities.evidence")) + "</strong><p>" + esc((wyckoff.events || []).join(" · ") || tr("market.equities.unavailable")) + "</p><strong>" + esc(tr("market.equities.missing_conditions")) + "</strong><p>" + esc((wyckoff.missing_conditions || []).join(" · ") || tr("market.equities.unavailable")) + "</p><strong>" + esc(tr("market.equities.invalidation")) + "</strong><p>" + esc(wyckoff.invalidated_if || tr("market.equities.unavailable")) + "</p></div>";
    var scenario = '<div class="equity-playbook-grid">' + metric(tr("market.equities.entry"), price(trade.entry)) + metric(tr("market.equities.stop_loss"), price(trade.stop_loss)) + metric("TP1", price(trade.take_profit_1)) + metric("TP2", price(trade.take_profit_2)) + metric("TP3", price(trade.take_profit_3)) + metric(tr("market.equities.risk_reward"), trade.rr_ratio) + "</div>";
    var evidence = '<div class="equity-evidence-grid">' + list(tr("market.equities.evidence"), analysis.evidence_codes || [], "evidence") + list(tr("market.equities.conflicts"), analysis.conflict_codes || [], "conflict") + list(tr("market.equities.missing_conditions"), analysis.missing_codes || [], "missing") + "</div>";
    target.innerHTML = summary + disclosure(tr("market.equities.structure"), structure, true) + disclosure(tr("market.equities.momentum"), momentum, true) + disclosure(tr("market.equities.trend_alignment"), trend) + disclosure(tr("market.equities.volatility"), volatility) + disclosure(tr("market.equities.volume"), volume) + disclosure(tr("market.equities.wyckoff"), wyckoffBody) + disclosure(tr("market.equities.scenario"), scenario) + disclosure(tr("market.equities.evidence"), evidence);
  }

  function chartError(message) {
    var mount = root.querySelector("[data-equity-tradingview]");
    if (mount) mount.innerHTML = '<div class="equity-chart-error" role="alert"><strong>' + esc(tr("market.equities.chart_unavailable")) + "</strong><p>" + esc(message || tr("market.equities.chart_unavailable")) + '</p><button type="button" data-equity-chart-retry>' + esc(tr("market.equities.chart_retry")) + "</button></div>";
  }

  function loadChartScript() {
    if (window.TradingView && window.TradingView.widget) return Promise.resolve();
    if (chartScriptPromise) return chartScriptPromise;
    chartScriptPromise = new Promise(function (resolve, reject) {
      var script = document.querySelector("script[data-equity-tradingview-script]") || document.createElement("script");
      var timer = window.setTimeout(function () { reject(new Error("tradingview_timeout")); }, 10000);
      function ready() { if (window.TradingView && window.TradingView.widget) { window.clearTimeout(timer); resolve(); } }
      script.addEventListener("load", ready, { once: true });
      script.addEventListener("error", function () { window.clearTimeout(timer); reject(new Error("tradingview_load_failed")); }, { once: true });
      if (!script.dataset.equityTradingviewScript) { script.src = "https://s3.tradingview.com/tv.js"; script.async = true; script.dataset.equityTradingviewScript = "true"; document.head.appendChild(script); } else { ready(); }
    });
    return chartScriptPromise;
  }

  function fitChartFrame(mount) {
    var frame = mount.querySelector("iframe");
    if (!frame) return false;
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.title = tr("market.equities.chart_workspace");
    return true;
  }

  function renderDataChart(item) {
    var mount = root.querySelector("[data-equity-tradingview]");
    if (!mount) return;
    var history = (item && Array.isArray(item.chart_history) ? item.chart_history : []).filter(function (candle) {
      return candle && Number.isFinite(Number(candle.close));
    }).slice(-120);
    if (history.length < 2) {
      chartError(tr("market.equities.chart_fallback_note", tr("market.equities.chart_unavailable")));
      return;
    }
    var width = 1000, height = 540, padX = 56, padY = 42;
    var closes = history.map(function (candle) { return Number(candle.close); });
    var minimum = Math.min.apply(Math, closes), maximum = Math.max.apply(Math, closes);
    var range = maximum - minimum || Math.max(Math.abs(maximum) * 0.02, 1);
    minimum -= range * 0.08; maximum += range * 0.08; range = maximum - minimum;
    function x(index) { return padX + (index / (closes.length - 1)) * (width - padX * 2); }
    function y(value) { return height - padY - ((value - minimum) / range) * (height - padY * 2); }
    var path = closes.map(function (value, index) { return (index ? "L" : "M") + x(index).toFixed(2) + " " + y(value).toFixed(2); }).join(" ");
    var first = closes[0], last = closes[closes.length - 1];
    var stroke = last >= first ? "#0d806e" : "#c64a3a";
    var grid = [0, 1, 2, 3, 4].map(function (index) {
      var value = minimum + (range * index / 4);
      var gridY = y(value).toFixed(2);
      return '<line x1="' + padX + '" x2="' + (width - padX) + '" y1="' + gridY + '" y2="' + gridY + '" class="equity-data-chart-grid" />' +
        '<text x="' + (width - padX + 10) + '" y="' + (Number(gridY) + 4) + '" class="equity-data-chart-label">' + esc(price(value)) + '</text>';
    }).join("");
    var lastX = x(closes.length - 1).toFixed(2), lastY = y(last).toFixed(2);
    var lastDate = history[history.length - 1].timestamp ? dateTime(new Date(Number(history[history.length - 1].timestamp) * 1000).toISOString()) : tr("market.equities.unavailable");
    mount.innerHTML = '<div class="equity-data-chart" role="img" aria-label="' + esc((item.display_symbol || item.symbol || "") + " " + tr("market.equities.chart_fallback_title") + " " + price(last)) + '">' +
      '<div class="equity-data-chart-heading"><div><strong>' + esc(tr("market.equities.chart_fallback_title")) + '</strong><span>' + esc(item.display_symbol || item.symbol || "") + '</span></div><b style="color:' + stroke + '">' + esc(price(last)) + '</b></div>' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true"><g>' + grid + '</g><path d="' + path + '" class="equity-data-chart-line" style="stroke:' + stroke + '" /><circle cx="' + lastX + '" cy="' + lastY + '" r="7" class="equity-data-chart-point" style="fill:' + stroke + '" /><text x="' + padX + '" y="' + (height - 12) + '" class="equity-data-chart-label">' + esc(dateTime(new Date(Number(history[0].timestamp || 0) * 1000).toISOString())) + '</text><text x="' + (width - padX) + '" y="' + (height - 12) + '" text-anchor="end" class="equity-data-chart-label">' + esc(lastDate) + '</text></svg>' +
      '<p class="equity-data-chart-note">' + esc(tr("market.equities.chart_fallback_note")) + '</p><small>' + esc(tr("market.equities.chart_fallback_source")) + '</small></div>';
    scheduleViewportMetrics();
  }

  function watchChart(mount) {
    if (resizeObserver) resizeObserver.disconnect();
    if (chartMutationObserver) chartMutationObserver.disconnect();
    if (!("ResizeObserver" in window)) return;
    resizeObserver = new ResizeObserver(function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        fitChartFrame(mount);
      }, 80);
    });
    resizeObserver.observe(mount);
    if ("MutationObserver" in window) {
      chartMutationObserver = new MutationObserver(function () {
        if (fitChartFrame(mount)) chartMutationObserver.disconnect();
      });
      chartMutationObserver.observe(mount, { childList: true, subtree: true });
    }
    fitChartFrame(mount);
  }

  function renderChart(item) {
    var mount = root.querySelector("[data-equity-tradingview]");
    if (!mount) return;
    var token = ++chartToken;
    window.clearTimeout(chartTimeout);
    mount.innerHTML = '<div class="equity-chart-loading" role="status">' + esc(tr("market.equities.chart_loading")) + "</div>";
    if (!item || !item.tradingview_symbol) { chartError(); return; }
    if (item.chart_mode === "yahoo_fallback") {
      renderDataChart(item);
      return;
    }
    loadChartScript().then(function () {
      if (token !== chartToken) return;
      mount.innerHTML = '<div id="equity-tradingview-instance-' + token + '" class="equity-tradingview-instance"></div>';
      var container = mount.firstElementChild;
      try {
        new window.TradingView.widget({
          autosize: true, symbol: item.tradingview_symbol, interval: "D", timezone: item.timezone || "Etc/UTC",
          theme: "light", style: "1", locale: lang === "zh-TW" ? "zh_TW" : lang, toolbar_bg: "#ffffff",
          enable_publishing: false, allow_symbol_change: false, hide_side_toolbar: false, withdateranges: true, save_image: false,
          studies: ["Volume@tv-basicstudies", "RSI@tv-basicstudies", "MACD@tv-basicstudies", "BB@tv-basicstudies"],
          container_id: container.id,
        });
        watchChart(mount);
        chartTimeout = window.setTimeout(function () { if (token === chartToken && !mount.querySelector("iframe")) chartError(); }, 9000);
      } catch (error) { if (token === chartToken) chartError(error && error.message); }
    }).catch(function (error) { if (token === chartToken) chartError(error && error.message); });
  }

  function renderAll() {
    renderCountryTabs(); renderOverview(); renderQuote(); renderPlaybook(); renderRankings(); renderUniverse();
    if (currentItem()) renderChart(currentItem());
    setStatus(payload.status, (payload.provider || "") + " · " + statusLabel(payload.freshness || payload.status) + " · " + dateTime(payload.updated_at));
    scheduleViewportMetrics();
  }

  function selectSymbol(value, updateHistory, shouldScroll) {
    var item = itemFor(value);
    if (!item) return;
    symbol = item.provider_symbol || item.symbol;
    payload.selected_asset = item;
    if (updateHistory !== false) setUrl(false);
    renderQuote(); renderPlaybook(); renderRankings(); renderUniverse(); renderChart(item);
    if (shouldScroll && window.matchMedia("(max-width: 760px)").matches) {
      var chart = root.querySelector("[data-equity-chart-frame]");
      var chartMount = root.querySelector("[data-equity-tradingview]");
      if (chart) chart.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      if (chartMount) window.requestAnimationFrame(function () { chartMount.focus({ preventScroll: true }); });
    }
  }

  function loadCountry(nextCountry, nextSymbol, options) {
    options = options || {};
    var id = ++requestId;
    country = nextCountry;
    symbol = nextSymbol || "";
    renderCountryTabs();
    setStatus("idle", tr("market.equities.loading"));
    var endpoint = "/equities/intelligence.json?lang=" + encodeURIComponent(lang) + "&country=" + encodeURIComponent(country) + (symbol ? "&symbol=" + encodeURIComponent(symbol) : "");
    fetch(endpoint, { headers: { Accept: "application/json" } }).then(function (response) {
      if (!response.ok) throw new Error("equities_" + response.status);
      return response.json();
    }).then(function (data) {
      if (id !== requestId) return;
      payload = data || {};
      var selected = payload.selected_asset || (payload.items || [])[0];
      symbol = selected ? selected.provider_symbol || selected.symbol : "";
      if (options.updateUrl !== false) setUrl(Boolean(options.replaceUrl));
      renderAll();
    }).catch(function () {
      if (id !== requestId) return;
      if (payload && payload.country && payload.country.key === country) { payload.status = "stale"; renderAll(); return; }
      setStatus("offline", tr("market.equities.status.offline"));
      root.querySelectorAll("[data-equity-country-overview], [data-equity-playbook], [data-equity-ranking-buy], [data-equity-ranking-sell], [data-equity-stocks]").forEach(function (node) { node.innerHTML = '<p class="equities-empty">' + esc(tr("market.equities.status.offline")) + "</p>"; });
      chartError();
    });
  }

  fetch("/equities/countries.json?lang=" + encodeURIComponent(lang), { headers: { Accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) { countrySummary = data; renderCountryTabs(); })
    .catch(function () { renderCountryTabs(); });

  root.addEventListener("click", function (event) {
    var countryButton = event.target.closest("[data-equity-country]");
    if (countryButton) { if (countryButton.dataset.equityCountry !== country) loadCountry(countryButton.dataset.equityCountry, "", { updateUrl: true }); return; }
    var symbolButton = event.target.closest("[data-equity-symbol]");
    if (symbolButton) { selectSymbol(symbolButton.dataset.equitySymbol, true, true); return; }
    var rankingButton = event.target.closest("button[data-ranking-mode]");
    if (rankingButton) {
      rankingMode = rankingButton.dataset.rankingMode || "buy";
      root.querySelectorAll(".equity-ranking-segment button[data-ranking-mode]").forEach(function (button) { var active = button.dataset.rankingMode === rankingMode; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
      renderRankings(); return;
    }
    if (event.target.closest("[data-equity-chart-retry]")) { chartScriptPromise = null; var failed = document.querySelector("script[data-equity-tradingview-script]"); if (failed && !(window.TradingView && window.TradingView.widget)) failed.remove(); renderChart(currentItem()); return; }
    if (event.target.closest("[data-equity-chart-fullscreen]")) { var frame = root.querySelector("[data-equity-chart-frame]"); if (frame && frame.requestFullscreen) frame.requestFullscreen().catch(function () {}); }
  });

  root.addEventListener("keydown", function (event) {
    var tab = event.target.closest("[role='tab'][data-equity-country]");
    if (!tab || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll("[role='tab'][data-equity-country]"));
    var index = tabs.indexOf(tab);
    var next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next].focus(); tabs[next].click();
  });

  window.addEventListener("popstate", function () {
    var url = new URL(window.location.href);
    loadCountry(url.searchParams.get("country") || "usa", url.searchParams.get("symbol") || "", { updateUrl: false });
  });

  window.addEventListener("resize", scheduleViewportMetrics, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportMetrics);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleViewportMetrics, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleViewportMetrics, { passive: true });
  }

  watchViewportChrome();
  loadCountry(country, symbol, { updateUrl: true, replaceUrl: true });
})();
