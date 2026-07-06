(() => {
  if (window.location.pathname !== "/bo") return;

  function text(value) {
    return String(value == null ? "" : value);
  }

  function ensureProPanel() {
    const frame = document.querySelector(".bo-chart-frame");
    if (!frame || document.querySelector(".bo-pro-phase-panel")) return;
    const panel = document.createElement("div");
    panel.className = "bo-pro-phase-panel";
    panel.innerHTML = `
      <div>
        <span>BO settlement</span>
        <strong data-bo-pro-phase>30s đặt lệnh + 30s xử lý = nến 1 phút</strong>
      </div>
      <div class="bo-pro-phase-steps">
        <span class="active" data-bo-pro-open>0-30s Open</span>
        <span data-bo-pro-processing>30-60s Processing</span>
        <span>Settlement: BO System Chart 1m</span>
        <span>TradingView: reference only</span>
      </div>
    `;
    const head = frame.querySelector(".bo-chart-head");
    if (head && head.nextSibling) {
      frame.insertBefore(panel, head.nextSibling);
    } else {
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

  window.addEventListener("load", () => {
    ensureProPanel();
    forceOneMinuteDefault();
    pollPhase();
    setInterval(pollPhase, 2000);
  });
})();
