(() => {
  "use strict";

  const root = document.getElementById("assistant-app");
  const copyElement = document.getElementById("assistant-image-generation-copy");
  if (!root || !copyElement) return;

  let copy = {};
  try {
    copy = JSON.parse(copyElement.textContent || "{}");
  } catch (_error) {
    return;
  }

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const text = (key) => String(copy[key] || key);

  function createElement(tagName, className = "", content = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (content) element.textContent = content;
    return element;
  }

  function safePrivateMediaUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/assistant/media/")) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function formatExpiry(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(root.dataset.locale || "vi", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch (_error) {
      return "";
    }
  }

  function setStatus(status, message, isError = false) {
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  }

  function updateImageQuota(usage) {
    const meter = usage?.buckets?.image;
    if (!meter) return;
    const card = $('[data-quota-card="image"]');
    const value = card?.querySelector("[data-quota-value]");
    if (value) value.textContent = `${meter.remaining}/${meter.limit}`;
  }

  function errorText(payload) {
    const code = String(payload?.error || payload?.code || "");
    const detailCode = String(payload?.detail_code || "");
    const detailCopy = {
      "assistant.provider_not_configured": "provider_not_configured",
      "assistant.provider_auth": "provider_auth",
      "assistant.provider_billing_required": "provider_billing_required",
      "assistant.provider_model_access": "provider_model_access",
      "assistant.provider_moderation": "provider_moderation",
      "assistant.provider_connection": "provider_connection",
      "assistant.provider_failed": "provider_failed",
    }[detailCode];
    if (detailCopy) return text(detailCopy);
    if (code === "assistant.image_prompt_required") return text("prompt_required");
    if (code === "assistant.image_prompt_too_long") return text("prompt_too_long");
    if (code === "assistant.image_generation_disabled") return text("disabled");
    if (code === "assistant.image_generation_unavailable" || code === "assistant.provider_unavailable") {
      return text("unavailable");
    }
    if (code === "assistant.daily_limit") return text("failed");
    return text("failed");
  }

  function imageActions(figure, image, prompt, panel) {
    const actions = createElement("div", "assistant-image-generation-actions");
    const source = safePrivateMediaUrl(image.src);
    if (source) {
      const download = createElement("a", "assistant-image-generation-action", text("download"));
      download.href = source;
      download.download = "timeblock-assistant-image.webp";
      download.rel = "noreferrer";
      actions.appendChild(download);
    }
    const fullscreen = createElement("button", "assistant-image-generation-action", text("fullscreen"));
    fullscreen.type = "button";
    fullscreen.addEventListener("click", () => {
      if (typeof image.requestFullscreen === "function") image.requestFullscreen().catch(() => undefined);
    });
    actions.appendChild(fullscreen);
    const regenerate = createElement("button", "assistant-image-generation-action", text("regenerate"));
    regenerate.type = "button";
    regenerate.addEventListener("click", () => {
      panel.hidden = false;
      panel.querySelector("[data-image-generation-prompt]").value = prompt || "";
      panel.querySelector("[data-image-generation-prompt]").focus();
    });
    actions.appendChild(regenerate);
    figure.appendChild(actions);
  }

  function renderMessage(message, prompt, panel) {
    if (!message || !message.role) return null;
    const isUser = message.role === "user";
    const article = createElement(
      "article",
      `assistant-message ${isUser ? "is-user" : "is-assistant"}`,
    );
    if (message.id) article.dataset.aiMessageId = String(message.id);
    const avatar = createElement("span", "assistant-list-avatar", isUser ? text("you") : text("assistant"));
    avatar.setAttribute("aria-hidden", "true");
    const content = createElement("div", "assistant-message-content");
    content.appendChild(createElement("strong", "", isUser ? text("you") : text("assistant")));
    const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
    const attachment = metadata.attachment && typeof metadata.attachment === "object"
      ? metadata.attachment
      : null;
    const source = safePrivateMediaUrl(attachment?.url);
    if (source && String(attachment?.mime_type || "").startsWith("image/")) {
      const figure = createElement("figure", "assistant-private-media assistant-message-image");
      const image = createElement("img");
      image.src = source;
      image.alt = text("title");
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      const expiry = formatExpiry(attachment.expires_at);
      const caption = createElement(
        "figcaption",
        "",
        expiry ? text("media_expires").replace("{date}", expiry) : text("media_retention"),
      );
      figure.append(image, caption);
      if (!isUser && metadata.image_generation) imageActions(figure, image, prompt, panel);
      content.appendChild(figure);
    }
    const messageText = String(message.content || "");
    if (messageText) content.appendChild(createElement("div", "assistant-message-bubble", messageText));
    article.append(avatar, content);
    return article;
  }

  function appendMessages(messages, panel) {
    const container = $("[data-ai-messages]");
    if (!container || !Array.isArray(messages)) return null;
    const existing = new Set(
      $$('[data-ai-message-id]', container).map((item) => item.dataset.aiMessageId),
    );
    let lastUserPrompt = "";
    let lastRendered = null;
    messages.forEach((message) => {
      if (message?.role === "user") lastUserPrompt = String(message.content || "");
      if (!message?.id || existing.has(String(message.id))) return;
      const rendered = renderMessage(message, lastUserPrompt, panel);
      if (rendered) {
        const empty = $("[data-ai-empty]", container);
        if (empty) empty.remove();
        container.appendChild(rendered);
        lastRendered = rendered;
      }
    });
    container.scrollTop = container.scrollHeight;
    return lastRendered;
  }

  function appendGeneratedAttachment(payload, panel, prompt) {
    const attachment = payload?.attachment;
    if (!attachment || !safePrivateMediaUrl(attachment.url)) return null;
    return appendMessages([
      {
        id: `image-generation-prompt-${Date.now()}`,
        role: "user",
        content: prompt || "",
        metadata: {},
      },
      {
        id: `image-generation-${Date.now() + 1}`,
        role: "assistant",
        content: String(payload.answer || ""),
        metadata: {
          attachment,
          image_generation: {
            model: payload.model || "",
          },
        },
      },
    ], panel);
  }

  function option(select, value, label) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    select.appendChild(item);
  }

  function init() {
    const form = $("[data-ai-form]");
    const tools = $(".assistant-composer-tools", form || document);
    if (!form || !tools || $("[data-image-generation-toggle]", tools)) return;

    const toggle = createElement("button", "assistant-icon-button assistant-image-generation-toggle", "✦");
    toggle.type = "button";
    toggle.dataset.imageGenerationToggle = "true";
    toggle.title = text("create");
    toggle.setAttribute("aria-label", text("create"));
    toggle.setAttribute("aria-pressed", "false");
    tools.appendChild(toggle);

    const panel = createElement("section", "assistant-image-generation-panel");
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "assistant-image-generation-title");
    const header = createElement("div", "assistant-image-generation-header");
    header.appendChild(createElement("h3", "", text("title"))).id = "assistant-image-generation-title";
    const close = createElement("button", "assistant-image-generation-close", text("cancel"));
    close.type = "button";
    header.appendChild(close);

    const imageForm = createElement("form", "assistant-image-generation-form");
    const promptLabel = createElement("label", "assistant-image-generation-prompt");
    promptLabel.appendChild(createElement("span", "", text("prompt")));
    const prompt = createElement("textarea");
    prompt.name = "prompt";
    prompt.maxLength = 5000;
    prompt.placeholder = text("placeholder");
    prompt.dataset.imageGenerationPrompt = "true";
    promptLabel.appendChild(prompt);
    imageForm.appendChild(promptLabel);

    const options = createElement("div", "assistant-image-generation-options");
    const sizeField = createElement("label", "assistant-image-generation-field");
    sizeField.appendChild(createElement("span", "", text("size")));
    const size = createElement("select");
    size.name = "size";
    option(size, "1024x1024", text("size_square"));
    option(size, "1024x1536", text("size_portrait"));
    option(size, "1536x1024", text("size_landscape"));
    sizeField.appendChild(size);
    options.appendChild(sizeField);

    const qualityField = createElement("label", "assistant-image-generation-field");
    qualityField.appendChild(createElement("span", "", text("quality")));
    const quality = createElement("select");
    quality.name = "quality";
    option(quality, "low", text("quality_low"));
    option(quality, "medium", text("quality_medium"));
    option(quality, "high", text("quality_high"));
    qualityField.appendChild(quality);
    options.appendChild(qualityField);

    const formatField = createElement("label", "assistant-image-generation-field");
    formatField.appendChild(createElement("span", "", text("format")));
    const outputFormat = createElement("select");
    outputFormat.name = "output_format";
    option(outputFormat, "webp", text("format_webp"));
    option(outputFormat, "png", text("format_png"));
    option(outputFormat, "jpeg", text("format_jpeg"));
    formatField.appendChild(outputFormat);
    options.appendChild(formatField);
    imageForm.appendChild(options);

    const submit = createElement("button", "assistant-image-generation-submit", text("generate"));
    submit.type = "submit";
    const status = createElement("p", "assistant-image-generation-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    imageForm.append(submit, status);
    panel.append(header, imageForm);
    form.insertAdjacentElement("afterend", panel);

    const setOpen = (open) => {
      panel.hidden = !open;
      toggle.classList.toggle("is-active", open);
      toggle.setAttribute("aria-pressed", String(open));
      if (open) {
        prompt.focus();
        requestAnimationFrame(() => panel.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
    };
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));

    imageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const cleanPrompt = prompt.value.trim();
      if (!cleanPrompt) {
        setStatus(status, text("prompt_required"), true);
        prompt.focus();
        return;
      }
      submit.disabled = true;
      setStatus(status, text("generating"));
      try {
        const response = await fetch("/api/assistant/images/generate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({
            prompt: cleanPrompt,
            size: size.value,
            quality: quality.value,
            output_format: outputFormat.value,
            lang: root.dataset.locale || "vi",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          const error = new Error(errorText(payload));
          error.payload = payload;
          throw error;
        }
        updateImageQuota(payload.usage);
        const renderedMessages = appendMessages(payload.messages, panel);
        const rendered = renderedMessages?.querySelector(".assistant-message-image img")
          ? renderedMessages
          : appendGeneratedAttachment(payload, panel, cleanPrompt);
        const generatedImage = rendered?.querySelector(".assistant-message-image img");
        if (generatedImage) {
          setOpen(false);
          requestAnimationFrame(() => generatedImage.scrollIntoView({ block: "nearest", inline: "nearest" }));
        }
        setStatus(status, text("completed"));
      } catch (error) {
        setStatus(status, error.message || text("failed"), true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
