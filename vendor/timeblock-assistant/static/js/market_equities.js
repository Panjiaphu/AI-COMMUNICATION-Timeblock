(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function tr(dictionary, key, fallback) {
    return (dictionary || {})[key] || fallback || key;
  }

  function locale() {
    return document.documentElement.lang || "vi";
  }

  function formatPrice(item, dictionary) {
    if (item.price == null) return tr(dictionary, "market.equities.unavailable", "N/A");
    var value = Number(item.price);
    var digits = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
  }

  function formatChange(item, dictionary) {
    if (item.change_pct == null) return tr(dictionary, "market.equities.unavailable", "N/A");
    var value = Number(item.change_pct);
    return (value >= 0 ? "+" : "") + value.toFixed(2) + "%";
  }

  function actionBucket(actionKey) {
    if (actionKey === "buy" || actionKey === "strong_buy") return "buy";
    if (actionKey === "sell" || actionKey === "strong_sell") return "sell";
    return "observe";
  }

  function actionLabel(actionKey, dictionary) {
    return tr(dictionary, "market.equities.action." + actionBucket(actionKey), actionBucket(actionKey));
  }

  function statusLabel(status, dictionary) {
    return tr(dictionary, "market.equities.status." + (status || "fallback"), status || "fallback");
  }

  function coverageLabel(region, dictionary) {
    return tr(dictionary, "market.equities.coverage", "{live}/{total}")
      .replace("{live}", String(region.live_count || 0))
      .replace("{total}", String(region.coverage_count || 0));
  }

  function renderActionLane(items, bucket, dictionary) {
    var label = tr(dictionary, "market.equities.action." + bucket, bucket);
    var rows = (items || []).map(function (item) {
      var score = item.rule_score == null ? tr(dictionary, "market.equities.unavailable", "N/A") : String(item.rule_score) + "/100";
      return '<a class="market-equity-action-row" href="' + esc(item.chart_url || "#") + '" target="_blank" rel="noopener noreferrer">' +
        '<span><strong>' + esc(item.symbol) + '</strong><small>' + esc(item.name) + '</small></span>' +
        '<span><strong>' + esc(score) + '</strong><small>' + esc(tr(dictionary, "market.equities.rule_score", "Rule score")) + '</small></span>' +
        '</a>';
    }).join("");
    if (!rows) rows = '<p class="market-equities-empty">' + esc(tr(dictionary, "market.equities.no_signal", "No qualified signal yet")) + '</p>';
    return '<section class="market-equity-action-lane is-' + esc(bucket) + '"><header><span>' + esc(label) + '</span><strong>' + (items || []).length + '</strong></header><div>' + rows + '</div></section>';
  }

  function renderActions(payload, regionKey, dictionary) {
    var target = document.querySelector("[data-equities-actions]");
    if (!target) return;
    var regional = (payload.top_actions_by_region || {})[regionKey] || { buy: [], sell: [] };
    target.innerHTML = renderActionLane(regional.buy, "buy", dictionary) + renderActionLane(regional.sell, "sell", dictionary);
  }

  function renderIndices(payload, regionKey, dictionary) {
    var target = document.querySelector("[data-equities-indices]");
    if (!target) return;
    var region = (payload.indices || []).find(function (entry) { return entry.key === regionKey; });
    var items = region ? region.items || [] : [];
    target.innerHTML = items.map(function (item) {
      var tone = item.status === "live" ? (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") : "muted";
      return '<a class="market-equity-index-card" href="' + esc(item.chart_url || "#") + '" target="_blank" rel="noopener noreferrer">' +
        '<span>' + esc(item.country || item.market) + '</span><strong>' + esc(item.name) + '</strong>' +
        '<div><b>' + esc(formatPrice(item, dictionary)) + '</b><small class="' + tone + '">' + esc(formatChange(item, dictionary)) + '</small></div>' +
        '</a>';
    }).join("") || '<p class="market-equities-empty">' + esc(tr(dictionary, "market.equities.status.fallback", "No direct data")) + '</p>';
  }

  function renderRegion(payload, regionKey, dictionary) {
    var target = document.querySelector("[data-equities-grid]");
    if (!target) return;
    var region = (payload.regions || []).find(function (entry) { return entry.key === regionKey; });
    if (!region) {
      target.innerHTML = '<p class="market-equities-empty">' + esc(tr(dictionary, "market.equities.status.fallback", "No direct data")) + '</p>';
      return;
    }
    var rows = (region.items || []).map(function (item) {
      var analysis = item.analysis || {};
      var bucket = actionBucket(analysis.action_key);
      var tone = item.status === "live" ? (Number(item.change_pct || 0) >= 0 ? "positive" : "negative") : "muted";
      var score = analysis.rule_score == null ? tr(dictionary, "market.equities.unavailable", "N/A") : String(analysis.rule_score) + "/100";
      return '<tr>' +
        '<td><strong>' + esc(item.symbol) + '</strong></td>' +
        '<td><span>' + esc(item.name) + '</span><small>' + esc(item.market) + '</small></td>' +
        '<td class="equity-price">' + esc(formatPrice(item, dictionary)) + (item.currency ? ' <small>' + esc(item.currency) + '</small>' : '') + '</td>' +
        '<td class="equity-change ' + tone + '">' + esc(formatChange(item, dictionary)) + '</td>' +
        '<td><span class="market-equity-action-badge is-' + esc(bucket) + '">' + esc(actionLabel(analysis.action_key, dictionary)) + '</span></td>' +
        '<td class="equity-score">' + esc(score) + '</td>' +
        '<td><a href="' + esc(item.chart_url || "#") + '" target="_blank" rel="noopener noreferrer">' + esc(tr(dictionary, "market.equities.open", "Open")) + '</a></td>' +
        '</tr>';
    }).join("");
    target.innerHTML = '<article class="market-equity-region equity-status-' + esc(region.status || "fallback") + '">' +
      '<div class="market-equity-region-heading"><div><span>' + esc(tr(dictionary, "market.equities.region." + region.key, region.key)) + '</span><strong>' + esc(statusLabel(region.status, dictionary)) + '</strong></div>' +
      '<small>' + esc(coverageLabel(region, dictionary)) + '</small></div>' +
      '<div class="market-equity-table-wrap" tabindex="0"><table><thead><tr>' +
      '<th>' + esc(tr(dictionary, "market.equities.symbol", "Symbol")) + '</th>' +
      '<th>' + esc(tr(dictionary, "market.equities.name", "Company")) + '</th>' +
      '<th>' + esc(tr(dictionary, "market.equities.price", "Price")) + '</th>' +
      '<th>' + esc(tr(dictionary, "market.equities.change", "Day")) + '</th>' +
      '<th>' + esc(tr(dictionary, "market.equities.actions_title", "Action")) + '</th>' +
      '<th>' + esc(tr(dictionary, "market.equities.rule_score", "Rule score")) + '</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></article>';
  }

  function init() {
    var board = document.querySelector("[data-market-equities]");
    if (!board) return;
    var status = board.querySelector("[data-equities-status]");
    var tabs = Array.prototype.slice.call(board.querySelectorAll("[data-equities-region]"));
    var state = { payload: null, activeRegion: "americas", requested: false };

    function render() {
      if (!state.payload) return;
      var dictionary = state.payload.i18n || {};
      renderActions(state.payload, state.activeRegion, dictionary);
      renderIndices(state.payload, state.activeRegion, dictionary);
      renderRegion(state.payload, state.activeRegion, dictionary);
    }

    function selectRegion(regionKey, focusTab) {
      state.activeRegion = regionKey;
      tabs.forEach(function (tab) {
        var selected = tab.getAttribute("data-equities-region") === regionKey;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected && focusTab) tab.focus();
      });
      render();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { selectRegion(tab.getAttribute("data-equities-region"), false); });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        var step = event.key === "ArrowRight" ? 1 : -1;
        var next = (index + step + tabs.length) % tabs.length;
        selectRegion(tabs[next].getAttribute("data-equities-region"), true);
      });
    });

    function load() {
      if (state.requested) return;
      state.requested = true;
      var endpoint = board.getAttribute("data-equities-endpoint") || ("/market/equities.json?lang=" + encodeURIComponent(locale()));
      fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (response) {
          if (!response.ok) throw new Error("equities " + response.status);
          return response.json();
        })
        .then(function (payload) {
          state.payload = payload;
          var dictionary = payload.i18n || {};
          board.setAttribute("aria-busy", "false");
          status.textContent = (payload.provider || "") + " · " + (payload.live_count || 0) + "/" + (payload.coverage_count || 0) + " · " + statusLabel(payload.status, dictionary);
          render();
        })
        .catch(function () {
          board.setAttribute("aria-busy", "false");
          status.textContent = board.getAttribute("data-equities-error") || statusLabel("fallback", {});
        });
    }

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        observer.disconnect();
        load();
      }, { rootMargin: "500px 0px" });
      observer.observe(board);
    } else {
      load();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
