document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".event-share-panel").forEach((panel) => {
    const shareUrl = panel.dataset.shareUrl || window.location.href;
    const shareTitle = panel.dataset.shareTitle || document.title;
    const form = panel.closest("form");
    const platformInput = form?.querySelector("input[name='social_platform']");
    const targetInput = form?.querySelector("input[name='share_target_url']");
    const submitButton = form?.querySelector(".event-share-submit");
    const status = panel.querySelector("[data-share-status]");

    const markShared = (platform, message) => {
      if (platformInput) platformInput.value = platform;
      if (targetInput) targetInput.value = shareUrl;
      if (submitButton) submitButton.disabled = false;
      if (status) status.textContent = message;
    };

    const openShareWindow = (url) => {
      window.open(url, "_blank", "noopener,noreferrer,width=760,height=680");
    };

    panel.querySelectorAll(".event-share-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const platform = button.dataset.platform;
        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedTitle = encodeURIComponent(shareTitle);

        if (platform === "facebook") {
          openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`);
          markShared("facebook", "已開啟 Facebook 分享視窗，可送出自由參加。");
          return;
        }

        if (platform === "x") {
          openShareWindow(`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`);
          markShared("x", "已開啟 X 分享視窗，可送出自由參加。");
          return;
        }

        if (platform === "line") {
          openShareWindow(`https://social-plugins.line.me/lineit/share?url=${encodedUrl}`);
          markShared("line", "已開啟 LINE 分享視窗，可送出自由參加。");
          return;
        }

        try {
          await navigator.clipboard.writeText(shareUrl);
        } catch (_error) {
          const helper = document.createElement("textarea");
          helper.value = shareUrl;
          document.body.appendChild(helper);
          helper.select();
          document.execCommand("copy");
          helper.remove();
        }

        if (platform === "tiktok") {
          markShared("tiktok", "活動連結已複製，請貼到 TikTok 影片或個人動態後送出。");
          return;
        }

        if (platform === "instagram") {
          markShared("instagram", "活動連結已複製，請貼到 Instagram Story 或貼文後送出。");
          return;
        }

        markShared("copy_link", "活動連結已複製，可送出自由參加。");
      });
    });
  });

  document.querySelectorAll(".event-actions-panel form").forEach((form) => {
    form.addEventListener("submit", () => {
      const button = form.querySelector("button[type='submit']");
      if (button) {
        button.dataset.originalText = button.textContent;
        button.textContent = "處理中";
      }
    });
  });
});
