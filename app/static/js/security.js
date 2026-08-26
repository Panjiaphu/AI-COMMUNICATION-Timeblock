document.addEventListener("DOMContentLoaded", () => {
  const consoleElement = document.getElementById("security-live-console");
  const tableBody = document.getElementById("security-events-body");
  const stateElement = document.getElementById("security-live-state");
  const clockElement = document.getElementById("security-taipei-clock");
  const lastSyncElement = document.getElementById("security-last-sync");

  const setButtonBusy = (form) => {
    const button = form.querySelector("button[type='submit']");
    if (button) {
      button.disabled = true;
      button.textContent = "處理中";
    }
  };

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-security-action], .email-reply-form");
    if (!form) return;
    const action = form.dataset.securityAction;
    if (action === "block" && !window.confirm("確認套用此 IP 封鎖期限？")) {
      event.preventDefault();
      return;
    }
    if (action === "revoke" && !window.confirm("確認解除此 IP 的有效封鎖？")) {
      event.preventDefault();
      return;
    }
    setButtonBusy(form);
  });

  const formatTaipei = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  };

  const updateClock = () => {
    if (clockElement) clockElement.textContent = formatTaipei(new Date().toISOString());
  };
  updateClock();
  window.setInterval(updateClock, 1000);

  if (!consoleElement || !tableBody) return;

  const eventsUrl = consoleElement.dataset.eventsUrl;
  const actionBase = (consoleElement.dataset.actionBase || "/admin/security").replace(/\/$/, "");
  const csrfToken = consoleElement.dataset.csrfToken || "";
  const filtered = consoleElement.dataset.filtered === "true";
  const basePollMilliseconds = Math.max(
    2000,
    Number.parseInt(consoleElement.dataset.pollSeconds || "5", 10) * 1000,
  );
  let cursor = Math.max(0, Number.parseInt(consoleElement.dataset.cursor || "0", 10));
  let since = consoleElement.dataset.serverTime || new Date().toISOString();
  let retryMilliseconds = basePollMilliseconds;
  let timerId = null;
  let stopped = false;

  const value = (input, fallback = "-") => {
    if (input === null || input === undefined || input === "") return fallback;
    return String(input);
  };

  const appendText = (parent, text, className = "", tagName = "small") => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value(text);
    parent.appendChild(element);
    return element;
  };

  const riskPill = (text, className) => {
    const pill = document.createElement("span");
    pill.className = `risk-pill ${className || ""}`.trim();
    pill.textContent = value(text);
    return pill;
  };

  const buildActionForm = (securityEvent) => {
    const container = document.createElement("div");
    if (securityEvent.block_state === "blocked") {
      const form = document.createElement("form");
      form.method = "post";
      form.action = `${actionBase}/${securityEvent.id}/revoke-block`;
      form.dataset.securityAction = "revoke";
      const token = document.createElement("input");
      token.type = "hidden";
      token.name = "csrf_token";
      token.value = csrfToken;
      const button = document.createElement("button");
      button.type = "submit";
      button.className = "secondary-action";
      button.textContent = "解除封鎖";
      form.append(token, button);
      container.appendChild(form);
      return container;
    }

    if (securityEvent.is_current_admin_ip) {
      container.appendChild(riskPill("禁止自我封鎖", "protected"));
      return container;
    }

    if (!["medium", "high", "critical"].includes(securityEvent.suspicious_status)) {
      container.textContent = "僅記錄";
      return container;
    }

    const form = document.createElement("form");
    form.method = "post";
    form.action = `${actionBase}/${securityEvent.id}/confirm-block`;
    form.dataset.securityAction = "block";

    const token = document.createElement("input");
    token.type = "hidden";
    token.name = "csrf_token";
    token.value = csrfToken;

    const label = document.createElement("label");
    label.className = "security-duration-label";
    label.appendChild(document.createTextNode("期限 "));
    const select = document.createElement("select");
    select.name = "duration_seconds";
    [
      ["3600", "1 小時"],
      ["86400", "24 小時"],
      ["604800", "7 天"],
      ["0", "永久"],
    ].forEach(([duration, labelText]) => {
      const option = document.createElement("option");
      option.value = duration;
      option.textContent = labelText;
      option.selected = duration === "86400";
      select.appendChild(option);
    });
    label.appendChild(select);

    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "確認封鎖";
    form.append(token, label, button);
    container.appendChild(form);
    return container;
  };

  const buildEventRow = (securityEvent) => {
    const row = document.createElement("tr");
    row.id = `security-event-${securityEvent.id}`;
    row.dataset.eventId = value(securityEvent.id, "0");

    const insertLabeledCell = (label) => {
      const cell = row.insertCell();
      cell.dataset.label = label;
      return cell;
    };

    const timeCell = insertLabeledCell("事件時間");
    const time = document.createElement("time");
    time.dateTime = value(securityEvent.last_seen_at || securityEvent.created_at, "");
    time.textContent = formatTaipei(securityEvent.last_seen_at || securityEvent.created_at);
    timeCell.appendChild(time);
    appendText(timeCell, `首次 ${formatTaipei(securityEvent.first_seen_at || securityEvent.created_at)}`);
    if (Number(securityEvent.occurrence_count || 1) > 1) {
      timeCell.appendChild(riskPill(`×${securityEvent.occurrence_count}`, "count"));
    }

    const sourceCell = insertLabeledCell("Client IP / Proxy");
    sourceCell.className = "security-identity-cell";
    appendText(sourceCell, "Client IP", "security-cell-kicker");
    appendText(sourceCell, securityEvent.ip_address, "security-ip-value", "strong");
    if (securityEvent.is_current_admin_ip) {
      sourceCell.appendChild(riskPill("目前管理員 IP", "protected"));
    }
    appendText(sourceCell, `Proxy: ${value(securityEvent.observed_remote_ip)}`);
    appendText(sourceCell, `${value(securityEvent.ip_source)} / ${value(securityEvent.ip_confidence)}`);
    if (securityEvent.cf_ray) appendText(sourceCell, `Ray: ${securityEvent.cf_ray}`);

    const regionCell = insertLabeledCell("國家 / 區域");
    regionCell.className = "security-location-cell";
    appendText(regionCell, securityEvent.country_label, "", "strong");
    appendText(regionCell, securityEvent.region_detail);
    appendText(
      regionCell,
      `來源 ${value(securityEvent.country_source, "unavailable")} / ${value(securityEvent.location_confidence, "low")}`,
    );
    appendText(regionCell, `Raw: ${value(securityEvent.region, "unknown")}`);

    const actorCell = insertLabeledCell("Actor");
    actorCell.appendChild(document.createTextNode(value(securityEvent.actor_type)));
    if (securityEvent.verified_bot) appendText(actorCell, "verified bot");

    const eventCell = insertLabeledCell("事件");
    eventCell.appendChild(document.createTextNode(value(securityEvent.event_type)));
    appendText(eventCell, `${value(securityEvent.http_method)} ${value(securityEvent.request_path)}`);
    appendText(eventCell, securityEvent.user_agent);

    const riskCell = insertLabeledCell("可疑狀態");
    riskCell.appendChild(riskPill(securityEvent.suspicious_status, securityEvent.suspicious_status));

    const signalCell = insertLabeledCell("攻擊訊號");
    signalCell.appendChild(document.createTextNode(value(securityEvent.attack_signal)));
    appendText(signalCell, securityEvent.matched_rule);
    appendText(signalCell, securityEvent.note);

    const defenseCell = insertLabeledCell("防禦動作");
    defenseCell.appendChild(document.createTextNode(value(securityEvent.defense_action)));
    appendText(defenseCell, securityEvent.defense_guidance);

    const blockCell = insertLabeledCell("封鎖狀態");
    blockCell.appendChild(riskPill(securityEvent.block_label, securityEvent.block_state));
    if (securityEvent.block_expires_at) {
      appendText(blockCell, `到期 ${formatTaipei(securityEvent.block_expires_at)}`);
    }

    const actionCell = insertLabeledCell("操作");
    actionCell.appendChild(buildActionForm(securityEvent));
    return row;
  };

  const upsertEvent = (securityEvent) => {
    const existing = document.getElementById(`security-event-${securityEvent.id}`);
    const row = buildEventRow(securityEvent);
    if (existing) {
      existing.replaceWith(row);
    } else {
      document.getElementById("security-empty-row")?.remove();
      tableBody.prepend(row);
    }
    while (tableBody.rows.length > 200) {
      tableBody.deleteRow(tableBody.rows.length - 1);
    }
  };

  const setMetric = (id, metricValue) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value(metricValue, "0");
  };

  const setState = (label, className) => {
    if (!stateElement) return;
    stateElement.textContent = label;
    stateElement.className = `risk-pill ${className}`;
  };

  const schedule = (milliseconds) => {
    if (stopped) return;
    window.clearTimeout(timerId);
    timerId = window.setTimeout(poll, milliseconds);
  };

  const poll = async () => {
    if (stopped) return;
    if (document.hidden) {
      setState("PAUSED", "paused");
      schedule(basePollMilliseconds);
      return;
    }

    try {
      const url = new URL(eventsUrl, window.location.origin);
      url.searchParams.set("after_id", String(cursor));
      url.searchParams.set("since", since);
      url.searchParams.set("limit", "100");
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();

      setMetric("security-metric-total", payload.metrics?.total);
      setMetric("security-metric-review", payload.metrics?.needs_review);
      setMetric("security-metric-high-risk", payload.metrics?.high_risk);
      setMetric("security-metric-blocked", payload.metrics?.blocked);

      if (!filtered) {
        (payload.events || []).forEach(upsertEvent);
      }
      cursor = Math.max(cursor, Number(payload.next_cursor || 0));
      since = payload.server_time_utc || new Date().toISOString();
      retryMilliseconds = basePollMilliseconds;
      setState(filtered ? "FILTERED" : "LIVE", filtered ? "paused" : "live");
      if (lastSyncElement) lastSyncElement.textContent = formatTaipei(payload.server_time_utc);
      schedule(basePollMilliseconds);
    } catch (error) {
      retryMilliseconds = Math.min(Math.max(basePollMilliseconds, retryMilliseconds * 2), 60000);
      setState("ERROR", "error");
      if (lastSyncElement) lastSyncElement.textContent = `同步失敗，${Math.round(retryMilliseconds / 1000)} 秒後重試`;
      schedule(retryMilliseconds);
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      retryMilliseconds = basePollMilliseconds;
      schedule(0);
    }
  });

  window.addEventListener("beforeunload", () => {
    stopped = true;
    window.clearTimeout(timerId);
  });

  schedule(basePollMilliseconds);
});
