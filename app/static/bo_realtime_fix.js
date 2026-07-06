(() => {
  if (window.location.pathname !== "/bo") return;

  let lastClock = null;
  let statePending = false;
  let chartPending = false;

  const text = (value) => String(value == null ? "" : value);
  const activeAsset = () => document.querySelector("[data-tv].active")?.dataset.asset || document.getElementById("boAssetInput")?.value || "BTC";
  const setAll = (selector, value) => document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });

  function setButtons(clock) {
    const open = clock && clock.state === "open" && Number(clock.remaining || 0) > 0;
    document.querySelectorAll(".bo-side-grid button").forEach((button) => {
      button.disabled = !open;
      button.classList.toggle("is-disabled", !open);
    });
  }

  function updateClock(clock) {
    if (!clock) return;
    lastClock = { ...clock, receivedAt: Date.now() };
    const state = text(clock.state);
    const remaining = Number(clock.remaining || 0);
    const label = state === "open" ? "Đang mở" : "Đang xử lý";
    setAll("[data-bo-session-code], [data-bo-ticket-session]", text(clock.session_code));
    setAll("[data-bo-countdown], [data-bo-ticket-countdown]", `${remaining}s`);
    setAll("[data-bo-session-state], [data-bo-ticket-state]", label);
    const phase = document.querySelector("[data-bo-pro-phase]");
    if (phase) {
      phase.textContent = state === "open"
        ? `Đang đặt lệnh: còn ${remaining}s / cutoff 30s`
        : `Đang xử lý kết quả: còn ${remaining}s / close 60s`;
    }
    document.querySelector("[data-bo-pro-open]")?.classList.toggle("active", state === "open");
    document.querySelector("[data-bo-pro-processing]")?.classList.toggle("active", state !== "open");
    setButtons(clock);
  }

  function optimisticCountdown() {
    if (!lastClock) return;
    const age = Math.floor((Date.now() - Number(lastClock.receivedAt || 0)) / 1000);
    const remaining = Math.max(0, Number(lastClock.remaining || 0) - age);
    if (lastClock.state === "open" && remaining <= 0) {
      updateClock({ ...lastClock, state: "processing", remaining: Math.max(1, Number(lastClock.processing_seconds || 30)) });
      pollState();
      return;
    }
    setAll("[data-bo-countdown], [data-bo-ticket-countdown]", `${remaining}s`);
    if (remaining <= 0) pollState();
  }

  function renderOrders(orders) {
    const table = document.querySelector("[data-bo-order-history]");
    if (!table || !Array.isArray(orders)) return;
    if (!orders.length) {
      table.innerHTML = '<tr><td colspan="5" class="empty">Chưa có lệnh.</td></tr>';
      return;
    }
    table.innerHTML = orders.map((item) => {
      const status = text(item.status).toLowerCase();
      const cls = status === "won" || status === "refunded" ? "ok" : "warn";
      return `<tr><td>${text(item.reference_code)}</td><td>${text(item.asset)}</td><td>${text(item.side).toUpperCase()}</td><td>${text(item.stake_amount)}</td><td><span class="badge ${cls}">${status.toUpperCase()}</span></td></tr>`;
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

  function renderMarkers(markers) {
    const panel = document.querySelector("[data-bo-pro-markers]");
    if (!panel || !Array.isArray(markers)) return;
    if (!markers.length) {
      panel.innerHTML = '<span class="bo-pro-marker pending">Chưa có lệnh của bạn trên chart hiện tại.</span>';
      return;
    }
    const accepted = markers.some((marker) => text(marker.status).toLowerCase() === "accepted");
    const html = markers.slice(0, 8).map((marker) => {
      const side = text(marker.side).toLowerCase();
      const status = text(marker.status).toUpperCase();
      const statusClass = status === "WON" ? "win" : status === "LOST" ? "lost" : status === "REFUNDED" ? "refunded" : "pending";
      const label = side === "buy" ? "BUY" : "SELL";
      return `<span class="bo-pro-marker ${side} ${statusClass}">${label} ${text(marker.stake_amount)} • ${status} • entry ${text(marker.entry_price)}</span>`;
    }).join("");
    panel.innerHTML = accepted ? `${html}<span class="bo-pro-marker bo-pro-sync">Đang đồng bộ kết quả sau close 60s...</span>` : html;
  }

  async function pollState() {
    if (statePending) return;
    statePending = true;
    try {
      const response = await fetch(`/api/slbo/room-state?_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      updateClock(payload.bo_clock);
      renderResults(payload.bo_results_by_asset || {});
      renderOrders(payload.orders || []);
      if (payload.wallet) setAll("[data-wallet-balance]", text(payload.wallet.available_balance));
    } finally {
      statePending = false;
    }
  }

  async function pollMarkers() {
    if (chartPending) return;
    chartPending = true;
    try {
      const response = await fetch(`/api/slbo/bo-chart?asset=${encodeURIComponent(activeAsset())}&interval=1&limit=100&_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      renderMarkers(payload.member_order_markers || []);
      if (payload.recent_results) renderResults({ [payload.asset || activeAsset()]: payload.recent_results });
    } finally {
      chartPending = false;
    }
  }

  function guardForm() {
    document.querySelectorAll('form[action^="/bo/orders"]').forEach((form) => {
      if (form.dataset.boRealtimeGuarded === "1") return;
      form.dataset.boRealtimeGuarded = "1";
      form.addEventListener("submit", (event) => {
        if (!lastClock) return;
        const age = Math.floor((Date.now() - Number(lastClock.receivedAt || 0)) / 1000);
        const remaining = Number(lastClock.remaining || 0) - age;
        if (lastClock.state !== "open" || remaining <= 0) {
          event.preventDefault();
          pollState();
          alert("Phiên đã đóng đặt lệnh. Vui lòng chờ phiên mới mở.");
        }
      });
    });
  }

  window.addEventListener("load", () => {
    guardForm();
    pollState();
    pollMarkers();
    setInterval(optimisticCountdown, 1000);
    setInterval(pollState, 1000);
    setInterval(pollMarkers, 1500);
  });
})();
