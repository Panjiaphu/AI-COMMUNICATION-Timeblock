const header = document.querySelector("[data-header]");

if (header) {
  const syncHeader = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 24);
  };

  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });
}

const revealTargets = document.querySelectorAll(".platform-flow article, .experience-layout, .admin-preview");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  revealTargets.forEach((target) => {
    target.classList.add("reveal-target");
    observer.observe(target);
  });
} else {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}

const taipeiClockTargets = document.querySelectorAll("[data-taipei-clock]");

if (taipeiClockTargets.length > 0) {
  const locale = document.documentElement.lang || "zh-TW";
  const taipeiFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const updateTaipeiClocks = () => {
    const now = new Date();
    const displayTime = taipeiFormatter.format(now);

    taipeiClockTargets.forEach((clock) => {
      clock.textContent = displayTime;
      clock.setAttribute("datetime", now.toISOString());
    });
  };

  updateTaipeiClocks();
  window.setInterval(updateTaipeiClocks, 1000);
}

const marketStatusLabels = {
  live: "Live",
  stale: "Dữ liệu chậm",
  waiting: "Đang chờ dữ liệu",
  error: "Lỗi nguồn dữ liệu",
  disabled: "Đã tắt",
};

const exchangeRateDashboard = document.querySelector("[data-exchange-rate-dashboard]");

if (exchangeRateDashboard) {
  const mobileQuery = window.matchMedia("(max-width: 767px)");
  const tabsContainer = exchangeRateDashboard.querySelector("[data-exchange-rate-tabs]");
  const tabs = Array.from(exchangeRateDashboard.querySelectorAll("[data-exchange-rate-tab]"));
  const panels = Array.from(exchangeRateDashboard.querySelectorAll("[data-exchange-rate-panel]"));
  const marketPanel = exchangeRateDashboard.querySelector('[data-exchange-rate-panel="vietnam"]');
  const manualPanel = exchangeRateDashboard.querySelector('[data-exchange-rate-panel="taiwan"]');
  let activeTab = "taiwan";
  let activeTabUserSelected = false;
  let marketRateController = null;

  const getPanel = (name) => panels.find((panel) => panel.dataset.exchangeRatePanel === name);
  const getTab = (name) => tabs.find((tab) => tab.dataset.exchangeRateTab === name);
  const isAvailable = (name) => {
    const panel = getPanel(name);
    return Boolean(panel && !panel.classList.contains("is-unavailable"));
  };

  const setPanelText = (selector, value) => {
    exchangeRateDashboard.querySelectorAll(selector).forEach((target) => {
      target.textContent = value || "-";
    });
  };

  const setAvailability = (name, available) => {
    const panel = getPanel(name);
    const tab = getTab(name);
    if (panel) panel.classList.toggle("is-unavailable", !available);
    if (tab) tab.hidden = !available;
  };

  const activateExchangeRateTab = (name, { focus = false } = {}) => {
    if (!isAvailable(name)) return;
    activeTab = name;

    tabs.forEach((tab) => {
      const selected = tab.dataset.exchangeRateTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });

    panels.forEach((panel) => {
      const selected = panel.dataset.exchangeRatePanel === name;
      panel.classList.toggle("is-tab-inactive", !selected);
      panel.setAttribute("aria-hidden", String(!selected));
    });
  };

  const syncExchangeRateDashboard = () => {
    const availableNames = panels
      .filter((panel) => !panel.classList.contains("is-unavailable"))
      .map((panel) => panel.dataset.exchangeRatePanel);

    exchangeRateDashboard.hidden = availableNames.length === 0;
    if (availableNames.length === 0) return;

    if (!activeTabUserSelected && availableNames.includes("taiwan")) activeTab = "taiwan";
    else if (!activeTabUserSelected && availableNames.includes("vietnam")) activeTab = "vietnam";
    if (!availableNames.includes(activeTab)) activeTab = availableNames[0];

    activateExchangeRateTab(activeTab);
  };

  const initializeExchangeRateTabs = () => {
    if (tabsContainer) tabsContainer.setAttribute("role", "tablist");
    tabs.forEach((tab) => {
      const name = tab.dataset.exchangeRateTab;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `exchange-rate-${name}-panel`);
    });
    panels.forEach((panel) => {
      const name = panel.dataset.exchangeRatePanel;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `exchange-rate-${name}-tab`);
    });
    syncExchangeRateDashboard();
  };

  const rateTracks = Array.from(exchangeRateDashboard.querySelectorAll("[data-exchange-rate-track]"));
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rateTrackTimers = new Map();
  const rateTrackStates = new Map();

  const rateTrackStep = (track) => {
    const card = track.querySelector("article");
    if (!card) return 0;
    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    return card.getBoundingClientRect().width + gap;
  };

  const stopRateTrack = (track) => {
    const timer = rateTrackTimers.get(track);
    if (timer) window.clearInterval(timer);
    rateTrackTimers.delete(track);
  };

  const startRateTrack = (track) => {
    stopRateTrack(track);
    if (reduceMotionQuery.matches || track.dataset.autoplay === "false") return;

    const state = rateTrackStates.get(track) || { paused: false };
    rateTrackStates.set(track, state);
    const pause = () => {
      state.paused = true;
    };
    const resume = () => {
      state.paused = false;
    };

    if (track.dataset.rateMotionBound !== "true") {
      track.addEventListener("mouseenter", pause);
      track.addEventListener("mouseleave", resume);
      track.addEventListener("focusin", pause);
      track.addEventListener("focusout", (event) => {
        if (!track.contains(event.relatedTarget)) resume();
      });
      track.addEventListener("pointerdown", () => {
        pause();
        window.setTimeout(resume, 2400);
      });
      track.dataset.rateMotionBound = "true";
    }

    const timer = window.setInterval(() => {
      if (state.paused || document.hidden || track.clientWidth === 0 || track.scrollWidth <= track.clientWidth + 4) return;
      const step = rateTrackStep(track);
      if (!step) return;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (atEnd) {
        track.scrollTo({ left: 0, behavior: "auto" });
        return;
      }
      track.scrollBy({ left: step, behavior: "smooth" });
    }, 6000);
    rateTrackTimers.set(track, timer);
  };

  const initializeRateTracks = () => {
    rateTracks.forEach((track) => startRateTrack(track));
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTabUserSelected = true;
      activateExchangeRateTab(tab.dataset.exchangeRateTab);
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const availableTabs = tabs.filter((candidate) => !candidate.hidden);
      if (!availableTabs.length) return;
      event.preventDefault();
      const currentIndex = availableTabs.indexOf(tab);
      let nextIndex = currentIndex;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % availableTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = availableTabs.length - 1;
      activateExchangeRateTab(availableTabs[nextIndex].dataset.exchangeRateTab, { focus: true });
    });
  });

  const updateMarketRatePanel = (payload) => {
    const marketAvailable = Boolean(
      (payload.enabled && payload.available) ||
      (payload.vnd_usdt_enabled && payload.vnd_usdt_available)
    );
    setAvailability("vietnam", marketAvailable);
    if (!marketAvailable) {
      syncExchangeRateDashboard();
      return;
    }

    setPanelText("[data-market-buy]", payload.market_buy_twd_vnd);
    setPanelText("[data-market-sell]", payload.market_sell_twd_vnd);
    setPanelText("[data-market-vnd-usdt-buy]", payload.market_buy_vnd_usdt);
    setPanelText("[data-market-vnd-usdt-sell]", payload.market_sell_vnd_usdt);

    const providerParts = [];
    if (payload.provider && payload.available) providerParts.push(payload.provider);
    if (payload.vnd_usdt_provider && payload.vnd_usdt_available) providerParts.push(payload.vnd_usdt_provider);
    const providerTarget = marketPanel?.querySelector("[data-market-provider]");
    if (providerTarget) {
      const label = providerTarget.dataset.label || "Nguồn";
      providerTarget.textContent = providerParts.length ? ` ${label}: ${providerParts.join(" / ")}.` : "";
    }

    const receivedAt = payload.vnd_usdt_received_at || payload.received_at;
    const receivedTarget = marketPanel?.querySelector("[data-market-received]");
    if (receivedTarget) {
      const label = receivedTarget.dataset.label || "Cập nhật";
      receivedTarget.textContent = receivedAt ? ` ${label}: ${receivedAt}` : "";
      if (receivedAt) receivedTarget.setAttribute("datetime", receivedAt);
      else receivedTarget.removeAttribute("datetime");
    }
    syncExchangeRateDashboard();
  };

  const loadMarketRate = async () => {
    if (document.hidden) return;
    if (marketRateController) marketRateController.abort();
    marketRateController = new AbortController();
    const timeout = window.setTimeout(() => marketRateController.abort(), 6000);

    try {
      const response = await fetch("/api/public/exchange-rates/market", {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: marketRateController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      updateMarketRatePanel(await response.json());
    } catch (error) {
      if (error.name !== "AbortError") {
        const statusTarget = marketPanel?.querySelector("[data-market-provider]");
        if (statusTarget) statusTarget.textContent = ` ${statusTarget.dataset.disconnected || "Mất kết nối."}`;
      }
    } finally {
      window.clearTimeout(timeout);
    }
  };

  setAvailability("taiwan", exchangeRateDashboard.dataset.manualRateAvailable === "true");
  initializeExchangeRateTabs();
  initializeRateTracks();
  mobileQuery.addEventListener("change", initializeExchangeRateTabs);
  reduceMotionQuery.addEventListener("change", initializeRateTracks);
  loadMarketRate();
  window.setInterval(loadMarketRate, 10000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadMarketRate();
  });
}

const homeExchangeRail = document.querySelector("[data-home-exchange-rail]");

if (homeExchangeRail) {
  const vietnamMarket = homeExchangeRail.querySelector('[data-home-rate-market="vietnam"]');
  const marqueeTracks = Array.from(homeExchangeRail.querySelectorAll("[data-v2-rate-marquee]"));
  let homeRateController = null;

  marqueeTracks.forEach((track) => {
    const pause = () => track.classList.add("is-paused");
    const resume = () => track.classList.remove("is-paused");
    track.addEventListener("mouseenter", pause);
    track.addEventListener("mouseleave", resume);
    track.addEventListener("focusin", pause);
    track.addEventListener("focusout", (event) => {
      if (!track.contains(event.relatedTarget)) resume();
    });
    track.addEventListener("pointerdown", () => {
      pause();
      window.setTimeout(resume, 2400);
    });
  });

  const setHomeRateField = (field, value) => {
    homeExchangeRail.querySelectorAll(`[data-home-rate-field="${field}"]`).forEach((target) => {
      target.textContent = value || "-";
    });
  };

  const updateHomeMarketRate = (payload) => {
    if (!vietnamMarket) return;
    const available = Boolean(
      (payload.enabled && payload.available) ||
      (payload.vnd_usdt_enabled && payload.vnd_usdt_available)
    );
    setHomeRateField("market_buy_twd_vnd", payload.market_buy_twd_vnd);
    setHomeRateField("market_sell_twd_vnd", payload.market_sell_twd_vnd);
    setHomeRateField("market_buy_vnd_usdt", payload.market_buy_vnd_usdt);
    setHomeRateField("market_sell_vnd_usdt", payload.market_sell_vnd_usdt);
    const status = vietnamMarket.querySelector("[data-home-rate-status]");
    if (status) {
      status.textContent = available
        ? vietnamMarket.dataset.liveLabel || "Cập nhật · UTC+8"
        : vietnamMarket.dataset.pendingLabel || "Đang chờ dữ liệu";
    }
  };

  const loadHomeMarketRate = async () => {
    if (document.hidden) return;
    if (homeRateController) homeRateController.abort();
    homeRateController = new AbortController();
    const timeout = window.setTimeout(() => homeRateController.abort(), 6000);
    try {
      const response = await fetch("/api/public/exchange-rates/market", {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: homeRateController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      updateHomeMarketRate(await response.json());
    } catch (error) {
      if (error.name !== "AbortError") {
        const status = vietnamMarket?.querySelector("[data-home-rate-status]");
        if (status) status.textContent = vietnamMarket.dataset.errorLabel || "Mất kết nối nguồn dữ liệu.";
      }
    } finally {
      window.clearTimeout(timeout);
    }
  };

  loadHomeMarketRate();
  window.setInterval(loadHomeMarketRate, 10000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadHomeMarketRate();
  });
}

const marketAdminPanel = document.querySelector("[data-market-admin-panel]");

if (marketAdminPanel) {
  const setPanelText = (selector, value) => {
    const target = marketAdminPanel.querySelector(selector);
    if (target) target.textContent = value || "-";
  };

  const setPanelValue = (selector, value) => {
    const target = marketAdminPanel.querySelector(selector);
    if (target && value !== undefined && value !== null) target.value = value;
  };

  const loadMarketAdminState = async () => {
    const statusInput = marketAdminPanel.querySelector("[data-market-admin-status]");
    const vndUsdtStatusInput = marketAdminPanel.querySelector("[data-market-admin-vnd-usdt-status]");
    try {
      const response = await fetch("/api/public/exchange-rates/market", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();

      const enabled = marketAdminPanel.querySelector("[data-market-admin-enabled]");
      if (enabled) enabled.checked = Boolean(payload.enabled);
      setPanelValue("[data-market-admin-provider]", payload.provider || "frankfurter");
      setPanelValue("[data-market-admin-adjustment]", payload.adjustment_vnd || "12");
      setPanelValue("[data-market-admin-stale]", payload.stale_after_seconds || "129600");
      if (statusInput) statusInput.value = marketStatusLabels[payload.status] || payload.status || "-";
      setPanelText("[data-market-admin-source]", payload.source_rate);
      setPanelText("[data-market-admin-buy]", payload.market_buy_twd_vnd);
      setPanelText("[data-market-admin-sell]", payload.market_sell_twd_vnd);
      setPanelText("[data-market-admin-received]", payload.received_at);

      const vndUsdtEnabled = marketAdminPanel.querySelector("[data-market-admin-vnd-usdt-enabled]");
      if (vndUsdtEnabled) vndUsdtEnabled.checked = Boolean(payload.vnd_usdt_enabled);
      setPanelValue("[data-market-admin-vnd-usdt-adjustment]", payload.adjustment_vnd_usdt || "200");
      setPanelValue("[data-market-admin-vnd-usdt-stale]", payload.vnd_usdt_stale_after_seconds || "1800");
      if (vndUsdtStatusInput) {
        vndUsdtStatusInput.value = marketStatusLabels[payload.vnd_usdt_status] || payload.vnd_usdt_status || "-";
      }
      setPanelText("[data-market-admin-vnd-usdt-source]", payload.vnd_usdt_source_rate);
      setPanelText("[data-market-admin-vnd-usdt-buy]", payload.market_buy_vnd_usdt);
      setPanelText("[data-market-admin-vnd-usdt-sell]", payload.market_sell_vnd_usdt);
      setPanelText("[data-market-admin-vnd-usdt-received]", payload.vnd_usdt_received_at);
    } catch (_error) {
      if (statusInput) statusInput.value = "Mất kết nối";
      if (vndUsdtStatusInput) vndUsdtStatusInput.value = "Mất kết nối";
    }
  };

  loadMarketAdminState();
}
