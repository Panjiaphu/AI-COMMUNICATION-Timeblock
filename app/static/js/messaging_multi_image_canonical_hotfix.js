(function messagingMultiImageCanonicalHotfix(global) {
  "use strict";

  const app = document.getElementById("assistant-app");
  if (!app) return;

  const MAX_IMAGES = 10;
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const states = new WeakMap();
  let copy = {
    invalidImage: "Only JPEG, PNG, and WebP images are supported.",
    tooManyImages: "You can attach up to 10 images.",
    imagesSelected: "{count} images selected",
    maxImages: "Maximum 10 images",
    removeImage: "Remove image {index}",
  };
  let patchedApi = null;

  function format(template, values = {}) {
    return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ""));
  }

  async function loadCopy() {
    try {
      const response = await fetch("/static/i18n/messaging_ux_v1.json?v=20260823a", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const catalogue = await response.json();
      const locale = String(app.dataset.locale || "vi");
      copy = { ...copy, ...(catalogue[locale] || catalogue.en || {}) };
    } catch (_error) {
      // Fallback copy above keeps the composer usable if i18n cannot load.
    }
  }

  function canonicalInput(form) {
    return form?.querySelector("[data-message-file]") || null;
  }

  function stateFor(form) {
    let state = states.get(form);
    if (!state) {
      state = { files: [], preview: null, status: null, urls: [] };
      states.set(form, state);
    }
    return state;
  }

  function syncNativeFiles(form, files) {
    const input = canonicalInput(form);
    if (!input) return false;
    if (!files.length) {
      input.value = "";
      return true;
    }
    if (typeof DataTransfer !== "function") return true;
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      return input.files?.length === files.length;
    } catch (_error) {
      return true;
    }
  }

  function revokeUrls(state) {
    state.urls.forEach((url) => URL.revokeObjectURL(url));
    state.urls = [];
  }

  function ensurePreview(form, state) {
    if (state.preview?.isConnected) return state.preview;
    const box = form.querySelector(".assistant-composer-box");
    if (!box) return null;
    const section = document.createElement("section");
    section.className = "messaging-ux-multi-preview";
    section.dataset.messagingMultiImagePreview = "true";
    section.hidden = true;
    const grid = document.createElement("div");
    grid.className = "messaging-ux-preview-grid";
    const status = document.createElement("p");
    status.className = "messaging-ux-preview-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.append(grid, status);
    form.insertBefore(section, box);
    state.preview = section;
    state.status = status;
    return section;
  }

  function selectionError(form, message) {
    const state = stateFor(form);
    ensurePreview(form, state);
    if (!state.status) return;
    state.status.textContent = String(message || "");
    state.status.classList.add("is-error");
    global.setTimeout(() => state.status?.classList.remove("is-error"), 2200);
  }

  function renderSelection(form) {
    const state = stateFor(form);
    const section = ensurePreview(form, state);
    if (!section) return;
    const grid = section.querySelector(".messaging-ux-preview-grid");
    revokeUrls(state);
    grid.replaceChildren();
    state.files.forEach((file, index) => {
      const item = document.createElement("figure");
      item.className = "messaging-ux-preview-item";
      const image = document.createElement("img");
      const url = URL.createObjectURL(file);
      state.urls.push(url);
      image.src = url;
      image.alt = file.name || `${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "messaging-ux-preview-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", format(copy.removeImage, { index: index + 1 }));
      remove.setAttribute("title", format(copy.removeImage, { index: index + 1 }));
      remove.addEventListener("click", () => {
        state.files = state.files.filter((_file, fileIndex) => fileIndex !== index);
        syncNativeFiles(form, state.files);
        renderSelection(form);
      });
      item.append(image, remove);
      grid.appendChild(item);
    });
    section.hidden = state.files.length === 0;
    state.status.textContent = state.files.length
      ? `${format(copy.imagesSelected, { count: state.files.length })} · ${copy.maxImages}`
      : "";
  }

  function clearAdvancedPending(form) {
    const api = global.TimeblockMessagingComposerAttachmentsV2;
    if (!api?.getPending || !api?.clear) return;
    if (api.getPending(form)) api.clear(form);
  }

  function addFiles(form, incomingFiles) {
    const incoming = Array.from(incomingFiles || []);
    if (!incoming.length) return true;
    const state = stateFor(form);
    if (incoming.some((file) => !IMAGE_TYPES.has(String(file.type || "").toLowerCase()))) {
      syncNativeFiles(form, state.files);
      selectionError(form, copy.invalidImage);
      return false;
    }
    if (state.files.length + incoming.length > MAX_IMAGES) {
      syncNativeFiles(form, state.files);
      selectionError(form, copy.tooManyImages);
      return false;
    }
    clearAdvancedPending(form);
    state.files = state.files.concat(incoming);
    syncNativeFiles(form, state.files);
    renderSelection(form);
    patchComposerApi();
    return true;
  }

  function clear(form) {
    const state = states.get(form);
    if (state) {
      revokeUrls(state);
      state.files = [];
      if (state.preview) {
        state.preview.hidden = true;
        state.preview.querySelector(".messaging-ux-preview-grid")?.replaceChildren();
      }
      if (state.status) state.status.textContent = "";
    }
    const input = canonicalInput(form);
    if (input) input.value = "";
  }

  function decorate(form, formData, originalDecorate = null) {
    if (originalDecorate) originalDecorate(form, formData);
    const state = states.get(form);
    if (!state?.files?.length) return formData;
    formData.delete("image");
    state.files.forEach((file) => formData.append("image", file, file.name));
    return formData;
  }

  function patchComposerApi() {
    const current = global.TimeblockMessagingComposerAttachmentsV2;
    if (!current?.decorateFormData) {
      const shim = {
        decorateFormData(form, formData) {
          return decorate(form, formData);
        },
      };
      global.TimeblockMessagingComposerAttachmentsV2 = shim;
      patchedApi = shim;
      return;
    }
    if (current === patchedApi || current.__timeblockCanonicalMultiImage === true) {
      patchedApi = current;
      return;
    }
    const originalDecorate = current.decorateFormData.bind(current);
    current.decorateFormData = function canonicalMultiImageDecorator(form, formData) {
      return decorate(form, formData, originalDecorate);
    };
    try {
      Object.defineProperty(current, "__timeblockCanonicalMultiImage", {
        configurable: false,
        enumerable: false,
        value: true,
      });
    } catch (_error) {
      current.__timeblockCanonicalMultiImage = true;
    }
    patchedApi = current;
  }

  function sync() {
    app.querySelectorAll("[data-message-form]").forEach((form) => {
      const input = canonicalInput(form);
      if (input) {
        input.multiple = true;
        input.setAttribute("multiple", "");
      }
      const gallery = form.querySelector("[data-messaging-composer-gallery]");
      if (gallery) {
        gallery.multiple = true;
        gallery.setAttribute("multiple", "");
      }
    });
    patchComposerApi();
  }

  function handleImageChange(event) {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.matches("[data-message-file], [data-messaging-composer-gallery]")) return;
    const form = input.closest("[data-message-form]");
    if (!form) return;
    event.stopImmediatePropagation();
    const incoming = Array.from(input.files || []);
    if (!input.matches("[data-message-file]")) input.value = "";
    addFiles(form, incoming);
  }

  document.addEventListener("change", handleImageChange, true);
  app.addEventListener("timeblock:messaging:message-sent", () => {
    app.querySelectorAll("[data-message-form]").forEach(clear);
  });
  app.addEventListener("timeblock:messaging:attachment-change", (event) => {
    if (!event.detail?.attachment) return;
    app.querySelectorAll("[data-message-form]").forEach(clear);
  });
  app.addEventListener("timeblock:messaging:conversation", sync);
  app.addEventListener("timeblock:messaging:messages", sync);

  global.TimeblockMessagingMultiImageCanonical = {
    maxImages: MAX_IMAGES,
    addFiles,
    clear,
    sync,
    getSelectedImages(form) {
      return Array.from(states.get(form)?.files || []);
    },
  };

  const observer = new MutationObserver(sync);
  observer.observe(app, { childList: true, subtree: true });
  loadCopy().finally(sync);
})(typeof window !== "undefined" ? window : globalThis);
