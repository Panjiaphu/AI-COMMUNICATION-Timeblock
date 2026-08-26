(function () {
  "use strict";

  var root = document.querySelector("[data-market-assistant]");
  if (!root) return;
  var hubLink = root.querySelector("[data-assistant-hub-link]");
  if (hubLink) {
    var hubBadge = root.querySelector("[data-assistant-unread]");
    var globalBadges = document.querySelectorAll("[data-global-assistant-badge]");
    var drag = { active: false, moved: false, x: 0, y: 0, left: 0, top: 0 };
    try {
      var savedPosition = JSON.parse(window.localStorage.getItem("timeblock-assistant-position") || "null");
      if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
        root.style.left = Math.max(8, Math.min(window.innerWidth - 58, savedPosition.left)) + "px";
        root.style.top = Math.max(8, Math.min(window.innerHeight - 58, savedPosition.top)) + "px";
        root.style.right = "auto";
        root.style.bottom = "auto";
      }
    } catch (_) { /* Local storage may be unavailable in private browsing. */ }
    hubLink.addEventListener("pointerdown", function (event) {
      var rect = root.getBoundingClientRect();
      drag = { active: true, moved: false, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      hubLink.setPointerCapture(event.pointerId);
    });
    hubLink.addEventListener("pointermove", function (event) {
      if (!drag.active) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 7 && !drag.moved) return;
      drag.moved = true;
      var left = Math.max(8, Math.min(window.innerWidth - root.offsetWidth - 8, drag.left + dx));
      var top = Math.max(8, Math.min(window.innerHeight - root.offsetHeight - 8, drag.top + dy));
      root.style.left = left + "px";
      root.style.top = top + "px";
      root.style.right = "auto";
      root.style.bottom = "auto";
    });
    hubLink.addEventListener("pointerup", function (event) {
      drag.active = false;
      try { hubLink.releasePointerCapture(event.pointerId); } catch (_) {}
      if (drag.moved) {
        try { window.localStorage.setItem("timeblock-assistant-position", JSON.stringify({ left: parseFloat(root.style.left), top: parseFloat(root.style.top) })); } catch (_) {}
      }
    });
    hubLink.addEventListener("click", function (event) {
      if (drag.moved) { event.preventDefault(); drag.moved = false; }
    });
    function updateHubBadges() {
      if (root.dataset.assistantAuthenticated !== "true") return;
      if (document.hidden) return;
      fetch("/api/messaging/notifications/summary", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (response) { if (!response.ok) throw new Error("summary"); return response.json(); })
        .then(function (payload) {
          var count = Number((payload.summary || {}).total || 0);
          [hubBadge].concat(Array.prototype.slice.call(globalBadges)).forEach(function (badge) {
            if (!badge) return;
            badge.hidden = count < 1;
            badge.textContent = count > 99 ? "99+" : String(count);
          });
        })
        .catch(function () { /* The assistant entry point must survive a summary outage. */ });
    }
    if (root.dataset.assistantAuthenticated === "true") {
      updateHubBadges();
      window.setInterval(updateHubBadges, 15000);
    }
    return;
  }
  var panel = root.querySelector("[data-assistant-panel]");
  var toggleButtons = root.querySelectorAll("[data-assistant-toggle]");
  var answer = root.querySelector("[data-assistant-answer]");
  var status = root.querySelector("[data-assistant-status]");
  var input = root.querySelector("[data-assistant-input]");
  var unread = root.querySelector("[data-assistant-unread]");
  var locale = root.dataset.assistantLocale || document.documentElement.lang || "vi";
  var context = null;
  var dragging = false;
  var moved = false;
  var userPositioned = false;
  var pointerOffset = { x: 0, y: 0 };
  var pointerStart = { x: 0, y: 0 };
  var pollTimer = null;
  var dockTimer = null;

  var copy = {
    loading: root.dataset.assistantLoading || "...",
    unavailable: root.dataset.assistantUnavailable || "",
    error: root.dataset.assistantError || root.dataset.assistantUnavailable || "",
    alertSaved: root.dataset.assistantAlertSaved || "OK",
    messageSent: root.dataset.assistantMessageSent || "OK",
    sourceDefault: root.dataset.assistantSourceDefault || "Timeblock Signal Engine",
  };

  function withLang(url) {
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "lang=" + encodeURIComponent(locale);
  }

  function setStatus(text) {
    if (status) status.textContent = text || "";
  }

  function contextType() {
    return root.dataset.assistantContextType === "equities" ? "equities" : "market";
  }

  function endpoint() {
    if (contextType() === "equities") {
      return withLang(
        "/chat/context/equities?country=" +
          encodeURIComponent(root.dataset.assistantCountry || "usa") +
          "&symbol=" +
          encodeURIComponent(root.dataset.assistantSymbol || "")
      );
    }
    return withLang("/chat/context/market");
  }

  function analyze(message, activeContext) {
    return fetch(withLang("/chat/context/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message: message || "", context: activeContext || context }),
    }).then(function (response) {
      if (!response.ok) throw new Error("analyze_" + response.status);
      return response.json();
    });
  }

  function loadContext() {
    setStatus(copy.loading);
    return fetch(endpoint(), { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("context_" + response.status);
        return response.json();
      })
      .then(function (payload) {
        context = payload;
        setStatus(payload.source || copy.sourceDefault);
        return analyze("", payload);
      })
      .then(function (payload) {
        if (payload && answer) answer.textContent = payload.answer || copy.unavailable;
        return evaluateAlerts();
      })
      .then(loadUnreadCount)
      .catch(function () {
        setStatus(copy.error);
        if (answer) answer.textContent = copy.unavailable;
      });
  }

  function evaluateAlerts() {
    if (!context) return Promise.resolve();
    return fetch("/api/internal-messages/alerts/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ context: context, lang: locale }),
    }).catch(function () {
      return null;
    });
  }

  function loadUnreadCount() {
    return fetch("/api/internal-messages/inbox?count_only=1", {
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("inbox_" + response.status);
        return response.json();
      })
      .then(function (payload) {
        var count = Number(payload.unread_count || 0);
        if (unread) {
          unread.hidden = count === 0;
          unread.textContent = count > 99 ? "99+" : String(count);
        }
      })
      .catch(function () {
        /* An inbox outage must not hide the assistant or market page. */
      });
  }

  function syncMobileDock() {
    if (userPositioned) return;

    if (!window.matchMedia("(max-width: 600px)").matches) {
      root.style.removeProperty("--assistant-mobile-bottom");
      return;
    }

    var mobileNav = document.querySelector(".mobile-bottom-nav");
    if (!mobileNav || window.getComputedStyle(mobileNav).display === "none") {
      root.style.removeProperty("--assistant-mobile-bottom");
      return;
    }

    var navRect = mobileNav.getBoundingClientRect();
    var navOffset = Math.max(0, window.innerHeight - navRect.top);
    var bottomOffset = Math.max(92, Math.round(navOffset + 12));
    root.style.setProperty("--assistant-mobile-bottom", bottomOffset + "px");
  }

  function scheduleMobileDock() {
    window.clearTimeout(dockTimer);
    dockTimer = window.setTimeout(syncMobileDock, 80);
  }

  function toggle(open) {
    var shouldOpen = open == null ? panel.hidden : open;
    panel.hidden = !shouldOpen;
    toggleButtons.forEach(function (button) {
      button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    });
    if (shouldOpen && !context) loadContext();
  }

  toggleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (!moved) toggle();
      moved = false;
    });
  });

  root.querySelector("[data-assistant-form]").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!input || !input.value.trim()) return;
    if (answer) answer.textContent = copy.loading;
    analyze(input.value.trim(), context)
      .then(function (payload) {
        if (answer) answer.textContent = payload.answer || copy.unavailable;
        input.value = "";
      })
      .catch(function () {
        if (answer) answer.textContent = copy.unavailable;
      });
  });

  root.querySelector("[data-assistant-alert-form]").addEventListener("submit", function (event) {
    event.preventDefault();
    var alertStatus = root.querySelector("[data-assistant-alert-status]");
    var condition = root.querySelector("[data-assistant-condition]").value;
    var threshold = Number(root.querySelector("[data-assistant-threshold]").value);
    var payload = {
      market: contextType() === "equities" ? "equities" : "crypto",
      condition: condition,
      threshold: threshold,
      symbol: (context && context.symbol) || root.dataset.assistantSymbol || "",
      country: (context && context.country && context.country.key) || root.dataset.assistantCountry || "",
    };

    fetch("/api/internal-messages/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("alert_" + response.status);
        return response.json();
      })
      .then(function () {
        if (alertStatus) alertStatus.textContent = copy.alertSaved;
      })
      .catch(function () {
        if (alertStatus) alertStatus.textContent = copy.error;
      });
  });

  root.querySelector("[data-assistant-message-form]").addEventListener("submit", function (event) {
    event.preventDefault();
    var messageStatus = root.querySelector("[data-assistant-message-status]");
    var content = root.querySelector("[data-assistant-message-content]");
    var payload = {
      receiver_type: root.querySelector("[data-assistant-recipient-type]").value,
      receiver_id: root.querySelector("[data-assistant-recipient-id]").value.trim(),
      title: root.querySelector("[data-assistant-message-title]").value.trim(),
      content: content.value.trim(),
      context: context || {},
    };

    fetch("/api/internal-messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("message_" + response.status);
        return response.json();
      })
      .then(function () {
        if (messageStatus) messageStatus.textContent = copy.messageSent;
        content.value = "";
        loadUnreadCount();
      })
      .catch(function () {
        if (messageStatus) messageStatus.textContent = copy.error;
      });
  });

  var pet = root.querySelector(".market-assistant-pet");
  pet.addEventListener("pointerdown", function (event) {
    dragging = true;
    moved = false;
    pointerStart = { x: event.clientX, y: event.clientY };
    pet.setPointerCapture(event.pointerId);
    var rect = pet.getBoundingClientRect();
    pointerOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });

  pet.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    if (Math.abs(event.clientX - pointerStart.x) + Math.abs(event.clientY - pointerStart.y) > 4) moved = true;
    var left = Math.max(8, Math.min(window.innerWidth - pet.offsetWidth - 8, event.clientX - pointerOffset.x));
    var top = Math.max(8, Math.min(window.innerHeight - pet.offsetHeight - 8, event.clientY - pointerOffset.y));
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  });

  function finishDrag(event) {
    dragging = false;
    if (moved) userPositioned = true;
    try {
      pet.releasePointerCapture(event.pointerId);
    } catch (_) {
      /* Pointer may already be released by the browser. */
    }
  }

  pet.addEventListener("pointerup", finishDrag);
  pet.addEventListener("pointercancel", finishDrag);

  syncMobileDock();
  window.addEventListener("resize", scheduleMobileDock, { passive: true });
  window.addEventListener("orientationchange", scheduleMobileDock, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleMobileDock, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleMobileDock, { passive: true });
  }

  loadUnreadCount();
  pollTimer = window.setInterval(function () {
    loadUnreadCount();
    if (panel && !panel.hidden) loadContext();
  }, 60000);
  window.addEventListener("pagehide", function () {
    window.clearInterval(pollTimer);
    window.clearTimeout(dockTimer);
  });
})();
