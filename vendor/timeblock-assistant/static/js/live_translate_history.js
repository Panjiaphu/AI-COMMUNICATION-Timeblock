(function (root) {
  "use strict";

  const controller = root.TimeblockLiveTranslate;
  if (!controller || controller.__translationHistoryInstalled) return;

  const app = controller.app;
  const locale = String(app?.dataset?.locale || "vi");
  const copyByLocale = {
    vi: {
      title: "Lịch sử dịch",
      subtitle: "Bản dịch thành công được mã hóa và lưu để bạn xem lại.",
      refresh: "Làm mới",
      loadMore: "Tải thêm",
      empty: "Chưa có lịch sử dịch.",
      text: "Văn bản",
      audio: "Giọng nói",
      reuse: "Dùng lại",
      copy: "Sao chép",
      listen: "Nghe",
      stop: "Dừng nghe",
      pin: "Ghim",
      unpin: "Bỏ ghim",
      remove: "Xóa",
      confirmDelete: "Xóa bản dịch này khỏi lịch sử? Lượt quota đã dùng sẽ không được hoàn lại.",
      copied: "Đã sao chép",
      failed: "Không thể tải lịch sử dịch.",
      original: "Nội dung gốc",
      transcript: "Bản ghi âm",
      translation: "Bản dịch",
    },
    en: {
      title: "Translation history",
      subtitle: "Successful translations are encrypted and saved for later review.",
      refresh: "Refresh",
      loadMore: "Load more",
      empty: "No translation history yet.",
      text: "Text",
      audio: "Voice",
      reuse: "Reuse",
      copy: "Copy",
      listen: "Listen",
      stop: "Stop",
      pin: "Pin",
      unpin: "Unpin",
      remove: "Delete",
      confirmDelete: "Delete this translation from history? Used quota will not be refunded.",
      copied: "Copied",
      failed: "Translation history could not be loaded.",
      original: "Original",
      transcript: "Transcript",
      translation: "Translation",
    },
    "zh-TW": {
      title: "翻譯紀錄",
      subtitle: "成功的翻譯會加密儲存，方便之後查看。",
      refresh: "重新整理",
      loadMore: "載入更多",
      empty: "目前沒有翻譯紀錄。",
      text: "文字",
      audio: "語音",
      reuse: "再次使用",
      copy: "複製",
      listen: "聆聽",
      stop: "停止",
      pin: "釘選",
      unpin: "取消釘選",
      remove: "刪除",
      confirmDelete: "要刪除此翻譯紀錄嗎？已使用的額度不會退還。",
      copied: "已複製",
      failed: "無法載入翻譯紀錄。",
      original: "原文",
      transcript: "語音文字",
      translation: "翻譯",
    },
  };
  const copy = copyByLocale[locale] || copyByLocale.vi;

  const bridge = {
    currentRequestId: "",
    nextBeforeId: null,
    hasMore: false,
    loading: false,
    initialized: false,
    section: null,
    list: null,
    loadMore: null,
    status: null,
    reuseRequestIdOnce: false,
    listeningHistoryId: null,
  };

  function createRequestId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    const random = Math.random().toString(36).slice(2);
    return `lt-${Date.now().toString(36)}-${random}-${random.slice(0, 8)}`;
  }

  function element(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    } catch (_error) {
      return date.toLocaleString();
    }
  }

  function setStatus(message, isError) {
    if (!bridge.status) return;
    bridge.status.textContent = message || "";
    bridge.status.classList.toggle("is-error", Boolean(isError));
  }

  function actionButton(action, label) {
    const button = element("button", "assistant-secondary-button assistant-live-history-action", label);
    button.type = "button";
    button.dataset.historyAction = action;
    return button;
  }

  function renderHistoryItem(item) {
    const card = element("article", "assistant-live-history-card");
    card.dataset.historyId = String(item.id);

    const header = element("header", "assistant-live-history-card-header");
    const heading = element("div", "assistant-live-history-meta");
    const badge = element("span", "assistant-live-history-badge", item.operation === "audio" ? copy.audio : copy.text);
    const pair = element("strong", "", `${item.source_language} -> ${item.target_language}`);
    const timestamp = element("time", "", formatDate(item.created_at));
    heading.append(badge, pair, timestamp);
    if (item.pinned) {
      const pinned = element("span", "assistant-live-history-pinned", "PIN");
      pinned.setAttribute("aria-label", copy.unpin);
      heading.append(pinned);
    }
    header.append(heading);
    card.append(header);

    const originalValue = item.operation === "audio" ? item.transcript : item.source;
    if (originalValue) {
      const originalBlock = element("div", "assistant-live-history-block");
      originalBlock.append(
        element("strong", "", item.operation === "audio" ? copy.transcript : copy.original),
        element("p", "", originalValue),
      );
      card.append(originalBlock);
    }

    const translatedBlock = element("div", "assistant-live-history-block");
    translatedBlock.append(element("strong", "", copy.translation), element("p", "", item.translation));
    card.append(translatedBlock);

    const actions = element("div", "assistant-live-history-actions");
    const reuse = actionButton("reuse", copy.reuse);
    const copyButton = actionButton("copy", copy.copy);
    const listen = actionButton("listen", copy.listen);
    const pin = actionButton("pin", item.pinned ? copy.unpin : copy.pin);
    const remove = actionButton("delete", copy.remove);
    for (const button of [reuse, copyButton, listen, pin, remove]) {
      button.dataset.historyId = String(item.id);
    }
    actions.append(reuse, copyButton, listen, pin, remove);
    card.append(actions);
    card.__historyItem = item;
    return card;
  }

  function renderHistory(items, append) {
    if (!bridge.list) return;
    if (!append) bridge.list.replaceChildren();
    for (const item of items) bridge.list.append(renderHistoryItem(item));
    if (!bridge.list.children.length) {
      bridge.list.append(element("p", "assistant-live-history-empty", copy.empty));
    }
    if (bridge.loadMore) bridge.loadMore.hidden = !bridge.hasMore;
  }

  async function fetchJson(url, options) {
    const response = await root.fetch(url, {
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(options?.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || copy.failed);
    }
    return payload;
  }

  async function loadHistory(options) {
    if (bridge.loading) return;
    bridge.loading = true;
    setStatus("", false);
    const append = Boolean(options?.append);
    const params = new URLSearchParams({ limit: "20", lang: locale });
    if (append && bridge.nextBeforeId) params.set("before_id", String(bridge.nextBeforeId));
    try {
      const payload = await fetchJson(`/translator/api/history?${params.toString()}`);
      bridge.nextBeforeId = payload.next_before_id || null;
      bridge.hasMore = Boolean(payload.has_more);
      renderHistory(Array.isArray(payload.items) ? payload.items : [], append);
    } catch (error) {
      setStatus(error?.message || copy.failed, true);
    } finally {
      bridge.loading = false;
    }
  }

  function cardItem(historyId) {
    const card = bridge.list?.querySelector(`[data-history-id="${historyId}"]`);
    return card?.__historyItem || null;
  }

  function reuseHistory(item) {
    if (!item) return;
    if (controller.elements.source) controller.elements.source.value = item.source_language;
    if (controller.elements.target) controller.elements.target.value = item.target_language;
    if (controller.elements.text) {
      controller.elements.text.value = item.operation === "audio" ? item.transcript : item.source;
    }
    controller.state.sourceLanguage = item.source_language;
    controller.state.targetLanguage = item.target_language;
    controller.cancelSupersededIntent({ preserveResult: true });
    controller.elements.text?.focus?.();
    controller.elements.form?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function copyHistory(item) {
    if (!item?.translation) return;
    try {
      await root.navigator?.clipboard?.writeText?.(item.translation);
      setStatus(copy.copied, false);
    } catch (_error) {
      setStatus(copy.failed, true);
    }
  }

  async function listenHistory(item) {
    if (!item?.translation) return;
    const sameItemPlaying = bridge.listeningHistoryId === Number(item.id)
      && Boolean(controller.state.ttsAbort || controller.state.ttsAudio);
    if (sameItemPlaying) {
      controller.stopTts();
      bridge.listeningHistoryId = null;
      return;
    }
    const generation = controller.state.generation;
    controller.stopTts({ keepPhase: true });
    bridge.listeningHistoryId = Number(item.id);
    const AbortControllerCtor = root.AbortController || AbortController;
    const abort = new AbortControllerCtor();
    controller.state.ttsAbort = abort;
    controller.setPhase(root.TimeblockLiveTranslatePhases.TTS_LOADING);
    try {
      const response = await root.fetch("/translator/api/speech", {
        method: "POST",
        credentials: "same-origin",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          text: item.translation,
          target_language: item.target_language,
          lang: locale,
        }),
      });
      if (!response.ok) throw new Error(copy.failed);
      const blob = await response.blob();
      if (!controller.isCurrent(generation) || controller.state.ttsAbort !== abort) return;
      const objectUrl = root.URL.createObjectURL(blob);
      const audio = new root.Audio();
      controller.state.ttsObjectUrl = objectUrl;
      controller.state.ttsAudio = audio;
      audio.src = objectUrl;
      audio.preload = "auto";
      audio.onended = () => {
        bridge.listeningHistoryId = null;
        controller.stopTts();
      };
      audio.onerror = () => {
        bridge.listeningHistoryId = null;
        controller.stopTts();
      };
      await audio.play();
      if (!controller.isCurrent(generation) || controller.state.ttsAudio !== audio) {
        controller.stopTts();
        return;
      }
      controller.setPhase(root.TimeblockLiveTranslatePhases.TTS_PLAYING);
    } catch (error) {
      if (error?.name === "AbortError") {
        bridge.listeningHistoryId = null;
        return;
      }
      bridge.listeningHistoryId = null;
      controller.stopTts({ keepPhase: true });
      setStatus(error?.message || copy.failed, true);
    }
  }

  async function pinHistory(item) {
    if (!item) return;
    await fetchJson(`/translator/api/history/${item.id}?lang=${encodeURIComponent(locale)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !item.pinned }),
    });
    await loadHistory({ append: false });
  }

  async function deleteHistory(item) {
    if (!item) return;
    if (typeof root.confirm === "function" && !root.confirm(copy.confirmDelete)) return;
    await fetchJson(`/translator/api/history/${item.id}?lang=${encodeURIComponent(locale)}`, {
      method: "DELETE",
    });
    await loadHistory({ append: false });
  }

  async function handleHistoryAction(event) {
    const button = event.target?.closest?.("[data-history-action]");
    if (!button) return;
    const item = cardItem(button.dataset.historyId);
    if (!item) return;
    button.disabled = true;
    try {
      switch (button.dataset.historyAction) {
        case "reuse": reuseHistory(item); break;
        case "copy": await copyHistory(item); break;
        case "listen": await listenHistory(item); break;
        case "pin": await pinHistory(item); break;
        case "delete": await deleteHistory(item); break;
        default: break;
      }
    } catch (error) {
      setStatus(error?.message || copy.failed, true);
    } finally {
      button.disabled = false;
    }
  }

  function installUi() {
    if (bridge.initialized) return;
    const host = controller.elements.panel || app?.querySelector?.("[data-live-translate]");
    if (!host) return;
    const section = element("section", "assistant-live-history");
    section.dataset.liveTranslateHistory = "";
    const header = element("header", "assistant-live-history-header");
    const titleWrap = element("div");
    titleWrap.append(element("h2", "", copy.title), element("p", "", copy.subtitle));
    const refresh = actionButton("refresh", copy.refresh);
    refresh.removeAttribute("data-history-action");
    refresh.addEventListener("click", () => loadHistory({ append: false }));
    header.append(titleWrap, refresh);

    const status = element("p", "assistant-live-history-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = element("div", "assistant-live-history-list");
    list.addEventListener("click", handleHistoryAction);
    const loadMore = actionButton("load-more", copy.loadMore);
    loadMore.removeAttribute("data-history-action");
    loadMore.hidden = true;
    loadMore.addEventListener("click", () => loadHistory({ append: true }));
    section.append(header, status, list, loadMore);
    host.append(section);

    bridge.section = section;
    bridge.list = list;
    bridge.loadMore = loadMore;
    bridge.status = status;
    bridge.initialized = true;
    loadHistory({ append: false });
  }

  const originalBeginUserIntent = controller.beginUserIntent.bind(controller);
  controller.beginUserIntent = function beginUserIntentWithHistory() {
    if (!bridge.reuseRequestIdOnce || !bridge.currentRequestId) {
      bridge.currentRequestId = createRequestId();
    }
    bridge.reuseRequestIdOnce = false;
    this.state.historyRequestId = bridge.currentRequestId;
    return originalBeginUserIntent();
  };

  const originalFormData = controller.formData.bind(controller);
  controller.formData = function formDataWithHistory(sourceLanguage, targetLanguage, text) {
    const data = originalFormData(sourceLanguage, targetLanguage, text);
    const requestId = String(this.state.historyRequestId || bridge.currentRequestId || "");
    if (requestId) data.append("request_id", requestId);
    return data;
  };

  const originalRenderResult = controller.renderResult.bind(controller);
  controller.renderResult = function renderResultWithHistory(payload, generation, targetLanguage, options) {
    const rendered = originalRenderResult(payload, generation, targetLanguage, options);
    if (rendered && payload?.history) loadHistory({ append: false });
    return rendered;
  };

  const originalRetry = controller.retry?.bind(controller);
  if (originalRetry) {
    controller.retry = function retryWithHistoryIdempotency() {
      // Text retries reuse the same idempotency key. If the server completed but
      // the response was lost, the persisted result is replayed without a second
      // provider call or quota charge. Voice retry records new audio and therefore
      // remains a new user intent with a new request id.
      if (this.state.lastIntent === "text" && bridge.currentRequestId) {
        bridge.reuseRequestIdOnce = true;
      }
      return originalRetry();
    };
  }

  const originalSetActive = controller.setActive.bind(controller);
  controller.setActive = function setActiveWithHistory(active) {
    const result = originalSetActive(active);
    if (active) {
      installUi();
      loadHistory({ append: false });
    }
    return result;
  };

  controller.__translationHistoryInstalled = true;
  root.TimeblockLiveTranslateHistory = bridge;
  installUi();
}(typeof window !== "undefined" ? window : globalThis));
