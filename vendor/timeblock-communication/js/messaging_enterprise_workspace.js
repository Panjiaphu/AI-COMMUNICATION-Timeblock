(function () {
  "use strict";

  const app = document.getElementById("assistant-app");
  const panel = app?.querySelector('[data-mode-panel="messages"]');
  const layout = panel?.querySelector("[data-messaging-layout]");
  const rail = panel?.querySelector(".assistant-contact-rail");
  const conversationList = panel?.querySelector("[data-conversation-list]");
  const threadColumn = panel?.querySelector(".assistant-thread-column");
  const threadHeader = panel?.querySelector(".assistant-thread-header");
  const threadBack = panel?.querySelector("[data-thread-back]");
  const composerStatus = panel?.querySelector("[data-call-status]");

  if (!app || !panel || !layout || !rail || !conversationList || !threadColumn || !threadHeader) return;
  if (app.dataset.enterpriseWorkspaceInitialized === "true") return;
  app.dataset.enterpriseWorkspaceInitialized = "true";

  const LIST_PANE_MIN = 280;
  const DETAIL_PANE_MIN = 480;
  const TWO_PANE_MIN = LIST_PANE_MIN + DETAIL_PANE_MIN;
  const locale = String(app.dataset.locale || "en");
  const COPY = {
    vi: { direct: "Trực tiếp", group: "Nhóm", more: "Tùy chọn cuộc trò chuyện", settings: "Cài đặt cuộc trò chuyện", security: "Thông tin bảo mật", close: "Đóng", unread: "chưa đọc", selected: "Đang chọn" },
    en: { direct: "Direct", group: "Group", more: "Conversation options", settings: "Conversation settings", security: "Security information", close: "Close", unread: "unread", selected: "Selected" },
    "zh-TW": { direct: "私訊", group: "群組", more: "對話選項", settings: "對話設定", security: "安全資訊", close: "關閉", unread: "未讀", selected: "已選取" },
    ja: { direct: "ダイレクト", group: "グループ", more: "会話オプション", settings: "会話設定", security: "セキュリティ情報", close: "閉じる", unread: "未読", selected: "選択中" },
    ko: { direct: "1:1", group: "그룹", more: "대화 옵션", settings: "대화 설정", security: "보안 정보", close: "닫기", unread: "읽지 않음", selected: "선택됨" },
    th: { direct: "ส่วนตัว", group: "กลุ่ม", more: "ตัวเลือกการสนทนา", settings: "การตั้งค่าการสนทนา", security: "ข้อมูลความปลอดภัย", close: "ปิด", unread: "ยังไม่ได้อ่าน", selected: "เลือกอยู่" },
    id: { direct: "Langsung", group: "Grup", more: "Opsi percakapan", settings: "Pengaturan percakapan", security: "Informasi keamanan", close: "Tutup", unread: "belum dibaca", selected: "Dipilih" },
  };
  const copy = COPY[locale] || COPY.en;
  const securityNote = String(composerStatus?.textContent || "").trim();
  const conversationSection = conversationList.closest(".assistant-rail-section");
  const conversationHeading = conversationSection?.querySelector("h3");

  let currentMode = "";
  let lastConversations = [];
  let savedRailScrollTop = 0;
  let savedConversationId = "";
  let overflowButton = null;
  let overflowDialog = null;
  let overflowReturnFocus = null;
  let resizeObserver = null;
  let layoutObserver = null;

  function activeConversationId() {
    return String(app.dataset.activeMessagingConversationId || "").trim();
  }

  function isTwoPane() {
    return currentMode === "two";
  }

  function formatConversationTime(value) {
    if (!value) return "";
    const raw = String(value);
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
    return new Intl.DateTimeFormat(locale || undefined, sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric" }).format(date);
  }

  function conversationName(conversation, row) {
    if (conversation?.kind === "group") return String(conversation.title || row?.querySelector("strong")?.textContent || "").trim();
    return String(
      conversation?.peer?.display_name
      || conversation?.peer?.public_id
      || row?.querySelector("strong")?.textContent
      || "",
    ).trim();
  }

  function latestConversationMessage(conversation) {
    return conversation?.latest_visible_message || conversation?.latest_message || null;
  }

  function ensureConversationLandmark() {
    if (!conversationSection || !conversationHeading) return;
    conversationSection.classList.add("messaging-enterprise-conversation-section");
    conversationSection.setAttribute("role", "navigation");
    if (!conversationHeading.id) conversationHeading.id = "messaging-enterprise-conversation-heading";
    conversationSection.setAttribute("aria-labelledby", conversationHeading.id);
    rail.classList.add("messaging-enterprise-contact-rail");
  }

  function enhanceConversationRows(conversations, selectedId = activeConversationId()) {
    lastConversations = Array.isArray(conversations) ? conversations : lastConversations;
    const selectedConversationId = String(selectedId || "").trim();
    const byId = new Map(lastConversations.map((item) => [String(item?.id ?? ""), item]));
    const rows = Array.from(conversationList.children)
      .map((child) => child.matches?.("[data-messaging-conversation-id]")
        ? child
        : child.querySelector?.("[data-messaging-conversation-id]"))
      .filter(Boolean);

    if (!rows.length) {
      conversationList.removeAttribute("role");
      conversationList.removeAttribute("aria-labelledby");
      return;
    }

    conversationList.setAttribute("role", "list");
    if (conversationHeading?.id) conversationList.setAttribute("aria-labelledby", conversationHeading.id);

    rows.forEach((row) => {
      const id = String(row.dataset.messagingConversationId || "");
      const conversation = byId.get(id) || {};
      const latestMessage = latestConversationMessage(conversation);
      const active = Boolean(id && id === selectedConversationId);
      const unread = Math.max(0, Number(conversation.unread_count) || 0);
      const isGroup = conversation.kind === "group";
      const kindLabel = isGroup ? copy.group : copy.direct;

      row.classList.add("messaging-enterprise-conversation-row");
      row.classList.toggle("is-unread", unread > 0);
      row.dataset.conversationKind = isGroup ? "group" : "direct";
      if (active) row.setAttribute("aria-current", "page");
      else row.removeAttribute("aria-current");

      const existingShell = row.closest(".messaging-enterprise-row-shell");
      if (existingShell) {
        const unreadBadge = row.querySelector(".assistant-list-count");
        if (unreadBadge) unreadBadge.setAttribute("aria-label", `${unread} ${copy.unread}`);
        const meta = row.querySelector(":scope > .messaging-enterprise-row-meta");
        const marker = meta?.querySelector(".messaging-enterprise-selected-marker");
        if (active && meta && !marker) {
          const nextMarker = document.createElement("span");
          nextMarker.className = "messaging-enterprise-selected-marker";
          nextMarker.textContent = "✓";
          nextMarker.setAttribute("aria-hidden", "true");
          nextMarker.title = copy.selected;
          meta.appendChild(nextMarker);
        } else if (!active) {
          marker?.remove();
        }
        return;
      }

      const timestamp = formatConversationTime(
        latestMessage?.created_at
        || latestMessage?.updated_at
        || conversation.updated_at
        || conversation.created_at,
      );
      const latestPreview = String(row.querySelector(".assistant-list-copy small")?.textContent || "").trim();
      const name = conversationName(conversation, row);

      const meta = document.createElement("span");
      meta.className = "messaging-enterprise-row-meta";
      const type = document.createElement("span");
      type.className = "messaging-enterprise-row-kind";
      type.textContent = kindLabel;
      meta.appendChild(type);

      if (timestamp) {
        const time = document.createElement("time");
        time.className = "messaging-enterprise-row-time";
        time.textContent = timestamp;
        const rawTime = latestMessage?.created_at || latestMessage?.updated_at || conversation.updated_at || conversation.created_at;
        if (rawTime) time.dateTime = String(rawTime);
        meta.appendChild(time);
      }

      const unreadBadge = row.querySelector(".assistant-list-count");
      if (unreadBadge) {
        unreadBadge.setAttribute("aria-label", `${unread} ${copy.unread}`);
        meta.appendChild(unreadBadge);
      }

      if (active) {
        const marker = document.createElement("span");
        marker.className = "messaging-enterprise-selected-marker";
        marker.textContent = "✓";
        marker.setAttribute("aria-hidden", "true");
        marker.title = copy.selected;
        meta.appendChild(marker);
      }
      row.appendChild(meta);

      const label = [name, kindLabel, latestPreview, timestamp, unread > 0 ? `${unread} ${copy.unread}` : ""]
        .filter(Boolean)
        .join(", ");
      if (label) row.setAttribute("aria-label", label);

      const shell = document.createElement("div");
      shell.className = "messaging-enterprise-row-shell";
      shell.setAttribute("role", "listitem");
      row.replaceWith(shell);
      shell.appendChild(row);
    });
  }

  function firstConversationRow() {
    return conversationList.querySelector("[data-messaging-conversation-id]");
  }

  function selectedConversationRow() {
    const id = activeConversationId() || savedConversationId;
    if (!id) return null;
    return conversationList.querySelector(`[data-messaging-conversation-id="${CSS.escape(id)}"]`);
  }

  function repairFocusAfterModeChange(previousMode, nextMode) {
    if (previousMode === nextMode || !layout.classList.contains("has-thread")) return;
    const active = document.activeElement;
    if (nextMode === "one" && rail.contains(active)) {
      window.requestAnimationFrame(() => threadBack?.focus?.());
    }
  }

  function syncHeaderState() {
    if (!overflowButton) return;
    overflowButton.hidden = !(isTwoPane() && activeConversationId());
  }

  function syncLayoutMode() {
    const width = layout.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    const nextMode = width + 0.5 >= TWO_PANE_MIN ? "two" : "one";
    const previousMode = currentMode;
    currentMode = nextMode;
    layout.dataset.enterpriseLayoutMode = nextMode;
    panel.dataset.enterpriseLayoutMode = nextMode;
    panel.dataset.enterpriseThreePaneEnabled = "false";
    syncHeaderState();
    repairFocusAfterModeChange(previousMode, nextMode);
  }

  function restoreCommunicationHomeFocus() {
    if (currentMode !== "one" || layout.classList.contains("has-thread")) return;
    rail.scrollTop = savedRailScrollTop;
    const target = selectedConversationRow() || firstConversationRow();
    target?.focus?.({ preventScroll: true });
  }

  function saveCommunicationHomeState(event) {
    const target = event.target instanceof Element
      ? event.target.closest("[data-messaging-conversation-id]")
      : null;
    if (!target || !conversationList.contains(target)) return;
    savedRailScrollTop = rail.scrollTop;
    savedConversationId = String(target.dataset.messagingConversationId || "");
  }

  function focusableElements(container) {
    return Array.from(container.querySelectorAll(
      'button:not([disabled]):not([hidden]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.closest("[hidden]"));
  }

  function closeOverflowDialog() {
    if (!overflowDialog) return;
    if (typeof overflowDialog.close === "function" && overflowDialog.open) overflowDialog.close();
    else overflowDialog.removeAttribute("open");
  }

  function openOverflowDialog() {
    if (!overflowDialog || overflowButton?.hidden) return;
    overflowReturnFocus = document.activeElement;
    if (typeof overflowDialog.showModal === "function") overflowDialog.showModal();
    else overflowDialog.setAttribute("open", "");
    window.requestAnimationFrame(() => focusableElements(overflowDialog)[0]?.focus?.());
  }

  function buildHeaderOverflow() {
    if (overflowButton || overflowDialog) return;

    overflowButton = document.createElement("button");
    overflowButton.type = "button";
    overflowButton.className = "assistant-icon-button messaging-enterprise-header-overflow";
    overflowButton.dataset.enterpriseHeaderOverflow = "true";
    overflowButton.textContent = "⋯";
    overflowButton.setAttribute("aria-label", copy.more);
    overflowButton.setAttribute("title", copy.more);
    overflowButton.setAttribute("aria-haspopup", "dialog");
    overflowButton.hidden = true;
    overflowButton.addEventListener("click", openOverflowDialog);
    threadHeader.appendChild(overflowButton);

    overflowDialog = document.createElement("dialog");
    overflowDialog.className = "messaging-enterprise-overflow-dialog";
    overflowDialog.setAttribute("aria-label", copy.more);

    const heading = document.createElement("strong");
    heading.className = "messaging-enterprise-overflow-title";
    heading.textContent = copy.more;

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "messaging-enterprise-overflow-action";
    settings.textContent = copy.settings;
    settings.addEventListener("click", () => {
      const source = panel.querySelector(".messaging-v2-thread-toolbar .messaging-v2-button.is-primary");
      closeOverflowDialog();
      source?.click();
    });

    const security = document.createElement("button");
    security.type = "button";
    security.className = "messaging-enterprise-overflow-action";
    security.textContent = copy.security;
    security.setAttribute("aria-expanded", "false");

    const securityCopy = document.createElement("p");
    securityCopy.className = "messaging-enterprise-security-copy";
    securityCopy.textContent = securityNote;
    securityCopy.hidden = true;
    security.addEventListener("click", () => {
      securityCopy.hidden = !securityCopy.hidden;
      security.setAttribute("aria-expanded", String(!securityCopy.hidden));
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "messaging-enterprise-overflow-close";
    close.textContent = copy.close;
    close.addEventListener("click", closeOverflowDialog);

    overflowDialog.append(heading, settings, security, securityCopy, close);
    overflowDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeOverflowDialog();
    });
    overflowDialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverflowDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(overflowDialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    overflowDialog.addEventListener("close", () => {
      if (overflowReturnFocus?.isConnected) overflowReturnFocus.focus();
      overflowReturnFocus = null;
      securityCopy.hidden = true;
      security.setAttribute("aria-expanded", "false");
    });
    document.body.appendChild(overflowDialog);
  }

  function visibleRect(element) {
    if (!element || getComputedStyle(element).display === "none") return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }

  function getMetrics() {
    const layoutRect = layout.getBoundingClientRect();
    const listRect = visibleRect(rail);
    const detailRect = visibleRect(threadColumn);
    const tolerance = 1.5;
    const paneClipping = [listRect, detailRect].filter(Boolean).some((rect) => (
      rect.left < layoutRect.left - tolerance
      || rect.right > layoutRect.right + tolerance
      || rect.top < layoutRect.top - tolerance
      || rect.bottom > layoutRect.bottom + tolerance
    ));
    return {
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      workspace_inline_size: Number(layoutRect.width.toFixed(2)),
      layout_mode: currentMode || layout.dataset.enterpriseLayoutMode || "",
      list_pane_width: Number((listRect?.width || 0).toFixed(2)),
      detail_pane_width: Number((detailRect?.width || 0).toFixed(2)),
      has_thread: layout.classList.contains("has-thread"),
      pane_clipping: paneClipping,
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || layout.scrollWidth > layout.clientWidth + 1,
      three_pane_enabled: false,
    };
  }

  ensureConversationLandmark();
  buildHeaderOverflow();
  syncLayoutMode();

  conversationList.addEventListener("click", saveCommunicationHomeState, true);
  threadBack?.addEventListener("click", () => {
    window.requestAnimationFrame(() => {
      syncLayoutMode();
      restoreCommunicationHomeFocus();
    });
  });

  app.addEventListener("timeblock:messaging:conversations", (event) => {
    enhanceConversationRows(event.detail?.conversations || [], activeConversationId());
    syncLayoutMode();
  });
  app.addEventListener("timeblock:messaging:conversation", (event) => {
    const id = String(event.detail?.conversation?.id || "");
    if (id) savedConversationId = id;
    enhanceConversationRows(lastConversations, id || activeConversationId());
    syncLayoutMode();
  });

  resizeObserver = new ResizeObserver(syncLayoutMode);
  resizeObserver.observe(layout);
  layoutObserver = new MutationObserver(() => {
    syncLayoutMode();
    syncHeaderState();
  });
  layoutObserver.observe(layout, { attributes: true, attributeFilter: ["class", "hidden"] });

  window.addEventListener("pageshow", syncLayoutMode, { passive: true });
  window.addEventListener("orientationchange", syncLayoutMode, { passive: true });
  window.addEventListener("pagehide", () => {
    resizeObserver?.disconnect();
    layoutObserver?.disconnect();
    closeOverflowDialog();
  }, { once: true });

  window.TimeblockMessagingEnterpriseWorkspace = Object.freeze({
    getMetrics,
    listPaneMin: LIST_PANE_MIN,
    detailPaneMin: DETAIL_PANE_MIN,
    twoPaneMin: TWO_PANE_MIN,
    threePaneEnabled: false,
    semanticModel: "navigation + list/listitem + native conversation buttons",
    headerSemanticModel: "native button group in ordinary Tab order; no ARIA toolbar role",
    containerQueryAdopted: false,
  });
}());
