(function () {
  const installButton = document.querySelector("[data-pwa-install]");
  const installStatus = document.querySelector("[data-pwa-install-status]");
  let installPrompt = null;

  const updateStatus = (message) => {
    if (installStatus && message) {
      installStatus.textContent = message;
    }
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {
        updateStatus(installButton?.dataset.errorText);
      });
    });
  }

  document.addEventListener("click", async (event) => {
    const link = event.target.closest?.('a[href]');
    if (
      !link
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || link.target
    ) return;
    const target = new URL(link.href, window.location.href);
    if (
      target.origin !== window.location.origin
      || !target.pathname.endsWith("/logout")
      || link.dataset.pushLogoutPending === "true"
    ) return;
    event.preventDefault();
    link.dataset.pushLogoutPending = "true";
    try {
      const registration = await navigator.serviceWorker?.ready;
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await fetch("/api/assistant/notifications/push/subscriptions/revoke-current", {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe().catch(() => undefined);
      }
    } finally {
      window.location.assign(target.href);
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) {
      installButton.disabled = false;
      installButton.classList.add("is-ready");
      updateStatus(installButton.dataset.readyText);
    }
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!installPrompt) {
        updateStatus(installButton.dataset.manualText);
        return;
      }

      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        installButton.disabled = true;
        updateStatus(installButton.dataset.doneText);
      } else {
        updateStatus(installButton.dataset.manualText);
      }
      installPrompt = null;
    });
  }

  window.addEventListener("appinstalled", () => {
    if (installButton) {
      installButton.disabled = true;
    }
    updateStatus(installButton?.dataset.doneText);
  });
})();
