(() => {
  if (window.location.pathname !== "/bo") return;

  const CLOCK_RENDER_MS = 250;
  const ROOM_POLL_MS = 2000;
  const CHART_POLL_MS = 2000;
  const DRIFT_REFRESH_MS = 1500;

  const text = (value) => String(value == null ? "" : value);
  const toMs = (value) => {
    const number = Number(value || 0);
    return number > 0 && number < 1000000000000 ? number * 1000 : number;
  };

  let realtimePending = false;
  let chartPending = false;
  let lastForceRefreshAt = 0;

  const clock = {
    ready: false,
    serverNowMs: 0,
    clientReceivedAtMs: 0,
    sessionCode: "",
    sessionStartMs: 0,
    cutoffMs: 0,
    closeMs: 0,
    openSeconds: 30,
    totalSeconds: 60,
    currentPhase: "syncing",
  };

  function estimatedServerNowMs() {
    if (!clock.ready) return 0;
    return clock.serverNowMs + (performance.now() - clock.clientReceivedAtMs);
  }

  function computePhase() {
    if (!clock.ready) return { phase: "syncing", remaining: 0 };
    const now = estimatedServerNowMs();
    if (now < clock.cutoffMs) {
      return { phase: "open", remaining: Math.max(1, Math.ceil((clock.cutoffMs - now) / 1000)) };
    }
    if (now < clock.closeMs) {
      return { phase: "processing", remaining: Math.max(1, Math.ceil((clock.closeMs - now) / 1000)) };
    }
    return { phase: "syncing", remaining: 0 };
  }

  function activeAsset() {
    return document.querySelector("[data-tv].active")?.dataset.asset || document.getElementById("boAssetInput")?.value || "BTC";
  }

  function setAll(selector, value) {
    document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
  }

  function addStyle() {
    if (document.querySelector("#bo-pro-patch-style")) return;
    const style = document.createElement("style");
    style.id = "bo-pro-patch-style";
    style.textContent = `
      .bo-pro-phase-panel{padding:10px 14px!important;grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important}
      .bo-pro-phase-steps span{white-space:nowrap}
      .bo-pro-marker-panel{display:flex;flex-wrap:wrap;gap:8px;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.07);background:rgba(3,10,14,.62)}
      .bo-pro-marker{border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;color:#d9e5f1;background:rgba(255,255,255,.055)}
      .bo-pro-marker.buy{border-color:rgba(47,240,188,.6);background:rgba(47,240,188,.13)}
      .bo-pro-marker.sell{border-color:rgba(255,78,102,.6);background:rgba(255,78,102,.13)}
      .bo-pro-marker.win{box-shadow:0 0 0 1px rgba(47,240,188,.35) inset;color:#bfffee}
      .bo-pro-marker.lost{box-shadow:0 0 0 1px rgba(255,78,102,.35) inset;color:#ffd4dc}
      .bo-pro-marker.refunded{box-shadow:0 0 0 1px rgba(255,207,86,.35) inset;color:#fff1bb}
      .bo-pro-marker.pending{color:#fff1bb}
      .bo-pro-sync{border-color:rgba(255,207,86,.55)!important;background:rgba(255,207,86,.12)!important;color:#fff1bb!important}
      .bo-pro-chart-note{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;color:rgba(255,255,255,.68);font-size:12px;font-weight:800}
      .bo-pro-chart-note span{border-radius:999px;background:rgba(255,255,255,.07);padding:6px 9px}
      .bo-side-grid button.is-disabled{opacity:.42;cursor:not-allowed;filter:grayscale(.55)}
      @media (max-width:900px){.bo-pro-phase-panel{grid-template-columns:1fr!important}.bo-pro-phase-steps{justify-content:flex-start!important}.bo-pro-marker-panel{padding:8px 10px}.bo-pro-marker{font-size:11px}}
    `;
    document.head.appendChild(style);
  }

  function ensureProPanel() {
    addStyle();
    const frame = document.querySelector(".bo-chart-frame");
    if (!frame || document.querySelector(".bo-pro-phase-panel")) return;
    const panel = document.createElement("div");
    panel.className = "bo-pro-phase-panel";
    panel.innerHTML = `
      <div>
        <span>BO settlement</span>
        <strong data-bo-pro-phase>Đang đồng bộ đồng hồ phiên...</strong>
        <div class="bo-pro-chart-note">
          <span>Settlement: BO System Chart 1m</span>
          <span>TradingView: reference only</span>
          <span>30s open + 30s processing</span>
        </div>
      </div>
      <div class="bo-pro-phase-steps">
        <span data-bo-pro-open>0-30s Open</span>
        <span data-bo-pro-processing>30-60s Processing</span>
      </div>
    `;
    const markerPanel = document.createElement("div");
    markerPanel.className = "bo-pro-marker-panel";
    markerPanel.setAttribute("data-bo-pro-markers", "1");
    markerPanel.innerHTML = `<span class="bo-pro-marker pending">Member order markers sẽ hiện ở đây sau khi đặt lệnh.</span>`;
    const head = frame.querySelector(".bo-chart-head");
    if (head && head.nextSibling) {
      frame.insertBefore(panel, head.nextSibling);
      frame.insertBefore(markerPanel, panel.nextSibling);
    } else {
      frame.prepend(markerPanel);
      frame.prepend(panel);
    }
  }

  function forceOneMinuteDefault() {
    const active = document.querySelector(".bo-interval-tabs button.active");
    const oneMinute = document.querySelector('.bo-interval-tabs button[data-interval="1"]');
    if (oneMinute && active !== oneMinute) oneMinute.click();
    const note = document.querySelector(".bo-system-chart-meta");
    if (note && !note.querySelector("[data-bo-pro-note]")) {
      const span = document.createElement("span");
      span.setAttribute("data-bo-pro-note", "1");
      span.textContent = "Settlement = 1m candle | 30s order window | 30s risk-control window";
      note.appendChild(span);
    }
  }

  function resyncClock(payload) {
    const boClock = payload?.bo_clock || {};
    const serverNowMs = toMs(payload?.server_now_ts || boClock.server_now_ts);
    const startMs = toMs(boClock.current_session_start_ts);
    const cutoffMs = toMs(boClock.current_session_cutoff_ts);
    const closeMs = toMs(boClock.current_session_close_ts);
    if (!serverNowMs || !startMs || !cutoffMs || !closeMs) return;

    clock.ready = true;
    clock.serverNowMs = serverNowMs;
    clock.clientReceivedAtMs = performance.now();
    clock.sessionCode = text(boClock.session_code);
    clock.sessionStartMs = startMs;
    clock.cutoffMs = cutoffMs;
    clock.closeMs = closeMs;
    clock.openSeconds = Number(boClock.open_seconds || 30);
    clock.totalSeconds = Number(boClock.total_seconds || 60);
    clock.currentPhase = computePhase().phase;
  }

  function setButtons(enabled) {
    document.querySelectorAll(".bo-side-grid button").forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle("is-disabled", !enabled);
    });
  }

  function renderClock() {
    ensureProPanel();
    const phaseState = computePhase();
    const phase = phaseState.phase;
    const remaining = phaseState.remaining;
    clock.currentPhase = phase;

    const phaseNode = document.querySelector("[data-bo-pro-phase]");
    const openNode = document.querySelector("[data-bo-pro-open]");
    const processingNode = document.querySelector("[data-bo-pro-processing]");

    let label = "Đang đồng bộ";
    let countdown = "...";
    if (phase === "open") {
      label = "Đang mở";
      countdown = `${remaining}s`;
      if (phaseNode) phaseNode.textContent = `Còn ${remaining}s để đặt lệnh`;
      setButtons(remaining > 0);
    } else if (phase === "processing") {
      label = "Đang xử lý";
      countdown = `${remaining}s`;
      if (phaseNode) phaseNode.textContent = `Còn ${remaining}s xử lý kết quả`;
      setButtons(false);
    } else {
      label = "Đang đồng bộ";
      countdown = "0s";
      if (phaseNode) phaseNode.textContent = "Đang đồng bộ kết quả...";
      setButtons(false);
      const now = performance.now();
      if (now - lastForceRefreshAt > DRIFT_REFRESH_MS) {
        lastForceRefreshAt = now;
        refreshRoomState(true);
      }
    }

    setAll("[data-bo-session-code], [data-bo-ticket-session]", clock.sessionCode || "...");
    setAll("[data-bo-countdown], [data-bo-ticket-countdown]", countdown);
    setAll("[data-bo-session-state], [data-bo-ticket-state]", label);
    openNode?.classList.toggle("active", phase === "open");
    processingNode?.classList.toggle("active", phase === "processing");
  }

  function markerStatusClass(marker) {
    const status = text(marker.status).toLowerCase();
    if (status === "won") return "win";
    if (status === "lost") return "lost";
    if (status === "refunded") return "refunded";
    if (status === "accepted") return "pending";
    return status;
  }

  function renderMarkers(markers) {
    const panel = document.querySelector("[data-bo-pro-markers]");
    if (!panel) return;
    if (!Array.isArray(markers) || markers.length === 0) {
      panel.innerHTML = `<span class="bo-pro-marker pending">Chưa có lệnh của bạn trên chart hiện tại.</span>`;
      return;
    }
    const hasAccepted = markers.some((marker) => text(marker.status).toLowerCase() === "accepted");
    const html = markers.slice(0, 8).map((marker) => {
      const side = text(marker.side).toLowerCase();
      const statusClass = markerStatusClass(marker);
      const label = side === "buy" ? "BUY" : "SELL";
      const status = text(marker.status).toUpperCase();
      const stake = text(marker.stake_amount);
      const entry = text(marker.entry_price);
      const profit = text(marker.profit_amount);
      const profitText = ["WON", "LOST", "REFUNDED"].includes(status) ? ` • P/L ${profit}` : "";
      return `<span class="bo-pro-marker ${side} ${statusClass}">${label} ${stake} • ${status} • entry ${entry}${profitText}</span>`;
    }).join("");
    panel.innerHTML = hasAccepted
      ? `${html}<span class="bo-pro-marker bo-pro-sync">Đang đồng bộ kết quả sau close 60s...</span>`
      : html;
  }

  function renderOrders(orders) {
    const table = document.querySelector("[data-bo-order-history]");
    if (!table || !Array.isArray(orders)) return;
    if (!orders.length) {
      table.innerHTML = `<tr><td colspan="5" class="empty">Chưa có lệnh.</td></tr>`;
      return;
    }
    table.innerHTML = orders.map((item) => {
      const status = text(item.status).toLowerCase();
      const cls = status === "won" || status === "refunded" ? "ok" : "warn";
      return `<tr>
        <td>${text(item.reference_code)}</td>
        <td>${text(item.asset)}</td>
        <td>${text(item.side).toUpperCase()}</td>
        <td>${text(item.stake_amount)}</td>
        <td><span class="badge ${cls}">${status.toUpperCase()}</span></td>
      </tr>`;
    }).join("");
  }

  function renderResults(resultsByAsset) {
    const rows = (resultsByAsset && (resultsByAsset[activeAsset()] || resultsByAsset.BTC)) || [];
    const latest = Array.isArray(rows) ? rows[0] : null;
    const latestNode = document.querySelector("[data-bo-last-result]");
    const history = document.querySelector("[data-bo-session-history]");
    if (latestNode && latest) {
      latestNode.className = `bo-latest-result ${text(latest.result_side)}`;
      latestNode.innerHTML = `<span>Kết quả phiên - ${text(latest.session_code)}</span><strong>${text(latest.result_side).toUpperCase()}</strong><small>${text(latest.entry_price)} -> ${text(latest.result_price)} - ${text(latest.change_percent)}%</small>`;
    }
    if (history && Array.isArray(rows)) {
      history.innerHTML = rows.map((row) => `<article class="${text(row.result_side)}"><span>${text(row.session_code)}</span><strong>${text(row.result_side).toUpperCase()}</strong><small>${text(row.change_percent)}%</small></article>`).join("");
    }
  }

  function updateWallet(wallet) {
    if (!wallet) return;
    setAll("[data-wallet-balance]", text(wallet.available_balance));
  }

  async function refreshRoomState(force = false) {
    if (realtimePending && !force) return;
    realtimePending = true;
    try {
      const response = await fetch(`/api/slbo/room-state?_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      resyncClock(payload);
      renderResults(payload.bo_results_by_asset || {});
      renderOrders(payload.orders || []);
      updateWallet(payload.wallet);
      renderClock();
    } catch (error) {
      console.warn("BO room-state refresh failed", error);
      if (clock.ready && estimatedServerNowMs() >= clock.closeMs) setButtons(false);
    } finally {
      realtimePending = false;
    }
  }

  async function refreshChartMarkers(force = false) {
    if (chartPending && !force) return;
    chartPending = true;
    try {
      const response = await fetch(`/api/slbo/bo-chart?asset=${encodeURIComponent(activeAsset())}&interval=1&limit=100&_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      renderMarkers(payload.member_order_markers || []);
      if (payload.recent_results) renderResults({ [payload.asset || activeAsset()]: payload.recent_results });
    } catch (error) {
      console.warn("BO marker refresh failed", error);
    } finally {
      chartPending = false;
    }
  }

  function guardOrderForm() {
    document.querySelectorAll('form[action^="/bo/orders"]').forEach((form) => {
      if (form.dataset.boRealtimeGuarded === "1") return;
      form.dataset.boRealtimeGuarded = "1";
      form.addEventListener("submit", (event) => {
        const phase = computePhase();
        if (clock.ready && (phase.phase !== "open" || phase.remaining <= 0)) {
          event.preventDefault();
          refreshRoomState(true);
          alert("Phiên đã đóng đặt lệnh. Vui lòng chờ phiên mới mở.");
        }
      });
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshRoomState(true);
  });
  window.addEventListener("online", () => refreshRoomState(true));

  window.addEventListener("load", () => {
    ensureProPanel();
    forceOneMinuteDefault();
    guardOrderForm();
    refreshRoomState(true);
    refreshChartMarkers(true);
    setInterval(renderClock, CLOCK_RENDER_MS);
    setInterval(refreshRoomState, ROOM_POLL_MS);
    setInterval(refreshChartMarkers, CHART_POLL_MS);
  });
})();
