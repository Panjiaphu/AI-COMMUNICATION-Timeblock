document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".admin-table-panel table").forEach((table) => {
    table.dataset.ready = "true";
  });

  document.querySelectorAll(".admin-form-grid").forEach((form) => {
    form.addEventListener("submit", () => {
      form.querySelectorAll("button[type='submit']").forEach((button) => {
        button.dataset.originalText = button.textContent;
        button.textContent = "儲存中...";
        button.disabled = true;
      });
    });
  });

  document.querySelectorAll("[data-upload-bucket]").forEach((widget) => {
    const fileInput = widget.querySelector("[data-upload-file]");
    const trigger = widget.querySelector("[data-upload-trigger]");
    const status = widget.querySelector("[data-upload-status]");
    const preview = widget.querySelector("[data-gallery-preview], [data-upload-preview]");
    const form = widget.closest("form");
    const targetInput = form?.querySelector("[data-upload-url-target]");
    const galleryInput = form?.querySelector("[data-gallery-json]");
    const limit = Number(widget.dataset.galleryLimit || 1);
    if (!fileInput || !trigger || !targetInput) {
      return;
    }

    const readGallery = () => {
      if (!galleryInput) {
        return targetInput.value ? [targetInput.value] : [];
      }
      try {
        const parsed = JSON.parse(galleryInput.value || "[]");
        return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, limit) : [];
      } catch (_error) {
        return targetInput.value ? [targetInput.value] : [];
      }
    };

    const writeGallery = (urls) => {
      const cleanUrls = Array.from(new Set(urls.filter(Boolean))).slice(0, limit);
      if (galleryInput) {
        galleryInput.value = JSON.stringify(cleanUrls);
      }
      targetInput.value = cleanUrls[0] || "";
      if (preview) {
        if (!cleanUrls.length) {
          preview.innerHTML = "<span data-gallery-empty>尚未上傳圖片</span>";
        } else {
          preview.innerHTML = cleanUrls.map((url, index) => `
            <figure data-gallery-item>
              <img src="${url}" alt="圖片預覽 ${index + 1}">
              <button type="button" data-gallery-remove data-index="${index}">移除</button>
            </figure>
          `).join("");
        }
      }
    };

    preview?.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-gallery-remove]");
      if (!removeButton) {
        return;
      }
      const item = removeButton.closest("[data-gallery-item]");
      const index = Number(removeButton.dataset.index ?? Array.from(preview.querySelectorAll("[data-gallery-item]")).indexOf(item));
      const urls = readGallery();
      urls.splice(index, 1);
      writeGallery(urls);
      if (status) {
        status.textContent = `已移除圖片，剩餘 ${urls.length} / ${limit} 張。`;
      }
    });

    if (galleryInput) {
      writeGallery(readGallery());
    }

    trigger.addEventListener("click", async () => {
      const currentUrls = readGallery();
      if (currentUrls.length >= limit) {
        status.textContent = `最多只能上傳 ${limit} 張圖片。`;
        return;
      }
      const file = fileInput.files[0];
      if (!file) {
        status.textContent = "請先選擇圖片。";
        return;
      }

      const formData = new FormData();
      formData.append("image", file);
      formData.append("bucket", widget.dataset.uploadBucket || "events");
      trigger.disabled = true;
      status.textContent = "圖片上傳與壓縮中...";

      try {
        const response = await fetch("/uploads/admin-image", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (!response.ok || result.status !== "success") {
          throw new Error(result.error || "圖片上傳失敗。");
        }
        currentUrls.push(result.image_url);
        writeGallery(currentUrls);
        fileInput.value = "";
        status.textContent = `已壓縮完成：${result.width}x${result.height}，${result.size} bytes，${currentUrls.length} / ${limit} 張。`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        trigger.disabled = false;
      }
    });
  });
});
