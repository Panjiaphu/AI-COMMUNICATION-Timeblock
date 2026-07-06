(() => {
  if (window.location.pathname !== "/bo") return;

  function text(value) {
    return String(value == null ? "" : value);
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
      .bo-pro-marker.pending{color:#fff1bb}
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
        <strong data-bo-pro-phase>30s đặt lệnh + 30s xử lý = nến 1 phút</strong>
        <div class="bo-pro-chart-note">
          <span>Settlement: BO System Chart 1m</span>
          <span>TradingView: reference only</span>
          <span>Delayed payout after close 60s</span>
        </div>
      </div>
      <div class="bo-pro-phase-steps">
        <span class="active" data-bo-pro-open>0-30s Open</span>
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
    if (oneMinute && active !== oneMinute) {
      oneMinute.click();
    }
    const note = document.querySelector(".bo-system-chart-meta");
    if (note && !note.querySelector("[data-bo-pro-note]")) {
      const span = document.createElement("span");
      span.setAttribute("data-bo-pro-note", "1");
      span.textContent = "Settlement = 1m candle | 30s order window | 30s risk-control window";
      note.appendChild(span);
    }
  }

  function updatePhase(clock) {
    if (!clock) return;
    ensureProPanel();
    const state = text(clock.state);
    const phase = document.querySelector("[data-bo-pro-phase]");
    const open = document.querySelector("[data-bo-pro-open]");
    const processing = document.querySelector("[data-bo-pro-processing]");
    const buttons = document.querySelectorAll(".bo-side-grid button");
    if (phase) {
      phase.textContent = state === "open"
        ? `Đang đặt lệnh: còn ${clock.remaining}s / cutoff 30s`
        : `Đang xử lý kết quả: còn ${clock.remaining}s / close 60s`;
    }
    open?.classList.toggle("active", state === "open");
    processing?.classList.toggle("active", state !== "open");
    buttons.forEach((button) => {
      button.disabled = state !== "open";
      button.classList.toggle("is-disabled", state !== "open");
    });
  }

  function markerStatusClass(marker) {
    const status = text(marker.status).toLowerCase();
    if (status === "won") return "win";
    if (status === "lost") return "lost";
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
    panel.innerHTML = markers.slice(0, 6).map((marker) => {
      const side = text(marker.side).toLowerCase();
      const statusClass = markerStatusClass(marker);
      const label = side === "buy" ? "BUY" : "SELL";
      const status = text(marker.status).toUpperCase();
      const stake = text(marker.stake_amount);
      const entry = text(marker.entry_price);
      return `<span class="bo-pro-marker ${side} ${statusClass}">${label} ${stake} • ${status} • entry ${entry}</span>`;
    }).join("");
  }

  async function pollPhase() {
    try {
      const response = await fetch(`/api/slbo/room-state?_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      updatePhase(payload.bo_clock);
    } catch (error) {
      console.warn("BO pro phase refresh failed", error);
    }
  }

  async function pollChartMarkers() {
    try {
      const response = await fetch(`/api/slbo/bo-chart?asset=BTC&interval=1&limit=80&_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      renderMarkers(payload.member_order_markers || []);
    } catch (error) {
      console.warn("BO pro chart marker refresh failed", error);
    }
  }

  window.addEventListener("load", () => {
    ensureProPanel();
    forceOneMinuteDefault();
    pollPhase();
    pollChartMarkers();
    setInterval(pollPhase, 2000);
    setInterval(pollChartMarkers, 5000);
  });
})();
