(function () {
  const root = document.getElementById("app-settings");
  if (!root) return;

  const form = root.querySelector("[data-notification-form]");
  const statusNode = root.querySelector("[data-settings-status]");
  const deviceList = root.querySelector("[data-device-list]");
  const pushToggle = root.querySelector("[data-push-toggle]");
  const photoPicker = root.querySelector("[data-photo-picker]");
  const booleanFields = [
    "in_app_enabled",
    "email_enabled",
    "push_enabled",
    "message_preview_enabled",
    "member_messages_enabled",
    "business_messages_enabled",
    "system_notifications_enabled",
    "in_app_sound_enabled",
    "vibration_enabled",
    "incoming_call_notification_enabled",
    "incoming_call_sound_enabled",
    "incoming_video_call_sound_enabled",
    "incoming_call_vibration_enabled",
    "incoming_call_vibration_sync_enabled",
    "offline_call_email_enabled",
    "missed_call_email_enabled",
    "missed_video_call_email_enabled",
    "outgoing_ringback_enabled",
    "missed_call_chime_enabled",
  ];
  const integerFields = [
    "incoming_call_volume_percent",
    "incoming_call_ring_duration_seconds",
    "outgoing_ringback_volume_percent",
    "missed_call_chime_volume_percent",
  ];
  let pushConfiguration = { configured: false, public_key: "" };
  let activeDeviceCount = 0;

  const copy = (name) => root.dataset[name] || "";
  const isStandalone = () => (
    window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true
  );
  const isIOS = () => (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );

  function setStatus(message, isError = false) {
    statusNode.textContent = message || "";
    statusNode.classList.toggle("is-error", isError);
  }

  function stateCopy(enabled, blocked = false) {
    if (blocked) return copy("copyEffectiveBlocked");
    return enabled ? copy("copyEffectiveOn") : copy("copyEffectiveOff");
  }

  function renderEffectiveState() {
    const desired = Boolean(pushToggle.checked);
    const permission = "Notification" in window ? Notification.permission : "unavailable";
    const effective = (
      desired
      && pushConfiguration.configured
      && permission === "granted"
      && activeDeviceCount > 0
    );
    root.querySelector("[data-desired-state]").textContent = stateCopy(desired);
    root.querySelector("[data-server-push-state]").textContent = stateCopy(
      pushConfiguration.configured,
      !pushConfiguration.configured,
    );
    const effectiveNode = root.querySelector("[data-effective-state]");
    effectiveNode.textContent = stateCopy(
      effective,
      desired && !effective,
    );
    effectiveNode.dataset.state = effective ? "on" : (desired ? "blocked" : "off");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || copy("copyFailed"));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setPermissionState(name, value) {
    const node = root.querySelector(`[data-permission-state="${name}"]`);
    if (!node) return;
    const normalized = ["granted", "denied", "prompt"].includes(value) ? value : "unavailable";
    node.textContent = normalized === "granted"
      ? copy("copyAllowed")
      : normalized === "denied"
        ? copy("copyDenied")
        : normalized === "prompt"
          ? copy("copyPrompt")
          : copy("copyUnavailable");
    node.classList.toggle("is-allowed", normalized === "granted");
    node.classList.toggle("is-denied", normalized === "denied");
  }

  function showPermissionButton(name, available) {
    const button = root.querySelector(`[data-request-permission="${name}"]`);
    if (button) button.hidden = !available;
  }

  async function queryPermission(name) {
    if (!navigator.permissions?.query) return "prompt";
    try {
      const permission = await navigator.permissions.query({ name });
      permission.addEventListener?.("change", () => setPermissionState(name, permission.state));
      return permission.state;
    } catch (_error) {
      return "prompt";
    }
  }

  async function refreshPermissionStates() {
    setPermissionState(
      "notifications",
      "Notification" in window ? Notification.permission : "unavailable",
    );
    showPermissionButton("notifications", "Notification" in window);

    for (const name of ["camera", "microphone"]) {
      const available = Boolean(navigator.mediaDevices?.getUserMedia);
      showPermissionButton(name, available);
      setPermissionState(name, available ? await queryPermission(name) : "unavailable");
    }

    const contactsAvailable = Boolean(navigator.contacts?.select);
    showPermissionButton("contacts", contactsAvailable);
    setPermissionState("contacts", contactsAvailable ? "prompt" : "unavailable");

    const bluetoothAvailable = Boolean(navigator.bluetooth?.requestDevice);
    showPermissionButton("bluetooth", bluetoothAvailable);
    setPermissionState("bluetooth", bluetoothAvailable ? "prompt" : "unavailable");

    showPermissionButton("photos", true);
    setPermissionState("photos", "prompt");
  }

  async function requestPermission(name) {
    if (name === "notifications" && "Notification" in window) {
      setPermissionState(name, await Notification.requestPermission());
      return;
    }
    if (name === "camera" || name === "microphone") {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: name === "camera",
        audio: name === "microphone",
      });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState(name, "granted");
      return;
    }
    if (name === "contacts" && navigator.contacts?.select) {
      await navigator.contacts.select(["name"], { multiple: false });
      setPermissionState(name, "granted");
      return;
    }
    if (name === "bluetooth" && navigator.bluetooth?.requestDevice) {
      await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      setPermissionState(name, "granted");
      return;
    }
    if (name === "photos") {
      photoPicker.click();
    }
  }

  function updateInstallStatus() {
    const installMode = root.querySelector("[data-install-mode]");
    const secureStatus = root.querySelector("[data-secure-status]");
    const workerStatus = root.querySelector("[data-worker-status]");
    const iosGuide = root.querySelector("[data-ios-install-guide]");
    if (isStandalone()) {
      installMode.textContent = root.querySelector("[data-pwa-install]")?.dataset.doneText || "";
    }
    secureStatus.classList.toggle("is-unavailable", !window.isSecureContext);
    workerStatus.classList.toggle("is-unavailable", !("serviceWorker" in navigator));
    if (iosGuide) iosGuide.hidden = !(isIOS() && !isStandalone());
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
  }

  function deviceName() {
    const platform = navigator.userAgentData?.platform || navigator.platform || "Web";
    const mode = isStandalone() ? "PWA" : "Browser";
    return `${platform} · ${mode}`.slice(0, 80);
  }

  async function registerPushSubscription() {
    if (!pushConfiguration.configured || !pushConfiguration.public_key) {
      throw new Error(copy("copyPushUnavailable"));
    }
    if (isIOS() && !isStandalone()) {
      throw new Error(copy("copyPushRequiresInstall"));
    }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error(copy("copyPushUnavailable"));
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    setPermissionState("notifications", permission);
    if (permission !== "granted") throw new Error(copy("copyDenied"));

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfiguration.public_key),
      });
    }
    const serialized = subscription.toJSON();
    await api("/api/assistant/notifications/push/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        subscription: serialized,
        platform: isIOS() ? "ios" : (navigator.userAgentData?.platform || navigator.platform || "web"),
        device_name: deviceName(),
        content_encoding: PushManager.supportedContentEncodings?.[0] || "aes128gcm",
      }),
    });
    await loadDevices();
  }

  async function revokeCurrentPushSubscription() {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (!subscription) return;
    await api("/api/assistant/notifications/push/subscriptions/revoke-current", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch((error) => {
      if (error.status !== 404) throw error;
    });
    await subscription.unsubscribe();
  }

  function renderDevices(items) {
    deviceList.replaceChildren();
    const active = (Array.isArray(items) ? items : []).filter((item) => item.status === "active");
    activeDeviceCount = active.length;
    renderEffectiveState();
    if (!active.length) {
      const empty = document.createElement("p");
      empty.textContent = copy("copyNoDevices");
      deviceList.append(empty);
      return;
    }
    for (const device of active) {
      const row = document.createElement("div");
      row.className = "registered-device";
      const copyNode = document.createElement("span");
      copyNode.className = "registered-device-copy";
      const name = document.createElement("strong");
      name.textContent = device.device_name || device.platform || "Timeblock";
      const detail = document.createElement("small");
      detail.textContent = `${device.endpoint_origin} · ${device.updated_at || ""}`;
      copyNode.append(name, detail);
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "settings-text-button";
      revoke.textContent = copy("copyRevoke");
      revoke.addEventListener("click", async () => {
        revoke.disabled = true;
        try {
          await api(`/api/assistant/notifications/push/subscriptions/${device.id}`, { method: "DELETE" });
          await loadDevices();
        } catch (error) {
          setStatus(error.message || copy("copyFailed"), true);
        }
      });
      row.append(copyNode, revoke);
      deviceList.append(row);
    }
  }

  async function loadDevices() {
    const payload = await api("/api/assistant/notifications/push/subscriptions");
    renderDevices(payload.subscriptions);
  }

  async function loadPreferences() {
    const [preferencePayload, keyPayload] = await Promise.all([
      api("/api/assistant/notifications/preferences"),
      api("/api/assistant/notifications/push/public-key"),
    ]);
    pushConfiguration = keyPayload;
    for (const field of booleanFields) {
      const input = form.elements[field];
      if (input) input.checked = Boolean(preferencePayload.preferences[field]);
    }
    for (const field of integerFields) {
      const input = form.elements[field];
      if (input) input.value = String(preferencePayload.preferences[field] ?? input.value);
    }
    root.querySelector("[data-call-volume-output]").textContent = `${form.elements.incoming_call_volume_percent.value}%`;
    root.querySelector("[data-ringback-volume-output]").textContent = `${form.elements.outgoing_ringback_volume_percent.value}%`;
    root.querySelector("[data-chime-volume-output]").textContent = `${form.elements.missed_call_chime_volume_percent.value}%`;
    root.querySelector("[data-account-email]").value = preferencePayload.account_email || "";
    for (const field of ["quiet_hours_start", "quiet_hours_end", "timezone"]) {
      const input = form.elements[field];
      if (input) input.value = preferencePayload.preferences[field] || (field === "timezone" ? "Asia/Taipei" : "");
    }
    if (!pushConfiguration.configured) {
      root.querySelector("[data-test-push]").disabled = true;
      setStatus(copy("copyPushUnavailable"), true);
    }
    localStorage.setItem(
      "timeblockNotificationPreferences",
      JSON.stringify(preferencePayload.preferences),
    );
    renderEffectiveState();
    if (
      pushToggle.checked
      && pushConfiguration.configured
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      registerPushSubscription().catch(() => undefined);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus("");
    try {
      let pushSetupError = null;
      if (pushToggle.checked && pushConfiguration.configured) {
        try {
          await registerPushSubscription();
        } catch (error) {
          pushSetupError = error;
        }
      } else {
        await revokeCurrentPushSubscription().catch((error) => {
          pushSetupError = error;
        });
      }
      const body = Object.fromEntries(
        booleanFields.map((field) => [field, Boolean(form.elements[field]?.checked)]),
      );
      body.quiet_hours_start = form.elements.quiet_hours_start.value;
      body.quiet_hours_end = form.elements.quiet_hours_end.value;
      body.timezone = form.elements.timezone.value || "Asia/Taipei";
      for (const field of integerFields) {
        body[field] = Number(form.elements[field].value);
      }
      const payload = await api("/api/assistant/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      localStorage.setItem("timeblockNotificationPreferences", JSON.stringify(payload.preferences));
      pushToggle.checked = Boolean(payload.preferences.push_enabled);
      renderEffectiveState();
      await loadDevices();
      setStatus(
        pushSetupError
          ? `${copy("copySaved")} ${pushSetupError.message || copy("copyFailed")}`
          : copy("copySaved"),
        Boolean(pushSetupError),
      );
    } catch (error) {
      renderEffectiveState();
      setStatus(error.message || copy("copyFailed"), true);
    } finally {
      submit.disabled = false;
    }
  });

  root.querySelector("[data-test-push]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    setStatus("");
    try {
      await api("/api/assistant/notifications/push/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus(copy("copyTestSent"));
    } catch (error) {
      setStatus(error.message || copy("copyFailed"), true);
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  function playTone(frequencies, volume) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    const context = new Context();
    context.resume().then(() => {
      const startAt = context.currentTime + 0.02;
      frequencies.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const offset = index * 0.18;
        oscillator.frequency.setValueAtTime(frequency, startAt + offset);
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(
          Math.max(0.01, Math.min(volume, 1)) * 0.12,
          startAt + offset + 0.03,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.18);
      });
      window.setTimeout(() => context.close().catch(() => undefined), 1200);
    }).catch(() => undefined);
    return true;
  }

  async function testRingtone() {
    if (!window.IncomingCallRingtoneController) {
      await new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "/static/js/incoming_call_ringtone.js";
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
      });
    }
    if (!window.IncomingCallRingtoneController) return false;
    const controller = new window.IncomingCallRingtoneController();
    await controller.syncPromise?.catch(() => false);
    controller.setPreferences({
      enabled: true,
      volume: Number(form.elements.incoming_call_volume_percent.value) / 100,
      maxDurationMs: 20000,
      vibrationEnabled: false,
    });
    const started = await controller.preview();
    window.setTimeout(() => controller.destroy(), 10500);
    return started;
  }

  root.querySelector("[data-test-ringtone]").addEventListener("click", async () => {
    const started = await testRingtone();
    setStatus(started ? copy("copyAudioTest") : copy("copyFailed"), !started);
  });
  root.querySelector("[data-test-ringback]").addEventListener("click", () => {
    const started = playTone(
      [440, 440],
      Number(form.elements.outgoing_ringback_volume_percent.value) / 100,
    );
    setStatus(started ? copy("copyAudioTest") : copy("copyFailed"), !started);
  });
  root.querySelector("[data-test-chime]").addEventListener("click", () => {
    const started = playTone(
      [659.25, 523.25],
      Number(form.elements.missed_call_chime_volume_percent.value) / 100,
    );
    setStatus(started ? copy("copyAudioTest") : copy("copyFailed"), !started);
  });

  [
    ["incoming_call_volume_percent", "[data-call-volume-output]"],
    ["outgoing_ringback_volume_percent", "[data-ringback-volume-output]"],
    ["missed_call_chime_volume_percent", "[data-chime-volume-output]"],
  ].forEach(([field, selector]) => {
    form.elements[field].addEventListener("input", () => {
      root.querySelector(selector).textContent = `${form.elements[field].value}%`;
    });
  });
  pushToggle.addEventListener("change", renderEffectiveState);

  root.querySelectorAll("[data-request-permission]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await requestPermission(button.dataset.requestPermission);
      } catch (_error) {
        setPermissionState(button.dataset.requestPermission, "denied");
      } finally {
        button.disabled = false;
      }
    });
  });

  photoPicker.addEventListener("change", () => {
    if (photoPicker.files?.length) setPermissionState("photos", "granted");
    photoPicker.value = "";
  });

  updateInstallStatus();
  refreshPermissionStates();
  Promise.all([loadPreferences(), loadDevices()]).catch((error) => {
    setStatus(error.message || copy("copyFailed"), true);
  });
})();
