(function nativeGroupV3(window, document) {
  "use strict";

  var root = document.getElementById("group-native-app");
  var toast = document.querySelector("[data-toast]");
  if (!root || !window.GroupV3I18n) return;

  var runtimeConfig = {};
  try {
    runtimeConfig = JSON.parse(document.getElementById("guilua-runtime-config").textContent || "{}");
  } catch (_error) {
    runtimeConfig = {};
  }

  var SURFACES = ["chat", "call", "video", "radio", "chat-translation", "radio-translation", "plugin"];
  var LANGUAGES = ["vi", "en", "zh-TW"];
  var POLICY_VERSION = runtimeConfig.group_translation_policy_version || "";
  function normalizeSurface(value) {
    if (value === "plugin") return "chat-translation";
    return SURFACES.indexOf(value) >= 0 ? value : "";
  }
  var ICONS = {
    "message-circle": '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    "phone-call": '<path d="M13 2a9 9 0 0 1 9 9"/><path d="M13 6a5 5 0 0 1 5 5"/><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    "radio-tower": '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>',
    mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    paperclip: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    "log-out": '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'
    ,search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
  };

  var state = {
    status: "WAITING",
    locale: LANGUAGES.indexOf(runtimeConfig.locale) >= 0 ? runtimeConfig.locale : "vi",
    surface: normalizeSurface(runtimeConfig.initial_surface) || "chat",
    previousSurface: "chat",
    mobile: window.matchMedia("(max-width: 640px)").matches,
    context: null,
    directAvailable: Boolean(runtimeConfig.direct_available),
    groupAuthorized: Boolean(runtimeConfig.group_authorized),
    spaces: [],
    space: null,
    members: [],
    directoryCandidates: [],
    spaceInvitations: [],
    incomingInvitations: [],
    memberManagerOpen: false,
    messages: [],
    chatTranslations: {},
    pins: [],
    profile: null,
    consent: null,
    translations: [],
    mediaSession: null,
    radioSession: null,
    radioFloor: null,
    burst: null,
    floorToken: "",
    radioStopping: false,
    pendingAttachment: null,
    creatingSpace: false,
    busy: false,
    error: "",
    mediaConnected: false,
    micEnabled: true,
    videoEnabled: true,
    deviceLost: false,
    prejoinOpen: false,
    prejoinMediaKind: "video",
    prejoinBusy: false,
    prejoinError: "",
    prejoinDevices: { audioInputs: [], videoInputs: [], audioOutputs: [] },
    prejoinAudioEnabled: true,
    prejoinVideoEnabled: true,
    prejoinAudioDeviceId: "",
    prejoinVideoDeviceId: "",
    prejoinOutputDeviceId: "",
    prejoinConfirmed: false
  };

  var mediaRoom = null;
  var localStream = null;
  var heartbeatTimer = 0;
  var toastTimer = 0;
  var refreshQueued = false;
  var groupEventSource = null;
  var groupEventRefreshTimer = 0;
  var mediaGeneration = 0;
  var mediaActionInFlight = false;
  var chatTranslationSweep = false;
  var chatTranslationInflight = new Set();
  var chatTranslationFailures = new Map();
  var prejoinMeterStop = null;

  function t(key) {
    return window.GroupV3I18n.translator(state.locale)(key);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function resizeTextEntry(control) {
    if (!control || control.tagName !== "TEXTAREA") return;
    control.style.height = "auto";
    var maxHeight = Math.max(44, Math.min(132, Math.round((window.innerHeight || 640) * 0.28)));
    control.style.height = Math.min(Math.max(control.scrollHeight, 44), maxHeight) + "px";
  }

  function isTextEntry(control) {
    if (!control || !control.matches) return false;
    return control.matches("textarea[data-group-text-entry], input[data-group-text-entry]");
  }

  function icon(name, size) {
    if (!ICONS[name]) return "";
    size = size || 20;
    return '<svg class="ui-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[name] + "</svg>";
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(-2).map(function (part) {
      return part[0] || "";
    }).join("").toUpperCase().slice(0, 2);
  }

  function avatar(name, tone, size, online) {
    return '<span class="avatar avatar-' + (size || "md") + " avatar-" + (tone || "teal") + '">' + esc(initials(name)) + (online ? '<i class="presence-dot"></i>' : "") + "</span>";
  }

  function badge(label, tone) {
    return '<span class="badge badge-' + (tone || "success") + '">' + esc(label) + "</span>";
  }

  function action(name, label, iconName, tone, attributes) {
    var extraClass = "";
    var normalized = String(attributes || "");
    var classMatch = normalized.match(/class="([^"]*)"/);
    if (classMatch) {
      extraClass = " " + classMatch[1];
      normalized = normalized.replace(classMatch[0], "");
    }
    return '<button type="button" class="action-button action-' + (tone || "secondary") + extraClass + '" data-action="' + name + '" ' + normalized + ">" + icon(iconName, 17) + "<span>" + esc(label) + "</span></button>";
  }

  function iconButton(name, label, iconName) {
    return '<button type="button" class="icon-button" data-action="' + name + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon(iconName, 19) + "</button>";
  }

  function wave(compact) {
    return '<span class="waveform is-active ' + (compact ? "is-compact" : "") + '" aria-hidden="true">' +
      [8, 16, 24, 12, 20, 10, 18].map(function (height) {
        return '<i style="--wave-height:' + height + 'px"></i>';
      }).join("") + "</span>";
  }

  function languageOptions(selected) {
    return [["vi", t("vietnamese")], ["en", t("english")], ["zh-TW", t("traditionalChinese")]].map(function (item) {
      return '<option value="' + item[0] + '" ' + (item[0] === selected ? "selected" : "") + ">" + esc(item[1]) + "</option>";
    }).join("");
  }

  function toggle(name, label, detail, checked) {
    return '<button type="button" class="toggle-row" data-action="' + name + '" aria-pressed="' + Boolean(checked) + '"><span><strong>' + esc(label) + "</strong>" + (detail ? "<small>" + esc(detail) + "</small>" : "") + '</span><span class="switch ' + (checked ? "is-on" : "") + '"><b></b></span></button>';
  }

  function notify(message) {
    if (!toast || !message) return;
    toast.textContent = String(message);
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  function idempotencyKey() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : "gv3-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  async function api(path, options) {
    options = options || {};
    var response = await window.fetch(path, Object.assign({
      credentials: "same-origin",
      cache: "no-store"
    }, options, {
      headers: Object.assign({ Accept: "application/json" }, options.headers || {})
    }));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(String(payload.detail || payload.error || "http_" + response.status));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function json(method, body, headers) {
    return {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    };
  }

  async function optional(path, fallback) {
    try {
      return await api(path);
    } catch (error) {
      if ([403, 404, 409, 503].indexOf(error.status) >= 0) return fallback;
      throw error;
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    root.toggleAttribute("aria-busy", busy);
  }

  function publicError(error) {
    var code = String(error && error.message || "");
    if (code.indexOf("disabled") >= 0 || code.indexOf("credentials") >= 0 || code.indexOf("provider") >= 0) return t("mediaUnavailable");
    if (code.indexOf("group_session_required") >= 0 || error && error.status === 401) return t("waitingHandoff");
    return t("statusError");
  }

  function myMembership() {
    return state.members.find(function (item) {
      return item.principal_type === (state.context && state.context.principal.type)
        && item.principal_id === state.context.principal.id
        && item.principal_user_id === state.context.principal.user_id;
    });
  }

  function selfParticipant(session, radio) {
    var membership = myMembership();
    if (!membership || !session) return null;
    return (session.participants || []).find(function (item) {
      return item.membership_id === membership.id;
    });
  }

  function memberName(id) {
    var member = state.members.find(function (item) { return item.id === id; });
    return member ? member.display_name : t("member");
  }

  function activeMemberCount() {
    return state.members.filter(function (item) { return item.status === "active"; }).length;
  }

  function formatTime(value) {
    if (!value) return "";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" });
  }

  async function loadSessionContext() {
    var payload = await api("/api/group/session");
    state.context = payload;
    state.directAvailable = Boolean(payload.direct_available);
    state.groupAuthorized = Boolean(payload.group_authorized);
    if (!normalizeSurface(runtimeConfig.initial_surface) && normalizeSurface(payload.surface)) {
      state.surface = normalizeSurface(payload.surface);
    }
    if (LANGUAGES.indexOf(payload.principal && payload.principal.locale) >= 0) state.locale = payload.principal.locale;
    document.documentElement.lang = state.locale;
    state.status = state.groupAuthorized ? "READY" : "HANDOFF_REQUIRED";
  }

  async function loadSpaces(preferredId) {
    var payload = await api("/api/group/spaces");
    state.spaces = Array.isArray(payload.spaces) ? payload.spaces : [];
    state.space = state.spaces.find(function (item) { return item.id === preferredId; })
      || state.spaces.find(function (item) { return item.id === (state.space && state.space.id); })
      || state.spaces[0]
      || null;
    if (state.space) {
      await loadSpace();
      connectGroupEvents();
    } else {
      closeGroupEvents();
      state.members = [];
      state.messages = [];
      state.chatTranslations = {};
      state.pins = [];
      state.mediaSession = null;
      state.radioSession = null;
      await loadMembershipManagement();
    }
  }

  async function loadMembershipManagement() {
    var incoming = await optional("/api/group/invitations", { invitations: [] });
    state.incomingInvitations = incoming.invitations || [];
    state.directoryCandidates = [];
    state.spaceInvitations = [];
    if (!state.space) return;
    var membership = myMembership();
    if (!membership || ["owner", "admin"].indexOf(membership.role) < 0) return;
    var id = encodeURIComponent(state.space.id);
    var invitations = await optional(
      "/api/group/spaces/" + id + "/invitations",
      { invitations: [] }
    );
    state.spaceInvitations = invitations.invitations || [];
    if (state.directAvailable) {
      var directory = await optional(
        "/api/group/spaces/" + id + "/directory/connections",
        { candidates: [] }
      );
      state.directoryCandidates = directory.candidates || [];
    }
  }

  async function loadSpace() {
    if (!state.space) return;
    var id = encodeURIComponent(state.space.id);
    var results = await Promise.all([
      api("/api/group/spaces/" + id + "/memberships"),
      api("/api/group/spaces/" + id + "/messages?limit=100"),
      api("/api/group/spaces/" + id + "/pins"),
      optional("/api/group/spaces/" + id + "/translation/profile", { profile: null }),
      optional("/api/group/spaces/" + id + "/translation/consent", { consent: null }),
      optional("/api/group/spaces/" + id + "/translation/history?limit=50", { events: [] }),
      optional("/api/group/spaces/" + id + "/translation/chat-history?limit=100", { translations: [] })
    ]);
    state.members = results[0].memberships || [];
    state.messages = results[1].messages || [];
    state.pins = results[2].messages || [];
    state.profile = results[3].profile || {
      spoken_language: state.locale,
      preferred_output_language: state.locale === "vi" ? "zh-TW" : "vi",
      auto_translate_enabled: true,
      auto_read_enabled: false,
      show_original_enabled: true
    };
    state.consent = results[4].consent || null;
    state.translations = results[5].events || [];
    state.chatTranslations = {};
    (results[6].translations || []).forEach(function (item) {
      state.chatTranslations[item.message_id] = item;
    });
    await loadMembershipManagement();
    if (state.surface === "call" || state.surface === "video") await loadMediaSessions();
    if (state.surface === "radio") await loadRadioSession();
    window.setTimeout(translateMissingChatMessages, 0);
  }

  async function translateMissingChatMessages() {
    if (chatTranslationSweep || !state.space || !state.profile || ["chat", "chat-translation"].indexOf(state.surface) < 0) return;
    if (!state.profile.auto_translate_enabled || !state.consent || state.consent.status !== "granted") return;
    var targetLanguage = state.profile.preferred_output_language;
    var candidates = state.messages.filter(function (message) {
      var failedAt = chatTranslationFailures.get(message.id) || 0;
      return message.content_type === "text"
        && message.source_language
        && message.source_language !== targetLanguage
        && !state.chatTranslations[message.id]
        && !chatTranslationInflight.has(message.id)
        && Date.now() - failedAt > 30000;
    }).slice(-12);
    if (!candidates.length) return;
    chatTranslationSweep = true;
    try {
      for (var index = 0; index < candidates.length; index += 1) {
        var message = candidates[index];
        if (!state.space || state.chatTranslations[message.id]) continue;
        chatTranslationInflight.add(message.id);
        try {
          var payload = await api(
            "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/messages/" +
              encodeURIComponent(message.id) + "/translation",
            { method: "POST", headers: { "Idempotency-Key": idempotencyKey() } }
          );
          if (payload.translation && payload.translation.state === "FINAL") {
            state.chatTranslations[message.id] = payload.translation;
            render();
          }
        } catch (_error) {
          chatTranslationFailures.set(message.id, Date.now());
        } finally {
          chatTranslationInflight.delete(message.id);
        }
      }
    } finally {
      chatTranslationSweep = false;
    }
  }

  async function loadMediaSessions() {
    var path = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/sessions?limit=50";
    var payload = await optional(path, { sessions: [] });
    var kind = state.surface === "video" ? "video" : "audio";
    state.mediaSession = (payload.sessions || []).find(function (item) {
      return item.media_kind === kind && item.status !== "ended";
    }) || null;
  }

  async function loadRadioSession() {
    var base = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/radio/sessions";
    var payload = await optional(base + "?status=ready&limit=50", { sessions: [] });
    state.radioSession = (payload.sessions || [])[0] || null;
    state.radioFloor = null;
    if (state.radioSession) {
      var detail = await optional(base + "/" + encodeURIComponent(state.radioSession.id), null);
      if (detail) {
        state.radioSession = detail.session;
        state.radioFloor = detail.floor;
      }
    }
  }

  function renderRooms() {
    var rows = state.spaces.map(function (space, index) {
      return '<button type="button" class="room-row ' + (space.id === (state.space && state.space.id) ? "is-active" : "") + '" data-action="select-space" data-id="' + esc(space.id) + '">' +
        '<span class="room-avatar ' + (index % 3 === 1 ? "soft" : index % 3 === 2 ? "sand" : "") + '">' + esc(initials(space.title)) + "</span>" +
        "<span><strong>" + esc(space.title) + "</strong><small>" + esc(space.description || t("roomDescription")) + "</small></span>" +
        (space.id === (state.space && state.space.id) ? "<b>•</b>" : "") + "</button>";
    }).join("");
    var createForm = state.creatingSpace
      ? '<form class="space-create-form context-create" data-form="create-space"><input name="title" data-group-text-entry maxlength="120" required placeholder="' + esc(t("spaceName")) + '"><button class="action-button action-primary" type="submit">' + esc(t("create")) + "</button></form>"
      : action("show-create-space", t("createSpace"), "users", "secondary", 'class="context-create"');
    return '<aside class="context-rail ' + (state.surface === "radio" ? "radio-context" : "") + '">' +
      '<div class="context-heading"><span>' + esc(t("rooms")) + "</span><strong>" + esc(t("workspace")) + "</strong></div>" +
      '<div class="room-list">' + rows + "</div>" + createForm +
      '<div class="context-foot">' + badge("AI native", "success") + "<p>" + esc(t("encrypted")) + "</p></div></aside>";
  }

  function navigation() {
    var items = [
      ["chat", "message-circle", "groupChat"],
      ["chat-translation", "languages", "chatTranslation"],
      ["call", "phone-call", "groupCall"],
      ["video", "video", "groupVideo"],
      ["radio", "radio-tower", "groupRadio"],
      ["radio-translation", "globe", "radioTranslation"]
    ];
    var buttons = items.map(function (item) {
      return '<button type="button" data-action="surface" data-surface="' + item[0] + '" ' + (!state.groupAuthorized ? "disabled" : "") + ' class="' + (item[0] === state.surface ? "is-active" : "") + '">' +
        icon(item[1], 21) + "<span>" + esc(t(item[2])) + "</span></button>";
    }).join("");
    var direct = '<a href="/assistant" class="direct-navigation">' + icon("message-circle", 21) + "<span>" + esc(t("directMessages")) + "</span></a>";
    var logoutPath = "/logout?lang=" + encodeURIComponent(state.locale);
    var logout = '<a href="' + esc(logoutPath) + '" class="logout-navigation" aria-label="' + esc(t("logout")) + '" title="' + esc(t("logout")) + '">' + icon("log-out", 19) + "<span>" + esc(t("logout")) + "</span></a>";
    var identity = '<div class="identity-actions"><div class="identity-chip" aria-label="' + esc(state.context && state.context.principal && state.context.principal.display_name || "") + '"><span>' + esc(initials(state.context && state.context.principal.display_name)) + "</span><i></i></div>" + logout + "</div>";
    return {
      desktop: '<aside class="global-nav" aria-label="' + esc(t("roomNavigation")) + '"><div class="app-logo is-compact"><span class="app-logo-mark"><img src="/static/group-v3/timeblock-chat.svg" alt=""></span></div><nav>' + direct + buttons + '</nav>' + identity + "</aside>",
      mobile: '<nav class="mobile-bottom-nav" aria-label="' + esc(t("roomNavigation")) + '">' + direct + buttons + "</nav>",
      mobileLogout: logout
    };
  }

  function closeGroupEvents() {
    window.clearTimeout(groupEventRefreshTimer);
    groupEventRefreshTimer = 0;
    if (groupEventSource) groupEventSource.close();
    groupEventSource = null;
  }

  function queueGroupEventRefresh(spaceId) {
    if (!state.space || state.space.id !== spaceId || groupEventRefreshTimer) return;
    groupEventRefreshTimer = window.setTimeout(async function () {
      groupEventRefreshTimer = 0;
      if (!state.space || state.space.id !== spaceId || state.busy) return;
      try {
        await loadSpaces(spaceId);
        if (!state.space || state.space.id !== spaceId) await disconnectMedia(false);
        render();
      } catch (error) {
        if (error && error.status === 403) {
          await disconnectMedia(false);
          closeGroupEvents();
          state.error = t("membershipAccessRevoked");
          render();
        }
      }
    }, 120);
  }

  function connectGroupEvents() {
    closeGroupEvents();
    if (!state.groupAuthorized || !state.space || !("EventSource" in window)) return;
    var spaceId = state.space.id;
    groupEventSource = new EventSource(
      "/api/group/spaces/" + encodeURIComponent(spaceId) + "/events",
      { withCredentials: true }
    );
    groupEventSource.addEventListener("group-change", function (event) {
      try {
        var payload = JSON.parse(event.data || "{}");
        if (payload.space_id === spaceId) queueGroupEventRefresh(spaceId);
      } catch (_error) {}
    });
  }

  function handoffRequired() {
    return '<section class="runtime-empty surface-content"><span>' + icon("users", 32) + "</span><h2>" +
      esc(t("handoffRequiredTitle")) + "</h2><p>" + esc(t("handoffRequiredNote")) +
      '</p><a class="action-button action-primary" href="' + esc(runtimeConfig.timeblock_entry_url || "/") + '">' +
      icon("users", 17) + "<span>" + esc(t("openTimeblock")) + "</span></a></section>";
  }

  function mobileLanguageBar() {
    var profile = state.profile || {};
    return '<div class="mobile-language-bar"><button type="button" class="' + (profile.auto_read_enabled ? "is-active" : "") + '" data-action="toggle-auto-read" aria-pressed="' + Boolean(profile.auto_read_enabled) + '">' +
      icon("headphones", 16) + "<span>" + esc(t("autoRead")) + "</span><strong>" + (profile.auto_read_enabled ? "ON" : "OFF") + "</strong></button>" +
      "<label>" + icon("languages", 16) + "<span>" + esc(t("targetLanguage")) + '</span><select data-change="target-language">' + languageOptions(profile.preferred_output_language || "zh-TW") + "</select></label>" +
      '<label class="locale-select"><span>' + esc(t("language")) + '</span><select data-change="locale">' +
      '<option value="vi" ' + (state.locale === "vi" ? "selected" : "") + ">VI</option>" +
      '<option value="en" ' + (state.locale === "en" ? "selected" : "") + ">EN</option>" +
      '<option value="zh-TW" ' + (state.locale === "zh-TW" ? "selected" : "") + ">繁中</option></select></label></div>";
  }

  function renderParticipants(callMode) {
    var rows = state.members.filter(function (member) {
      return member.status === "active";
    }).map(function (member) {
      var participant = state.mediaSession && state.mediaSession.participants.find(function (item) {
        return item.membership_id === member.id;
      });
      var status = participant ? participant.invite_status : member.role;
      return '<div class="participant">' + avatar(member.display_name, member.role === "owner" ? "teal" : "mint", "md", status === "joined") +
        "<span><strong>" + esc(member.display_name) + "</strong><small>" + esc(callMode ? status : member.role) + '</small></span><i class="' + (status === "joined" ? "online" : "") + '"></i></div>';
    }).join("");
    return '<aside class="participant-panel ' + (callMode ? "call-participants" : "") + '"><div class="panel-title"><span>' +
      icon("users", 18) + esc(t("participants")) + "</span>" + badge(String(activeMemberCount()), "mint") + '</div><p class="panel-subtitle">' +
      esc(t("roles")) + '</p><div class="participant-list">' + (rows || '<p class="member-empty">' + esc(t("inviteRequired")) + "</p>") + "</div></aside>";
  }

  function renderMemberManager() {
    if (!state.memberManagerOpen) return "";
    var mine = myMembership();
    var canManage = mine && ["owner", "admin"].indexOf(mine.role) >= 0;
    var canManageRoles = mine && mine.role === "owner";
    var incoming = state.incomingInvitations.map(function (item) {
      var space = state.spaces.find(function (candidate) { return candidate.id === item.space_id; });
      var decisions = state.directAvailable
        ? action("accept-invitation", t("accept"), "users", "primary", 'data-id="' + esc(item.id) + '"') +
          action("reject-invitation", t("reject"), "log-out", "ghost", 'data-id="' + esc(item.id) + '"')
        : '<a class="action-button action-primary" href="/api/session/start?return_to=' +
          encodeURIComponent(window.location.pathname + window.location.search) + '">' +
          icon("users", 17) + "<span>" + esc(t("authorizeDirect")) + "</span></a>";
      return '<article class="member-manager-row"><div>' + avatar(item.display_name, "mint", "md", false) +
        '<span><strong>' + esc(item.space_title || (space ? space.title : t("groupSession"))) + '</strong><small>' +
        esc(t("invitedAsMember")) + '</small></span></div><div class="member-manager-actions">' + decisions + "</div></article>";
    }).join("");
    var members = state.members.filter(function (item) { return item.status === "active"; }).map(function (item) {
      var isSelf = mine && item.id === mine.id;
      var controls = "";
      if (!isSelf && item.role !== "owner" && canManage) {
        if (canManageRoles) {
          controls += action(
            "toggle-member-role",
            item.role === "admin" ? t("makeMember") : t("makeAdmin"),
            "users",
            "secondary",
            'data-id="' + esc(item.id) + '" data-role="' + esc(item.role === "admin" ? "member" : "admin") + '"'
          );
        }
        if (mine.role === "owner" || item.role === "member") {
          controls += action("remove-member", t("removeMember"), "log-out", "danger", 'data-id="' + esc(item.id) + '"');
        }
      }
      return '<article class="member-manager-row"><div>' + avatar(item.display_name, item.role === "owner" ? "teal" : "mint", "md", true) +
        '<span><strong>' + esc(item.display_name) + '</strong><small>' + esc(t(item.role === "owner" ? "owner" : item.role === "admin" ? "moderator" : "member")) +
        '</small></span></div><div class="member-manager-actions">' + controls + "</div></article>";
    }).join("");
    var candidates = state.directoryCandidates.map(function (item) {
      var available = item.membership_status === "available";
      var label = available ? t("invite") : item.membership_status === "active" ? t("alreadyMember") : t("invited");
      return '<article class="member-manager-row"><div>' + avatar(item.display_name, item.principal_type === "business" ? "sand" : "mint", "md", false) +
        '<span><strong>' + esc(item.display_name) + '</strong><small>' + esc(item.principal_type === "business" ? t("businessAccount") : t("memberAccount")) +
        (item.handle ? " · " + esc(item.handle) : "") + '</small></span></div><div class="member-manager-actions">' +
        action("invite-contact", label, "users", available ? "primary" : "secondary", 'data-ref="' + esc(item.contact_ref) + '" ' + (available ? "" : "disabled")) +
        "</div></article>";
    }).join("");
    var pending = state.spaceInvitations.filter(function (item) { return item.status === "pending"; }).map(function (item) {
      return '<article class="member-manager-row"><div>' + avatar(item.display_name, "sand", "md", false) +
        '<span><strong>' + esc(item.display_name) + '</strong><small>' + esc(t("pendingInvitation")) + '</small></span></div><div class="member-manager-actions">' +
        action("cancel-invitation", t("cancelInvitation"), "log-out", "ghost", 'data-id="' + esc(item.id) + '"') + "</div></article>";
    }).join("");
    var directUpgrade = canManage && !state.directAvailable
      ? '<div class="member-manager-upgrade"><p>' + esc(t("directRequiredForContacts")) + '</p><a class="action-button action-primary" href="/api/session/start?return_to=' +
        encodeURIComponent(window.location.pathname + window.location.search) + '">' + icon("users", 17) + "<span>" + esc(t("authorizeDirect")) + "</span></a></div>"
      : "";
    return '<div class="member-manager-backdrop" data-action="close-members"><section class="member-manager" role="dialog" aria-modal="true" aria-labelledby="member-manager-title" data-member-manager>' +
      '<header><div><strong id="member-manager-title">' + esc(t("manageMembers")) + '</strong><small>' + esc(state.space ? state.space.title : t("groupSession")) +
      '</small></div>' + iconButton("close-members", t("close"), "log-out") + '</header><div class="member-manager-scroll">' +
      (incoming ? '<section><h3>' + esc(t("incomingInvitations")) + '</h3>' + incoming + '</section>' : "") +
      (state.space ? '<section><h3>' + esc(t("activeMembers")) + '</h3>' + (members || '<p class="member-empty">' + esc(t("inviteRequired")) + '</p>') + '</section>' : "") +
      (canManage ? '<section><h3>' + esc(t("addFromContacts")) + '</h3>' + directUpgrade +
        (state.directAvailable ? candidates || '<p class="member-empty">' + esc(t("noEligibleContacts")) + '</p>' : "") + '</section>' : "") +
      (pending ? '<section><h3>' + esc(t("pendingInvitations")) + '</h3>' + pending + '</section>' : "") +
      (!incoming && !state.space ? '<p class="member-empty">' + esc(t("noInvitations")) + '</p>' : "") +
      '</div></section></div>';
  }

  function renderMessage(message) {
    var mine = message.sender
      && message.sender.type === state.context.principal.type
      && message.sender.id === state.context.principal.id
      && message.sender.user_id === state.context.principal.user_id;
    var attachments = (message.attachments || []).map(function (item) {
      return '<a class="attachment-chip" href="' + esc(item.download_url) + '" download>' + icon("paperclip", 14) + "<span>" + esc(item.name) + "</span></a>";
    }).join("");
    var time = message.created_at ? formatTime(message.created_at) : "";
    var translation = state.chatTranslations[message.id];
    var translated = translation && translation.state === "FINAL"
      ? '<div class="translation-block"><div><span>' + esc(t("translated")) + " · " +
        esc(translation.source_language) + " → " + esc(translation.target_language) + "</span>" +
        badge(t("final"), "success") + "</div><strong>" + esc(translation.translated_text) +
        "</strong><small>" + icon("languages", 13) + esc(t("chatTranslationLinked")) + "</small></div>"
      : "";
    return '<article class="message-row ' + (mine ? "is-mine" : "") + '" data-message-id="' + esc(message.id) + '">' +
      (mine ? "" : avatar(message.sender && message.sender.display_name, "mint", "md", true)) +
      '<div class="message-bubble"><div class="message-meta"><strong>' + esc(mine ? t("currentUser") : message.sender && message.sender.display_name) +
      "</strong><span>" + esc(time) + "</span>" + (message.pinned ? badge(t("pinned"), "mint") : "") + "</div><p>" +
      esc(message.content_type === "tombstone" ? "—" : message.content) + "</p>" + attachments + translated +
      '<div class="message-actions"><button type="button" data-action="pin-message" data-id="' + esc(message.id) + '" data-pinned="' + Boolean(message.pinned) +
      '" aria-label="' + esc(message.pinned ? t("unpinMessage") : t("pinMessage")) + '">' + icon("pin", 15) + "</button></div></div></article>";
  }

  function renderChat() {
    var pinned = state.pins[0];
    var pinnedBlock = '<div class="pinned-message"><span>' + icon("pin", 15) + "</span><div><strong>" + esc(t("pinned")) + "</strong><p>" +
      esc(pinned ? pinned.content : t("noPinned")) + "</p></div></div>";
    var messages = state.messages.length
      ? state.messages.map(renderMessage).join("")
      : '<div class="runtime-empty"><span>' + icon("message-circle", 28) + "</span><p>" + esc(t("emptyThread")) + "</p></div>";
    var pending = state.pendingAttachment
      ? '<span class="attachment-chip">' + icon("paperclip", 14) + "<span>" + esc(state.pendingAttachment.name) + "</span></span>"
      : "";
    return '<div class="chat-content state-thread surface-content"><section class="thread-column"><div class="thread-scroll">' +
      pinnedBlock + '<div class="day-divider">' + esc(t("today")) + '</div><div data-message-list>' + messages +
      '</div></div><form class="composer" data-form="send-message"><span class="composer-file"><input id="group-attachment" type="file" data-change="attachment">' +
      '<label for="group-attachment" aria-label="' + esc(t("attach")) + '">' + icon("paperclip", 18) + '</label></span><div><textarea name="content" data-group-text-entry rows="1" maxlength="8000" enterkeyhint="send" autocapitalize="sentences" spellcheck="true" autocomplete="off" placeholder="' +
      esc(t("composer")) + '" aria-label="' + esc(t("composer")) + '"></textarea>' + pending + '</div><button type="submit" class="action-button action-primary" aria-label="' +
      esc(t("send")) + '">' + icon("send", 17) + "<span>" + esc(t("send")) + "</span></button></form></section>" + renderParticipants(false) + "</div>";
  }

  function inviteForm(kind) {
    var mine = myMembership();
    var others = state.members.filter(function (member) {
      return member.status === "active" && (!mine || member.id !== mine.id);
    });
    var labels = others.map(function (member) {
      var searchText = String(member.display_name || "") + " " + String(member.principal_id || "");
      return '<label data-media-member data-member-name="' + esc(searchText) + '"><input type="checkbox" name="participant" value="' + esc(member.id) + '"> ' +
        avatar(member.display_name, "mint", "sm", true) + "<span>" + esc(member.display_name) + "</span></label>";
    }).join("");
    var title = kind === "radio" ? t("startRadio") : kind === "video" ? t("startVideoCall") : t("startAudioCall");
    var iconName = kind === "radio" ? "radio-tower" : kind === "video" ? "video" : "phone-call";
    return '<div class="runtime-empty"><span>' + icon(iconName, 28) + "</span><h2>" + esc(t("noActiveSession")) + "</h2><p>" +
      esc(others.length ? t("chooseParticipants") : t("creatorNeedsInvitee")) + '</p><form class="media-start-form" data-form="' +
      (kind === "radio" ? "create-radio" : "create-media") + '" data-kind="' + kind + '">' +
      (others.length ? '<label class="media-member-search"><span>' + icon("search", 15) + '<span class="sr-only">' + esc(t("searchMembers")) + '</span><input type="search" data-media-member-search autocomplete="off" placeholder="' + esc(t("searchMembers")) + '"></label>' : "") +
      '<fieldset>' + labels + '</fieldset><p class="media-member-empty" data-media-no-results hidden>' + esc(t("noEligibleContacts")) + '</p><button type="submit" class="action-button action-primary" ' + (others.length ? "" : "disabled") + ">" +
      icon(iconName, 17) + "<span>" + esc(title) + "</span></button></form></div>";
  }

  function callDock(kind) {
    return '<div class="call-control-dock">' +
      (state.mediaConnected
        ? action("toggle-mic", state.micEnabled ? t("micOn") : t("micOff"), "mic", state.micEnabled ? "secondary" : "danger")
        : action("connect-media", t("join"), kind === "video" ? "video" : "phone-call", "primary")) +
      (kind === "video" && state.mediaConnected
        ? action("toggle-video", state.videoEnabled ? t("videoOn") : t("videoOff"), "video", state.videoEnabled ? "secondary" : "danger")
        : "") +
      action("leave-media", t("leaveCall"), "log-out", "danger") +
      action("end-media", t("endForAll"), "phone-call", "ghost", 'class="end-for-all"') + "</div>";
  }

  function translationDock() {
    var item = state.translations[0];
    var content = item
      ? "<div>" + avatar(memberName(item.speaker_membership_id), "teal", "sm", true) + "<span><strong>" +
        esc(memberName(item.speaker_membership_id)) + "</strong><small>" + esc(item.source_language) + " · " + esc(formatTime(item.final_at)) +
        "</small></span>" + badge(t("final"), "success") + "</div><p>" + esc(item.original_text) + "</p><strong>" +
        esc(item.translated_text) + "</strong><small>" + icon("headphones", 13) + esc(t("textBeforeAudio")) + "</small>"
      : "<p>" + esc(t("historyEmpty")) + "</p>";
    return '<aside class="translation-dock"><div class="panel-title"><span>' + icon("languages", 18) + esc(t("translationPlugin")) +
      "</span>" + badge(item ? t("final") : "READY", "success") + '</div><label class="language-select is-compact"><span>' +
      icon("languages", 14) + esc(t("targetLanguage")) + '</span><select data-change="target-language">' +
      languageOptions(state.profile && state.profile.preferred_output_language || "zh-TW") + '</select></label><div class="live-caption-card">' +
      content + "</div>" + toggle("toggle-auto-read", t("autoRead"), t("autoReadRecipient"), Boolean(state.profile && state.profile.auto_read_enabled)) + "</aside>";
  }

  function renderMedia() {
    var session = state.mediaSession;
    var kind = state.surface === "video" ? "video" : "audio";
    if (!session) return '<div class="chat-content state-active_' + kind + ' surface-content">' + inviteForm(kind) + renderParticipants(true) + "</div>";
    var me = selfParticipant(session);
    if (me && me.invite_status === "invited" && session.status === "ringing") {
      return '<div class="chat-content state-ringing_audio surface-content"><div class="call-stage incoming-stage"><div class="incoming-orbit">' +
        avatar(session.participants[0] && session.participants[0].display_name || session.title, "teal", "xl", true) +
        "<i></i><i></i></div>" + badge("RINGING", "warning") + "<h1>" + esc(kind === "video" ? t("groupVideo") : t("incomingAudio")) +
        "</h1><p>" + esc(session.title || state.space.title) + '<div class="privacy-note">' + icon("mic", 18) + "<strong>" +
        esc(t("mediaPolicy")) + '</strong></div><div class="incoming-actions">' +
        action("join-media", t("join"), kind === "video" ? "video" : "phone-call", "primary") +
        action("reject-media", t("reject"), "log-out", "danger") + "</div></div>" + renderParticipants(true) + "</div>";
    }
    if (session.status === "ringing") {
      return '<div class="chat-content state-ringing_audio surface-content"><div class="call-stage decision-stage">' +
        badge("RINGING", "warning") + "<h2>" + esc(t("mediaPolicy")) + "</h2><p>" + esc(t("noActiveSession")) +
        "</p>" + callDock(kind) + "</div>" + renderParticipants(true) + "</div>";
    }
    if (kind === "video") {
      var people = (session.participants || []).filter(function (person) { return person.invite_status === "joined"; });
      var tiles = people.map(function (person, index) {
        return '<article class="video-tile ' + (index === 0 ? "is-featured is-speaking" : "tone-mint") + '" data-video-identity="' +
          esc(person.livekit_identity) + '">' + avatar(person.display_name, index === 0 ? "teal" : "mint", index === 0 ? "xl" : "lg", true) +
          "<div><strong>" + esc(person.display_name) + "</strong>" + (index === 0 ? wave(true) : "") + "</div></article>";
      }).join("");
      return '<div class="video-call-layout ' + (state.profile && state.profile.auto_translate_enabled ? "with-translation" : "") +
        ' surface-content"><div class="video-stage"><div class="call-status-line">' + badge("LIVE", "success") + "<span>" +
        esc(t("activeVideo")) + '</span></div><div class="video-grid" data-video-grid>' + tiles + "</div>" + callDock(kind) +
        '<div class="audio-host" data-audio-host></div></div>' + (state.profile && state.profile.auto_translate_enabled ? translationDock() : "") + "</div>";
    }
    var speaker = (session.participants || []).find(function (person) { return person.invite_status === "joined"; }) || me;
    var peopleRow = (session.participants || []).filter(function (person) { return person.invite_status === "joined"; }).slice(0, 4).map(function (person) {
      return "<div>" + avatar(person.display_name, "mint", "lg", true) + "<span>" + esc(person.display_name) + "</span></div>";
    }).join("");
    return '<div class="chat-content state-active_audio surface-content"><div class="call-stage audio-stage"><div class="call-status-line">' +
      badge("LIVE", "success") + "<span>" + esc(t("activeAudio")) + '</span></div><div class="speaker-hero"><span class="speaker-ring">' +
      avatar(speaker && speaker.display_name, "teal", "xl", true) + "</span><h1>" + esc(speaker && speaker.display_name || state.space.title) +
      "</h1><p>" + esc(t("speaking")) + "</p>" + wave(false) + '</div><div class="audio-participant-row">' + peopleRow + "</div>" +
      callDock(kind) + '<div class="audio-host" data-audio-host></div></div>' + renderParticipants(true) + "</div>";
  }

  function radioState() {
    if (!state.radioSession) return "IDLE";
    if (state.radioSession.status === "ended") return "ENDED";
    if (state.radioStopping) return "STOPPING";
    if (state.deviceLost || state.burst && state.burst.state === "device_lost") return "DEVICE_LOST";
    if (state.burst && state.burst.state === "talking" && state.floorToken) return "TALKING";
    if (state.burst && state.burst.state === "finalizing") return "FINALIZING_BURST";
    if (state.burst && state.burst.state === "final") return "TRANSLATION_HISTORY";
    if (state.radioFloor) return "FLOOR_BUSY";
    if (!state.mediaConnected) return "DISCONNECTED";
    return "READY";
  }

  function radioRoster() {
    var participants = state.radioSession && state.radioSession.participants || [];
    var rows = participants.map(function (person) {
      var speaking = state.radioFloor && state.radioFloor.participant_id === person.id;
      return '<div class="' + (speaking ? "is-speaking" : "") + '">' + avatar(person.display_name, "mint", "sm", person.status === "joined") +
        "<span><strong>" + esc(person.display_name) + "</strong><small>" + esc(person.status) + "</small></span>" +
        (speaking ? wave(true) : "<i></i>") + "</div>";
    }).join("");
    var latest = state.translations.find(function (item) { return item.runtime_kind === "radio"; }) || state.translations[0];
    var translation = latest
      ? '<article class="radio-final-card"><div>' + avatar(memberName(latest.speaker_membership_id), "teal", "sm", true) +
        "<span><strong>" + esc(memberName(latest.speaker_membership_id)) + "</strong><small>" + esc(latest.source_language) + " · " +
        esc(formatTime(latest.final_at)) + "</small></span></div><p>" + esc(latest.original_text) + "</p><strong>" +
        esc(latest.translated_text) + "</strong><small>" + icon("headphones", 13) + esc(t("textBeforeAudio")) + "</small></article>"
      : '<p class="member-empty">' + esc(t("historyEmpty")) + "</p>";
    return '<aside class="radio-inspector"><section class="radio-members-card"><div class="panel-title"><span>' +
      icon("users", 18) + esc(t("participants")) + "</span>" + badge(String(participants.length), "mint") +
      '</div><div class="radio-members">' + rows + '</div></section><section class="radio-translation-card"><div class="panel-title"><span>' +
      icon("languages", 18) + esc(t("translationPlugin")) + "</span>" + badge(latest ? t("final") : "READY", "success") +
      "</div>" + translation + toggle("toggle-auto-read", t("autoRead"), t("autoReadRecipient"), Boolean(state.profile && state.profile.auto_read_enabled)) +
      "</section>" + action("leave-radio", t("leaveRadio"), "log-out", "secondary", 'class="desktop-leave"') + "</aside>";
  }

  function radioStage() {
    var current = radioState();
    if (current === "FLOOR_BUSY") return '<div class="radio-primary-stage busy-stage">' + avatar(state.radioFloor && state.radioFloor.display_name, "teal", "xl", true) +
      badge("FLOOR_BUSY", "warning") + "<h1>" + esc(state.radioFloor && state.radioFloor.display_name || t("floorOwner")) + "</h1>" + wave(false) +
      '<button class="action-button action-disabled ptt-main-button" disabled>' + icon("mic", 17) + "<span>" + esc(t("floorBusy")) +
      "</span></button><p>" + esc(t("requestQueued")) + "</p></div>";
    if (current === "TALKING") return '<div class="radio-primary-stage talking-stage"><div class="live-mic">' + icon("mic", 40) + "<i></i></div>" +
      badge("TALKING", "danger") + "<h1>" + esc(t("talkingNow")) + "</h1>" + wave(false) + '<div class="partial-transcript">' +
      badge(t("partial"), "warning") + "<p>" + esc(t("liveTranscript")) + "</p><small>" + esc(t("partialNotSaved")) +
      "</small></div>" + action("stop-radio", t("stopBurst"), "mic", "danger", 'class="ptt-main-button"') + "</div>";
    if (current === "STOPPING") return '<div class="radio-primary-stage finalizing-stage">' +
      badge("STOPPING", "warning") + "<h1>" + esc(t("stoppingBurst")) + "</h1><p>" + esc(t("releasingFloor")) + "</p></div>";
    if (current === "FINALIZING_BURST") return '<div class="radio-primary-stage finalizing-stage">' +
      badge("FINALIZING_BURST", "info") + "<h1>" + esc(t("finalizingBurst")) + "</h1><p>" + esc(t("finalizingNote")) +
      '</p><div class="sequence-list"><div class="sequence-step is-done"><span><i></i></span><strong>' + esc(t("floorReleased")) +
      '</strong></div><div class="sequence-step is-active"><span><i></i></span><strong>' + esc(t("sttProcessing")) +
      '</strong></div><div class="sequence-step is-queued"><span><i></i></span><strong>' + esc(t("translationQueued")) +
      '</strong></div><div class="sequence-step is-queued"><span><i></i></span><strong>' + esc(t("ttsAfterFinal")) +
      '</strong></div></div><div class="floor-release-proof">' + icon("radio-tower", 18) + "<span><strong>" +
      esc(t("floorReleasedFirst")) + "</strong><small>" + esc(t("floorAvailable")) + "</small></span></div></div>";
    if (current === "DEVICE_LOST") return '<div class="radio-primary-stage device-lost-stage"><span class="device-alert-icon">' +
      icon("headphones", 36) + "</span>" + badge("DEVICE_LOST", "danger") + "<h1>" + esc(t("deviceLostTitle")) + "</h1><p>" +
      esc(t("devicePrivacy")) + '</p><div class="audio-privacy-proof">' + icon("headphones", 20) + "<span><strong>" +
      esc(t("privateAudioSuppressed")) + "</strong><small>" + esc(t("deviceLostAction")) + "</small></span></div>" +
      action("reconnect-radio", t("reconnectDevice"), "refresh-cw", "primary") + "</div>";
    if (current === "DISCONNECTED") return '<div class="radio-primary-stage device-lost-stage">' +
      badge("DISCONNECTED", "warning") + "<h1>" + esc(t("radioDisconnected")) + "</h1><p>" +
      esc(t("radioReconnectNote")) + "</p>" + action("reconnect-radio", t("reconnect"), "refresh-cw", "primary") + "</div>";
    if (current === "ENDED") return '<div class="radio-primary-stage history-stage">' +
      badge("ENDED", "muted") + "<h1>" + esc(t("endedForAll")) + "</h1></div>";
    if (current === "TRANSLATION_HISTORY") {
      var item = state.translations.find(function (event) { return event.runtime_kind === "radio"; }) || state.translations[0];
      return '<div class="radio-primary-stage history-stage">' + badge(t("final"), "success") + "<h1>" + esc(t("translationReady")) +
        "</h1><p>" + esc(t("textBeforeAudio")) + "</p>" + (item ? '<article class="history-featured"><div>' +
        avatar(memberName(item.speaker_membership_id), "teal", "md", true) + "<span><strong>" + esc(memberName(item.speaker_membership_id)) +
        "</strong><small>" + esc(formatTime(item.final_at)) + " · " + esc(item.source_language) + " → " + esc(item.target_language) +
        "</small></span></div><p>" + esc(item.original_text) + "</p><strong>" + esc(item.translated_text) + "</strong></article>" : "") + "</div>";
    }
    return '<div class="radio-primary-stage ready-stage"><div class="ptt-orbit"><span>' + icon("mic", 38) +
      "</span><i></i><i></i></div><h1>" + esc(t("floorAvailable")) + "</h1><p>" + esc(t("startTalking")) + "</p>" +
      action("start-radio", t("startTalking"), "mic", "primary", 'class="ptt-main-button"') +
      '<span class="radio-listen-state"><i></i>' + esc(t("listenMode")) + "</span></div>";
  }

  function renderRadio() {
    if (!state.radioSession) return '<div class="radio-content surface-content"><main class="radio-center">' + inviteForm("radio") + '</main><aside class="radio-inspector"></aside></div>';
    var me = selfParticipant(state.radioSession, true);
    if (me && me.status === "invited") {
      return '<div class="radio-content surface-content"><main class="radio-center"><div class="call-stage incoming-stage">' +
        badge("RINGING", "warning") + "<h1>" + esc(t("groupRadio")) + "</h1><p>" + esc(state.radioSession.title || state.space.title) +
        '</p><div class="privacy-note">' + icon("mic", 18) + "<strong>" + esc(t("mediaPolicy")) + '</strong></div><div class="incoming-actions">' +
        action("join-radio", t("join"), "radio-tower", "primary") + action("reject-radio", t("reject"), "log-out", "danger") +
        '</div></div><div class="radio-mobile-dock">' + action("stop-radio", t("stopBurst"), "mic", "danger", "disabled") +
        action("reject-radio", t("reject"), "log-out", "secondary") + "</div></main>" + radioRoster() + "</div>";
    }
    var current = radioState();
    return '<div class="radio-content state-' + current.toLowerCase() + ' surface-content"><main class="radio-center"><section class="floor-summary floor-' +
      current.toLowerCase() + '"><div class="floor-copy"><span class="floor-indicator"><i></i></span><span><strong>' +
      esc(current === "FLOOR_BUSY" ? t("floorBusy") : current === "TALKING" ? t("talkingNow") : t("floorAvailable")) +
      "</strong><small>" + esc(current) + '</small></span></div><div class="floor-level"><span style="width:' +
      (current === "TALKING" ? 78 : current === "FLOOR_BUSY" ? 56 : 18) + '%"></span></div></section>' + radioStage() +
      '<div class="radio-mobile-dock">' + action("stop-radio", t("stopBurst"), "mic", "danger", current === "TALKING" ? "" : "disabled") +
      action("leave-radio", t("leaveRadio"), "log-out", "secondary") + "</div></main>" + radioRoster() + "</div>";
  }

  function renderPlugin() {
    var profile = state.profile || {};
    var chatMode = state.surface !== "radio-translation";
    var chatItems = Object.keys(state.chatTranslations).map(function (key) {
      return state.chatTranslations[key];
    }).filter(function (item) { return item && item.state === "FINAL"; });
    var chatHistory = chatItems.length ? chatItems.map(function (item) {
      var message = state.messages.find(function (candidate) { return candidate.id === item.message_id; }) || {};
      var sender = message.sender && message.sender.display_name || t("groupChat");
      return "<article><div>" + avatar(sender, "mint", "md", true) + "<span><strong>" + esc(sender) +
        "</strong><small>" + esc(item.source_language) + " → " + esc(item.target_language) + " · " +
        esc(formatTime(item.final_at)) + "</small></span>" + badge(t("final"), "success") + "</div><p>" +
        esc(message.content || "") + "</p><strong>" + esc(item.translated_text) + "</strong><small>" +
        icon("languages", 13) + esc(t("chatTranslationLinked")) + "</small></article>";
    }).join("") : '<article class="is-empty">' + esc(t("historyEmpty")) + "</article>";
    var radioItems = state.translations.filter(function (item) {
      return item.runtime_kind === "radio";
    });
    var radioHistory = radioItems.length ? radioItems.map(function (item) {
      return "<article><div>" + avatar(memberName(item.speaker_membership_id), "mint", "md", true) + "<span><strong>" +
        esc(memberName(item.speaker_membership_id)) + "</strong><small>" + esc(item.source_language) + " → " + esc(item.target_language) +
        " · " + esc(formatTime(item.final_at)) + "</small></span>" + badge(t("final"), "success") + "</div><p>" +
        esc(item.original_text) + "</p><strong>" + esc(item.translated_text) + "</strong><small>" + icon("headphones", 13) +
        esc(t("textBeforeAudio")) + "</small></article>";
    }).join("") : '<article class="is-empty">' + esc(t("historyEmpty")) + "</article>";
    var history = chatMode ? chatHistory : radioHistory;
    return '<div class="plugin-workspace surface-content"><div class="plugin-heading"><div><span>' +
      esc(t(chatMode ? "chatTranslation" : "radioTranslation")) +
      "</span><h1>" + esc(t("translationHistory")) + "</h1></div>" + badge("VI · EN · ZH-TW", "mint") +
      '</div><div class="segmented-control"><button type="button" data-action="surface" data-surface="chat-translation" class="' +
      (chatMode ? "is-active" : "") + '">' + icon("languages", 15) + esc(t("chatTranslation")) +
      '</button><button type="button" data-action="surface" data-surface="radio-translation" class="' +
      (!chatMode ? "is-active" : "") + '">' + icon("globe", 15) + esc(t("radioTranslation")) +
      '</button></div><div class="history-list is-focused">' +
      history + '</div><form class="settings-form" data-form="save-profile"><div class="settings-title">' + icon("languages", 17) +
      "<strong>" + esc(t("translationSettings")) + '</strong></div><label class="language-select"><span>' + esc(t("sourceLanguage")) +
      '</span><select name="spoken_language">' + languageOptions(profile.spoken_language || state.locale) +
      '</select></label><label class="language-select"><span>' + esc(t("targetLanguage")) +
      '</span><select name="preferred_output_language">' + languageOptions(profile.preferred_output_language || "zh-TW") +
      "</select></label>" + toggle("toggle-auto-translate", t("autoTranslate"), "", Boolean(profile.auto_translate_enabled)) +
      toggle("toggle-auto-read", t("autoRead"), t("autoReadRecipient"), Boolean(profile.auto_read_enabled)) +
      toggle("toggle-consent", t("consent"), t("consentDetail"), state.consent && state.consent.status === "granted") +
      '<button type="submit" class="action-button action-primary">' + icon("languages", 17) + "<span>" +
      esc(t("saveSettings")) + "</span></button></form></div>";
  }

  function header() {
    var title = state.space ? state.space.title : t("rooms");
    var status = state.surface === "radio" ? radioState() : state.mediaSession ? state.mediaSession.status.toUpperCase() : "ACTIVE";
    return '<header class="group-header"><div class="group-identity">' +
      (state.surface === "radio" ? '<span class="radio-mark">' + icon("radio-tower", 21) + "</span>" : avatar(title, "teal", "lg", true)) +
      "<span><strong>" + esc(title) + "</strong><small>" + esc(activeMemberCount()) + " " + esc(t("membersLabel")) +
      '</small></span></div><div class="group-header-actions"><span class="surface-status">' + esc(status) + "</span>" +
      iconButton("members", t("manageMembers"), "users") + iconButton("refresh", t("refreshData"), "refresh-cw") + iconButton("plugin", t("translationPlugin"), "languages") + "</div></header>";
  }

  function surface() {
    if (!state.groupAuthorized) return handoffRequired();
    if (!state.space) {
      return '<section class="runtime-empty surface-content"><span>' + icon("users", 28) + "</span><h2>" + esc(t("noSpaces")) +
        "</h2><p>" + esc(t("noSpacesNote")) + '</p><form class="space-create-form" data-form="create-space"><input name="title" data-group-text-entry maxlength="120" required placeholder="' +
        esc(t("spaceName")) + '"><button class="action-button action-primary" type="submit">' + esc(t("create")) + "</button></form></section>";
    }
    if (state.surface === "chat") return renderChat();
    if (state.surface === "call" || state.surface === "video") return renderMedia();
    if (state.surface === "radio") return renderRadio();
    return renderPlugin();
  }

  function deviceErrorText(code) {
    if (code === "permission_denied") return t("permissionDenied");
    if (code === "device_not_found") return t("deviceNotFound");
    if (code === "device_busy") return t("deviceBusy");
    if (code === "browser_unsupported") return t("browserUnsupported");
    return t("deviceError");
  }

  function deviceOptions(items, selected) {
    var options = (items || []).map(function (item) {
      var label = item.label || t("deviceDefault");
      return '<option value="' + esc(item.deviceId) + '" ' + (item.deviceId === selected ? "selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
    return '<option value="">' + esc(t("deviceDefault")) + "</option>" + options;
  }

  function renderPrejoin() {
    if (!state.prejoinOpen) return "";
    var kind = state.prejoinMediaKind === "video" ? "video" : "audio";
    var devices = state.prejoinDevices || {};
    var error = state.prejoinError ? '<div class="prejoin-error" role="alert">' + icon("refresh-cw", 16) + "<span>" + esc(deviceErrorText(state.prejoinError)) + "</span></div>" : "";
    var preview = localStream
      ? '<video class="prejoin-preview-media" data-prejoin-video autoplay playsinline muted></video>'
      : '<div class="prejoin-preview-placeholder">' + icon(kind === "video" ? "video" : "mic", 42) + "<span>" + esc(t("permissionRequired")) + "</span></div>";
    return '<div class="prejoin-backdrop"><section class="prejoin-dialog" role="dialog" aria-modal="true" aria-labelledby="prejoin-title">' +
      '<header><div><span class="prejoin-kicker">' + esc(t("preview")) + '</span><h2 id="prejoin-title">' + esc(t("prejoinTitle")) + '</h2></div>' +
      iconButton("cancel-prejoin", t("cancel"), "log-out") + '</header><p class="prejoin-note">' + esc(t("prejoinNote")) + '</p>' +
      '<div class="prejoin-layout"><div class="prejoin-preview">' + preview + '<div class="prejoin-meter"><span>' + esc(t("audioLevel")) + '</span><i data-prejoin-meter></i></div></div>' +
      '<div class="prejoin-controls"><label><span>' + icon("mic", 16) + esc(t("microphone")) + '</span><select data-change="prejoin-audio-device">' + deviceOptions(devices.audioInputs, state.prejoinAudioDeviceId) + '</select></label>' +
      (kind === "video" ? '<label><span>' + icon("video", 16) + esc(t("camera")) + '</span><select data-change="prejoin-video-device">' + deviceOptions(devices.videoInputs, state.prejoinVideoDeviceId) + '</select></label>' : '') +
      '<label><span>' + icon("headphones", 16) + esc(t("speaker")) + '</span><select data-change="prejoin-output-device">' + deviceOptions(devices.audioOutputs, state.prejoinOutputDeviceId) + '</select></label>' +
      '<button type="button" class="prejoin-toggle ' + (state.prejoinAudioEnabled ? "is-on" : "") + '" data-action="toggle-prejoin-mic" aria-pressed="' + Boolean(state.prejoinAudioEnabled) + '">' + icon("mic", 16) + '<span>' + esc(state.prejoinAudioEnabled ? t("micOn") : t("micOff")) + '</span></button>' +
      (kind === "video" ? '<button type="button" class="prejoin-toggle ' + (state.prejoinVideoEnabled ? "is-on" : "") + '" data-action="toggle-prejoin-video" aria-pressed="' + Boolean(state.prejoinVideoEnabled) + '">' + icon("video", 16) + '<span>' + esc(state.prejoinVideoEnabled ? t("videoOn") : t("videoOff")) + '</span></button>' : '') +
      error + '<div class="prejoin-actions">' + action("prepare-prejoin", localStream ? t("retryDevice") : t("startPreview"), "refresh-cw", "secondary", state.prejoinBusy ? "disabled" : "") +
      action("confirm-prejoin", t("confirmJoin"), kind === "video" ? "video" : "phone-call", "primary", (!localStream || state.prejoinBusy) ? "disabled" : "") + '</div></div></div>' +
      '<small class="prejoin-status">' + esc(state.prejoinBusy ? t("prejoinChecking") : localStream ? t("prejoinReady") : t("permissionRequired")) + '</small></section></div>';
  }

  function render() {
    if (state.status !== "READY" && state.status !== "HANDOFF_REQUIRED") {
      var failed = state.status === "FAILED";
      root.innerHTML = '<section class="group-v3-bootstrap ' + (failed ? "is-error" : "") +
        '"><img src="/static/group-v3/timeblock-chat.svg" width="56" height="56" alt=""><strong>AI-COMMUNICATION</strong><span>' +
        esc(failed ? t("handoffFailed") : t("waitingHandoff")) + "</span>" +
        (failed ? '<a class="action-button action-primary" href="' + esc(runtimeConfig.timeblock_entry_url || "/") + '">' + esc(t("openTimeblock")) + "</a>" : "") +
        "</section>";
      return;
    }
    if (prejoinMeterStop) prejoinMeterStop();
    prejoinMeterStop = null;
    var nav = navigation();
    var banner = state.error ? '<div class="runtime-banner is-error">' + icon("refresh-cw", 15) + "<span>" + esc(state.error) + "</span></div>" : "";
    root.innerHTML = '<div class="native-app native-' + (state.mobile ? "mobile" : "desktop") + '" data-state="' + esc(state.surface) +
      '" data-locale="' + esc(state.locale) + '">' + nav.desktop +
      '<header class="mobile-app-header"><div class="app-logo"><span class="app-logo-mark"><img src="/static/group-v3/timeblock-chat.svg" alt=""></span><span><strong>AI-COMMUNICATION</strong><small>' +
      esc(t("nativeGroupApp")) + '</small></span></div><div class="mobile-header-actions">' + nav.mobileLogout + '<span class="mobile-state-dot"></span></div></header>' + renderRooms() +
      '<section class="native-main ' + (banner ? "has-banner" : "") + '"><div class="session-strip"><span><i></i>' +
      esc(t("signedIn")) + "</span><span>" + esc(state.groupAuthorized ? t("groupSession") : t("handoffRequiredTitle")) + "</span></div>" + banner + (state.groupAuthorized ? header() : "") + mobileLanguageBar() + surface() +
      "</section>" + nav.mobile + "</div>" + renderMemberManager() + renderPrejoin();
    root.dataset.runtimeState = "READY";
    syncMediaElements();
    if (state.prejoinOpen && localStream) {
      var preview = root.querySelector("[data-prejoin-video]");
      if (preview) preview.srcObject = localStream;
      var meter = root.querySelector("[data-prejoin-meter]");
      if (meter && !prejoinMeterStop && window.GroupV3DeviceManager && window.GroupV3DeviceManager.startMeter) {
        prejoinMeterStop = window.GroupV3DeviceManager.startMeter(localStream, function (level) {
          meter.style.setProperty("--meter-level", String(Math.round(level * 100)) + "%");
        });
      }
    }
    resizeTextEntry(root.querySelector("textarea[data-group-text-entry]"));
  }

  async function refreshAll() {
    if (state.busy) {
      refreshQueued = true;
      return;
    }
    setBusy(true);
    state.error = "";
    try {
      if (!state.context) await loadSessionContext();
      if (!state.groupAuthorized) {
        render();
        return;
      }
      await loadSpaces(state.space && state.space.id || "");
      render();
      if (state.profile && state.profile.auto_read_enabled) processTtsJobs();
    } catch (error) {
      if (error.status === 401) state.status = window.opener ? "WAITING" : "FAILED";
      else state.error = publicError(error);
      render();
    } finally {
      setBusy(false);
      if (refreshQueued) {
        refreshQueued = false;
        window.queueMicrotask(refreshAll);
      }
    }
  }

  function updateSurface(next) {
    next = normalizeSurface(next);
    if (SURFACES.indexOf(next) < 0 || next === state.surface) return;
    if (state.floorToken) {
      notify(t("stopBurst"));
      return;
    }
    if (next === "chat-translation" || next === "radio-translation") state.previousSurface = state.surface;
    closePrejoin(true);
    disconnectMedia(false);
    state.surface = next;
    state.mediaSession = null;
    state.radioSession = null;
    state.radioFloor = null;
    state.burst = null;
    state.error = "";
    if (window.location.pathname.indexOf("/group") === 0) {
      window.history.pushState({ groupSurface: next }, "", "/group/" + encodeURIComponent(next));
    }
    render();
    if (!state.space) return;
    setBusy(true);
    var loader = next === "call" || next === "video" ? loadMediaSessions() : next === "radio" ? loadRadioSession() : Promise.resolve();
    loader.catch(function (error) {
      state.error = publicError(error);
    }).finally(function () {
      setBusy(false);
      render();
    });
  }

  async function selectSpace(id) {
    if (state.floorToken) {
      notify(t("stopBurst"));
      return;
    }
    setBusy(true);
    state.error = "";
    try {
      closePrejoin(true);
      await disconnectMedia(false);
      await loadSpaces(id);
      render();
    } catch (error) {
      state.error = publicError(error);
      render();
    } finally {
      setBusy(false);
    }
  }

  async function createSpace(form) {
    var title = String(new FormData(form).get("title") || "").trim();
    if (!title) return;
    setBusy(true);
    try {
      var payload = await api("/api/group/spaces", json("POST", {
        title: title,
        description: t("roomDescription")
      }, { "Idempotency-Key": idempotencyKey() }));
      state.creatingSpace = false;
      await loadSpaces(payload.space.id);
      render();
    } catch (error) {
      state.error = publicError(error);
      render();
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(form) {
    var content = String(new FormData(form).get("content") || "").trim();
    if (!content && !state.pendingAttachment) return;
    setBusy(true);
    try {
      var body = {
        content: content || state.pendingAttachment.name,
        content_type: state.pendingAttachment ? "attachment" : "text",
        client_message_id: idempotencyKey(),
        source_language: state.profile && state.profile.spoken_language || state.locale,
        reply_to_id: null,
        attachment_ids: state.pendingAttachment ? [state.pendingAttachment.id] : []
      };
      await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/messages", json("POST", body, {
        "Idempotency-Key": idempotencyKey()
      }));
      state.pendingAttachment = null;
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/messages?limit=100");
      state.messages = payload.messages || [];
      render();
      var scroll = root.querySelector(".thread-scroll");
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    } catch (error) {
      notify(t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment(file) {
    if (!file || !state.space) return;
    setBusy(true);
    try {
      var safeName = String(file.name || "attachment").replace(/[^\x20-\x7E]/g, "_").slice(0, 255);
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/attachments", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": safeName
        },
        body: file
      });
      state.pendingAttachment = payload.attachment;
      notify(t("attachmentReady"));
      render();
    } catch (_error) {
      notify(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function pinMessage(button) {
    var id = button.dataset.id;
    var pinned = button.dataset.pinned === "true";
    var path = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/messages/" + encodeURIComponent(id) + "/pin";
    try {
      await api(path, { method: pinned ? "DELETE" : "POST" });
      var results = await Promise.all([
        api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/messages?limit=100"),
        api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/pins")
      ]);
      state.messages = results[0].messages || [];
      state.pins = results[1].messages || [];
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function inviteContact(button) {
    if (!state.space || !button.dataset.ref) return;
    setBusy(true);
    try {
      await api(
        "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/invitations",
        json("POST", { contact_ref: button.dataset.ref })
      );
      await loadSpace();
      notify(t("invitationSent"));
      render();
    } catch (error) {
      notify(publicError(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvitation(button) {
    if (!state.space || !button.dataset.id) return;
    try {
      await api(
        "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/invitations/" + encodeURIComponent(button.dataset.id),
        { method: "DELETE" }
      );
      await loadSpace();
      notify(t("invitationCancelled"));
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function decideInvitation(button, accept) {
    if (!button.dataset.id) return;
    try {
      var payload = await api(
        "/api/group/invitations/" + encodeURIComponent(button.dataset.id) + "/" + (accept ? "accept" : "reject"),
        { method: "POST" }
      );
      await loadSpaces(accept && payload.invitation ? payload.invitation.space_id : state.space && state.space.id);
      notify(t(accept ? "invitationAccepted" : "invitationRejected"));
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function updateMember(button, values) {
    if (!state.space || !button.dataset.id) return;
    if (values.status === "removed" && !window.confirm(t("removeMemberConfirm"))) return;
    try {
      await api(
        "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/memberships/" + encodeURIComponent(button.dataset.id),
        json("PATCH", values)
      );
      await loadSpace();
      notify(t("memberUpdated"));
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function saveProfile(form) {
    if (!state.space || !state.profile) return;
    var data = form ? new FormData(form) : null;
    if (data) {
      state.profile.spoken_language = String(data.get("spoken_language") || state.profile.spoken_language);
      state.profile.preferred_output_language = String(data.get("preferred_output_language") || state.profile.preferred_output_language);
    }
    try {
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/profile", json("PUT", {
        spoken_language: state.profile.spoken_language,
        preferred_output_language: state.profile.preferred_output_language,
        auto_translate_enabled: Boolean(state.profile.auto_translate_enabled),
        auto_read_enabled: Boolean(state.profile.auto_read_enabled),
        show_original_enabled: Boolean(state.profile.show_original_enabled)
      }));
      state.profile = payload.profile;
      notify(t("profileSavedReal"));
      await loadSpace();
      render();
      if (state.profile.auto_read_enabled) processTtsJobs();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function toggleConsent() {
    if (!state.space) return;
    var granted = !(state.consent && state.consent.status === "granted");
    try {
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/consent", json("PUT", {
        status: granted ? "granted" : "revoked",
        policy_version: POLICY_VERSION
      }));
      state.consent = payload.consent;
      notify(granted ? t("consentGranted") : t("off"));
      render();
      if (granted) window.setTimeout(translateMissingChatMessages, 0);
    } catch (error) {
      notify(publicError(error));
    }
  }

  function selectedParticipants(form) {
    return Array.from(form.querySelectorAll('input[name="participant"]:checked')).map(function (input) {
      return input.value;
    });
  }

  async function openPrejoin(kind) {
    if (!state.mediaSession) return;
    state.prejoinMediaKind = kind === "video" ? "video" : "audio";
    state.prejoinOpen = true;
    state.prejoinConfirmed = false;
    state.prejoinError = "";
    state.prejoinBusy = true;
    render();
    try {
      if (!window.GroupV3DeviceManager) throw Object.assign(new Error("device_manager_unavailable"), { code: "browser_unsupported" });
      state.prejoinDevices = await window.GroupV3DeviceManager.enumerate();
      state.prejoinAudioDeviceId = window.GroupV3DeviceManager.remembered("audioInput") || state.prejoinAudioDeviceId;
      state.prejoinVideoDeviceId = window.GroupV3DeviceManager.remembered("videoInput") || state.prejoinVideoDeviceId;
      state.prejoinOutputDeviceId = window.GroupV3DeviceManager.remembered("audioOutput") || state.prejoinOutputDeviceId;
    } catch (error) {
      state.prejoinError = error.code || "browser_unsupported";
    } finally {
      state.prejoinBusy = false;
      render();
    }
  }

  function closePrejoin(releaseStream) {
    state.prejoinOpen = false;
    state.prejoinBusy = false;
    state.prejoinError = "";
    state.prejoinConfirmed = false;
    if (prejoinMeterStop) prejoinMeterStop();
    prejoinMeterStop = null;
    if (releaseStream && window.GroupV3DeviceManager) window.GroupV3DeviceManager.stop();
    if (releaseStream) localStream = null;
  }

  async function preparePrejoin() {
    if (!state.mediaSession || !window.GroupV3DeviceManager) return;
    state.prejoinBusy = true;
    state.prejoinError = "";
    render();
    try {
      localStream = await window.GroupV3DeviceManager.acquire({
        mediaKind: state.prejoinMediaKind,
        audioEnabled: state.prejoinAudioEnabled,
        videoEnabled: state.prejoinVideoEnabled,
        audioDeviceId: state.prejoinAudioDeviceId,
        videoDeviceId: state.prejoinVideoDeviceId
      });
      state.prejoinDevices = await window.GroupV3DeviceManager.enumerate();
      var audio = localStream.getAudioTracks()[0];
      var video = localStream.getVideoTracks()[0];
      state.prejoinAudioDeviceId = audio && audio.getSettings().deviceId || state.prejoinAudioDeviceId;
      state.prejoinVideoDeviceId = video && video.getSettings().deviceId || state.prejoinVideoDeviceId;
      state.micEnabled = state.prejoinAudioEnabled;
      state.videoEnabled = state.prejoinVideoEnabled;
    } catch (error) {
      localStream = null;
      state.prejoinError = error.code || error.deviceError && error.deviceError.code || "device_error";
    } finally {
      state.prejoinBusy = false;
      render();
    }
  }

  async function confirmPrejoin() {
    if (!localStream || state.prejoinBusy) return preparePrejoin();
    state.prejoinConfirmed = true;
    state.prejoinOpen = false;
    if (prejoinMeterStop) prejoinMeterStop();
    prejoinMeterStop = null;
    render();
    try {
      await connectMedia();
    } catch (error) {
      state.prejoinOpen = true;
      state.prejoinConfirmed = false;
      state.prejoinError = error.code || "device_error";
      render();
    }
  }

  async function createMedia(form) {
    var participants = selectedParticipants(form);
    if (!participants.length) {
      notify(t("inviteRequired"));
      return;
    }
    var kind = form.dataset.kind === "video" ? "video" : "audio";
    try {
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/sessions", json("POST", {
        media_kind: kind,
        title: state.space.title,
        participant_membership_ids: participants
      }));
      state.mediaSession = payload.session;
      render();
      await openPrejoin(kind);
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function mediaAction(name) {
    if (!state.mediaSession || mediaActionInFlight) return;
    mediaActionInFlight = true;
    var base = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/sessions/" + encodeURIComponent(state.mediaSession.id);
    try {
      if (name === "join-media") {
        var joined = await api(base + "/join", { method: "POST" });
        state.mediaSession = joined.session;
        render();
        await openPrejoin(state.mediaSession.media_kind);
      } else if (name === "reject-media") {
        var rejected = await api(base + "/reject", { method: "POST" });
        state.mediaSession = rejected.session.status === "ended" ? null : rejected.session;
        render();
      } else if (name === "leave-media") {
        closePrejoin(true);
        await disconnectMedia(false);
        var left = await api(base + "/leave", { method: "POST" });
        state.mediaSession = left.session.status === "ended" ? null : left.session;
        notify(t("leaveComplete"));
        render();
      } else if (name === "end-media") {
        if (!window.confirm(t("endForAllConfirm"))) return;
        closePrejoin(true);
        await disconnectMedia(false);
        await api(base + "/end-for-all", { method: "POST" });
        state.mediaSession = null;
        notify(t("endedForAll"));
        render();
      } else if (name === "connect-media") {
        if (!state.prejoinOpen && !state.prejoinConfirmed) await openPrejoin(state.mediaSession.media_kind);
        else await connectMedia();
      }
    } catch (error) {
      notify(publicError(error));
    } finally {
      mediaActionInFlight = false;
    }
  }

  async function createRadio(form) {
    var participants = selectedParticipants(form);
    if (!participants.length) {
      notify(t("inviteRequired"));
      return;
    }
    try {
      if (window.GroupV3SafeAudio && window.GroupV3SafeAudio.chooseOutput) {
        await window.GroupV3SafeAudio.chooseOutput();
      }
      var payload = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/radio/sessions", json("POST", {
        title: state.space.title,
        participant_membership_ids: participants
      }));
      state.radioSession = payload.session;
      render();
      await connectRadio("listen");
    } catch (error) {
      notify(publicError(error));
    }
  }

  function radioBase() {
    return "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/radio/sessions/" + encodeURIComponent(state.radioSession.id);
  }

  async function joinRadio() {
    try {
      if (window.GroupV3SafeAudio && window.GroupV3SafeAudio.chooseOutput) {
        await window.GroupV3SafeAudio.chooseOutput();
      }
      var payload = await api(radioBase() + "/join", { method: "POST" });
      state.radioSession = payload.session;
      state.deviceLost = false;
      render();
      await connectRadio("listen");
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function rejectRadio() {
    try {
      await api(radioBase() + "/reject", { method: "POST" });
      state.radioSession = null;
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function startRadio() {
    if (!state.radioSession || state.floorToken) return;
    try {
      var source = state.profile.spoken_language;
      var target = state.profile.preferred_output_language;
      var result = await api(radioBase() + "/floor/acquire", json("POST", {
        source_language: source,
        target_languages: state.profile.auto_translate_enabled && target !== source ? [target] : []
      }));
      state.floorToken = result.floor_token;
      state.burst = result.burst;
      state.radioFloor = null;
      render();
      await connectRadio("talk");
      startHeartbeat();
    } catch (error) {
      if (state.floorToken) await radioDeviceLost();
      await loadRadioSession();
      render();
      notify(publicError(error));
    }
  }

  function startHeartbeat() {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(async function () {
      if (!state.floorToken || !state.radioSession) return;
      try {
        var payload = await api(radioBase() + "/floor/heartbeat", json("POST", { floor_token: state.floorToken }));
        if (payload.floor_released) {
          state.floorToken = "";
          state.burst = payload.burst;
          window.clearInterval(heartbeatTimer);
          await disconnectMedia(false);
          render();
          window.dispatchEvent(new CustomEvent("group-v3:radio-stopped", { detail: { burst_id: state.burst.id } }));
          await connectRadio("listen").catch(function () {});
        }
      } catch (_error) {
        await radioDeviceLost();
      }
    }, 10000);
  }

  async function stopRadio() {
    if (!state.floorToken) return;
    window.clearInterval(heartbeatTimer);
    if (localStream) localStream.getAudioTracks().forEach(function (track) { track.enabled = false; });
    var token = state.floorToken;
    state.radioStopping = true;
    render();
    try {
      var payload = await api(radioBase() + "/floor/stop", json("POST", { floor_token: token }));
      state.floorToken = "";
      state.radioStopping = false;
      state.radioFloor = null;
      state.burst = payload.burst;
      await disconnectMedia(false);
      render();
      window.dispatchEvent(new CustomEvent("group-v3:radio-stopped", { detail: { burst_id: state.burst.id } }));
      await connectRadio("listen");
      notify(t("floorReleasedFirst"));
    } catch (error) {
      state.radioStopping = false;
      if (state.floorToken) await radioDeviceLost();
      notify(publicError(error));
    }
  }

  async function radioDeviceLost() {
    if (!state.floorToken || !state.radioSession) {
      state.deviceLost = true;
      await disconnectMedia(false);
      render();
      return;
    }
    var token = state.floorToken;
    state.floorToken = "";
    window.clearInterval(heartbeatTimer);
    try {
      var payload = await api(radioBase() + "/floor/device-lost", json("POST", { floor_token: token }));
      state.burst = payload.burst;
    } catch (_error) {
      state.burst = { state: "device_lost" };
    }
    state.deviceLost = true;
    window.dispatchEvent(new CustomEvent("group-v3:radio-device-lost", { detail: { burst_id: state.burst && state.burst.id || "" } }));
    await disconnectMedia(false);
    render();
  }

  async function reconnectRadio() {
    state.deviceLost = false;
    state.burst = null;
    await joinRadio();
  }

  async function leaveRadio() {
    if (state.floorToken) {
      notify(t("stopBurst"));
      return;
    }
    try {
      await disconnectMedia(false);
      await api(radioBase() + "/leave", { method: "POST" });
      state.radioSession = null;
      state.radioFloor = null;
      notify(t("leaveComplete"));
      render();
    } catch (error) {
      notify(publicError(error));
    }
  }

  async function handleAction(name, button) {
    if (name === "surface") return updateSurface(button.dataset.surface);
    if (name === "select-space") return selectSpace(button.dataset.id);
    if (name === "show-create-space") {
      state.creatingSpace = true;
      render();
      var input = root.querySelector('[data-form="create-space"] input');
      if (input) input.focus();
      return;
    }
    if (name === "refresh") return refreshAll();
    if (name === "members") {
      state.memberManagerOpen = true;
      await loadMembershipManagement();
      render();
      return;
    }
    if (name === "close-members") {
      state.memberManagerOpen = false;
      render();
      return;
    }
    if (name === "invite-contact") return inviteContact(button);
    if (name === "cancel-invitation") return cancelInvitation(button);
    if (name === "accept-invitation") return decideInvitation(button, true);
    if (name === "reject-invitation") return decideInvitation(button, false);
    if (name === "toggle-member-role") return updateMember(button, { role: button.dataset.role });
    if (name === "remove-member") return updateMember(button, { status: "removed" });
    if (name === "plugin") return updateSurface("chat-translation");
    if (name === "pin-message") return pinMessage(button);
    if (name === "toggle-auto-translate") {
      state.profile.auto_translate_enabled = !state.profile.auto_translate_enabled;
      render();
      return saveProfile();
    }
    if (name === "toggle-auto-read") {
      state.profile.auto_read_enabled = !state.profile.auto_read_enabled;
      render();
      return saveProfile();
    }
    if (name === "toggle-consent") return toggleConsent();
    if (name === "prepare-prejoin" || name === "retry-prejoin") return preparePrejoin();
    if (name === "confirm-prejoin") return confirmPrejoin();
    if (name === "cancel-prejoin") {
      closePrejoin(true);
      render();
      return;
    }
    if (name === "toggle-prejoin-mic") {
      state.prejoinAudioEnabled = !state.prejoinAudioEnabled;
      if (localStream) localStream.getAudioTracks().forEach(function (track) { track.enabled = state.prejoinAudioEnabled; });
      render();
      return;
    }
    if (name === "toggle-prejoin-video") {
      state.prejoinVideoEnabled = !state.prejoinVideoEnabled;
      if (localStream) localStream.getVideoTracks().forEach(function (track) { track.enabled = state.prejoinVideoEnabled; });
      render();
      return;
    }
    if (["join-media", "reject-media", "leave-media", "end-media", "connect-media"].indexOf(name) >= 0) return mediaAction(name);
    if (name === "toggle-mic") {
      state.micEnabled = !state.micEnabled;
      if (localStream) localStream.getAudioTracks().forEach(function (track) { track.enabled = state.micEnabled; });
      render();
      return;
    }
    if (name === "toggle-video") {
      state.videoEnabled = !state.videoEnabled;
      if (localStream) localStream.getVideoTracks().forEach(function (track) { track.enabled = state.videoEnabled; });
      render();
      return;
    }
    if (name === "join-radio") return joinRadio();
    if (name === "reject-radio") return rejectRadio();
    if (name === "start-radio") return startRadio();
    if (name === "stop-radio") return stopRadio();
    if (name === "leave-radio") return leaveRadio();
    if (name === "reconnect-radio") return reconnectRadio();
  }

  async function handleForm(form) {
    if (form.dataset.form === "create-space") return createSpace(form);
    if (form.dataset.form === "send-message") return sendMessage(form);
    if (form.dataset.form === "create-media") return createMedia(form);
    if (form.dataset.form === "create-radio") return createRadio(form);
    if (form.dataset.form === "save-profile") return saveProfile(form);
  }

  async function handleChange(control) {
    if (control.dataset.change === "locale" && LANGUAGES.indexOf(control.value) >= 0) {
      state.locale = control.value;
      document.documentElement.lang = state.locale;
      render();
      return;
    }
    if (control.dataset.change === "target-language" && LANGUAGES.indexOf(control.value) >= 0) {
      state.profile.preferred_output_language = control.value;
      render();
      await saveProfile();
      return;
    }
    if (control.dataset.change === "attachment") return uploadAttachment(control.files && control.files[0]);
    if (control.dataset.change === "prejoin-audio-device") {
      state.prejoinAudioDeviceId = control.value;
      return preparePrejoin();
    }
    if (control.dataset.change === "prejoin-video-device") {
      state.prejoinVideoDeviceId = control.value;
      return preparePrejoin();
    }
    if (control.dataset.change === "prejoin-output-device") {
      state.prejoinOutputDeviceId = control.value;
      var outputs = root.querySelectorAll("[data-group-v3-media], [data-prejoin-video]");
      return Promise.all(Array.from(outputs).map(function (element) {
        return window.GroupV3DeviceManager && window.GroupV3DeviceManager.setOutput(element, control.value);
      }));
    }
  }

  var disconnecting = false;
  var currentGrantIdentity = "";

  function attachTrack(track, participantIdentity) {
    if (!track || state.deviceLost && state.surface === "radio") return;
    var kind = String(track.kind || "");
    var element = track.attach ? track.attach() : null;
    if (!element) return;
    element.autoplay = true;
    element.playsInline = true;
    element.dataset.groupV3Media = "true";
    if (kind === "video") {
      var tile = root.querySelector('[data-video-identity="' + CSS.escape(String(participantIdentity || "")) + '"]');
      if (!tile) tile = root.querySelector(".video-tile");
      if (tile) {
        element.className = "remote-media";
        tile.appendChild(element);
      }
    } else {
      var host = root.querySelector("[data-audio-host]");
      if (host) host.appendChild(element);
      var mediaTrack = track.mediaStreamTrack || track;
      if (state.profile && state.profile.auto_translate_enabled && state.consent && state.consent.status === "granted") {
        window.dispatchEvent(new CustomEvent("group-v3:remote-audio", {
          detail: {
            track: mediaTrack,
            participant_identity: String(participantIdentity || "")
          }
        }));
      }
    }
  }

  function syncMediaElements() {
    if (localStream && state.surface === "video") {
      var tile = root.querySelector('[data-video-identity="' + CSS.escape(currentGrantIdentity) + '"]') || root.querySelector(".video-tile");
      if (tile) {
        var video = document.createElement("video");
        video.className = "local-media";
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = localStream;
        tile.appendChild(video);
      }
    }
    if (!mediaRoom) return;
    mediaRoom.remoteParticipants.forEach(function (participant) {
      participant.trackPublications.forEach(function (publication) {
        if (publication.track) attachTrack(publication.track, participant.identity);
      });
    });
  }

  async function connectWithGrant(grant, publish, options) {
    options = options || {};
    var library = window.LivekitClient;
    if (!library || !library.Room || !grant || grant.provider !== "livekit-cloud" || !grant.url || !grant.token) {
      throw new Error("group_media_client_unavailable");
    }
    await disconnectMedia(false, { preserveStream: Boolean(options.preserveStream && localStream) });
    var generation = mediaGeneration;
    disconnecting = false;
    currentGrantIdentity = String(grant.participant_identity || "");
    var room = new library.Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: false
    });
    mediaRoom = room;
    room.on(library.RoomEvent.TrackSubscribed, function (track, _publication, participant) {
      if (room !== mediaRoom) return;
      attachTrack(track, participant && participant.identity);
    });
    room.on(library.RoomEvent.TrackUnsubscribed, function (track) {
      if (track && track.detach) track.detach().forEach(function (element) { element.remove(); });
    });
    if (library.RoomEvent.Reconnecting) {
      room.on(library.RoomEvent.Reconnecting, function () {
        if (room !== mediaRoom || generation !== mediaGeneration) return;
        state.mediaConnected = false;
        render();
        if (state.surface !== "radio") {
          updateMediaConnectionState("reconnecting").catch(function () {});
        }
      });
    }
    if (library.RoomEvent.Reconnected) {
      room.on(library.RoomEvent.Reconnected, function () {
        if (room !== mediaRoom || generation !== mediaGeneration) return;
        state.mediaConnected = true;
        render();
        if (state.surface !== "radio") {
          updateMediaConnectionState("connected").catch(function () {});
        }
      });
    }
    room.on(library.RoomEvent.Disconnected, function () {
      if (room !== mediaRoom || disconnecting) return;
      state.mediaConnected = false;
      if (state.surface === "radio") radioDeviceLost();
      else {
        updateMediaConnectionState("failed", "provider_disconnected").catch(function () {}).finally(function () {
          disconnectMedia(false).catch(function () {});
          state.error = t("mediaUnavailable");
          render();
        });
      }
    });
    try {
      if (publish) {
        if (!localStream) {
          if (!window.GroupV3DeviceManager) throw new Error("group_media_client_unavailable");
          localStream = await window.GroupV3DeviceManager.acquire({
            mediaKind: grant.media_kind,
            audioEnabled: state.micEnabled,
            videoEnabled: state.videoEnabled,
            audioDeviceId: state.prejoinAudioDeviceId,
            videoDeviceId: state.prejoinVideoDeviceId
          });
        }
        if (generation !== mediaGeneration) throw new Error("group_media_stale_attempt");
      }
      await room.connect(grant.url, grant.token);
      if (generation !== mediaGeneration) throw new Error("group_media_stale_attempt");
      if (publish && localStream) {
        for (var mediaTrack of localStream.getTracks()) {
          mediaTrack.addEventListener("ended", function () {
            if (state.surface === "radio" && state.floorToken) radioDeviceLost();
            else if (state.surface !== "radio" && mediaRoom === room && !disconnecting) {
              state.deviceLost = true;
              state.error = t("deviceLost");
              render();
            }
          }, { once: true });
          await room.localParticipant.publishTrack(mediaTrack, {
            source: mediaTrack.kind === "video" ? library.Track.Source.Camera : library.Track.Source.Microphone
          });
          if (generation !== mediaGeneration) throw new Error("group_media_stale_attempt");
        }
      }
      state.mediaConnected = true;
      state.micEnabled = true;
      state.videoEnabled = true;
      render();
      syncMediaElements();
      if (state.surface === "radio" && publish && localStream) {
        var audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          window.dispatchEvent(new CustomEvent("group-v3:local-radio-audio", {
            detail: { track: audioTrack, burst_id: state.burst && state.burst.id || "" }
          }));
        }
      }
    } catch (error) {
      if (generation === mediaGeneration && mediaRoom === room) await disconnectMedia(false);
      else if (localStream && generation !== mediaGeneration) {
        localStream.getTracks().forEach(function (track) { track.stop(); });
      }
      throw error;
    }
  }

  async function updateMediaConnectionState(status, failureCode) {
    if (!state.mediaSession || state.surface === "radio") return null;
    var path = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/sessions/" +
      encodeURIComponent(state.mediaSession.id) + "/connection-state";
    var payload = await api(path, json("POST", {
      status: status,
      failure_code: failureCode || ""
    }));
    if (payload.session) state.mediaSession = payload.session;
    return payload.session || null;
  }

  async function connectMedia() {
    if (!state.mediaSession) {
      notify(t("mediaPolicy"));
      return;
    }
    var participant = selfParticipant(state.mediaSession);
    if (!participant || participant.invite_status !== "joined") {
      notify(t("mediaPolicy"));
      return;
    }
    if (state.mediaSession.status !== "active" && state.mediaSession.status !== "ringing") {
      notify(t("mediaPolicy"));
      return;
    }
    if (!state.prejoinConfirmed && !localStream) {
      await openPrejoin(state.mediaSession.media_kind);
      return;
    }
    var path = "/api/group/spaces/" + encodeURIComponent(state.space.id) + "/sessions/" +
      encodeURIComponent(state.mediaSession.id) + "/media-grant";
    await updateMediaConnectionState("connecting");
    try {
      var payload = await api(path, { method: "POST" });
      await connectWithGrant(payload.grant, true, { preserveStream: Boolean(localStream) });
      await updateMediaConnectionState("connected");
      render();
    } catch (error) {
      await updateMediaConnectionState("failed", String(error && error.message || "media_connect_failed").slice(0, 80)).catch(function () {});
      throw error;
    }
  }

  async function connectRadio(mode) {
    if (!state.radioSession) return;
    var body = { mode: mode, floor_token: mode === "talk" ? state.floorToken : "" };
    var payload = await api(radioBase() + "/media-grant", json("POST", body));
    await connectWithGrant(payload.grant, mode === "talk");
  }

  async function disconnectMedia(emitEvent, options) {
    options = options || {};
    mediaGeneration += 1;
    disconnecting = true;
    var room = mediaRoom;
    mediaRoom = null;
    var stream = localStream;
    if (!options.preserveStream) localStream = null;
    state.mediaConnected = false;
    currentGrantIdentity = "";
    if (stream && !options.preserveStream) {
      if (window.GroupV3DeviceManager) window.GroupV3DeviceManager.stop();
      else stream.getTracks().forEach(function (track) { track.stop(); });
    }
    root.querySelectorAll("[data-group-v3-media], .local-media, .remote-media").forEach(function (element) {
      try {
        element.pause();
        element.srcObject = null;
      } catch (_error) {}
      element.remove();
    });
    try {
      if (room) {
        room.removeAllListeners();
        room.disconnect();
      }
    } catch (_error) {}
    if (emitEvent !== false) window.dispatchEvent(new CustomEvent("group-v3:media-disconnected"));
    disconnecting = false;
  }

  async function processTtsJobs() {
    if (!state.space || !state.profile || !state.profile.auto_read_enabled || state.deviceLost) return;
    if (!window.GroupV3SafeAudio || typeof window.GroupV3SafeAudio.playTtsJob !== "function") return;
    try {
      var claim = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/tts-jobs/claim", { method: "POST" });
      if (!claim.job) return;
      var visible = state.translations.some(function (item) { return item.id === claim.job.final_visible_event_id; });
      if (!visible) {
        var history = await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/history?limit=50");
        state.translations = history.events || [];
        render();
      }
      var status = await window.GroupV3SafeAudio.playTtsJob(claim.job);
      await api("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/tts-jobs/" +
        encodeURIComponent(claim.job.id) + "/ack", json("POST", {
          status: status === "completed" ? "completed" : status === "suppressed" ? "suppressed" : "failed",
          failure_code: status === "completed" ? "" : String(status || "safe_audio_unavailable").slice(0, 80)
        }));
    } catch (_error) {}
  }

  window.addEventListener("group:handoff-ready", function () {
    var handoff = window.GroupCommunicationHandoff && window.GroupCommunicationHandoff.consume();
    if (!handoff) {
      state.status = "FAILED";
      render();
      return;
    }
    state.context = null;
    state.surface = normalizeSurface(handoff.surface) || state.surface;
    refreshAll();
  });

  window.addEventListener("popstate", function () {
    var match = window.location.pathname.match(/^\/group\/([^/]+)$/);
    var next = "";
    try {
      next = normalizeSurface(match ? decodeURIComponent(match[1]) : "chat");
    } catch (_error) {}
    if (!next || next === state.surface) return;
    state.surface = next;
    refreshAll();
  });

  var mediaQuery = window.matchMedia("(max-width: 640px)");
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", function (event) {
      state.mobile = event.matches;
      render();
    });
  }

  root.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    if (button.classList.contains("member-manager-backdrop") && event.target.closest("[data-member-manager]")) return;
    handleAction(button.dataset.action, button);
  });

  root.addEventListener("input", function (event) {
    var memberSearch = event.target.closest("[data-media-member-search]");
    if (memberSearch) {
      var query = String(event.target.value || "").trim().toLocaleLowerCase();
      var visible = 0;
      root.querySelectorAll("[data-media-member]").forEach(function (member) {
        var haystack = String(member.dataset.memberName || member.textContent || "").toLocaleLowerCase();
        var matches = !query || haystack.indexOf(query) >= 0;
        member.hidden = !matches;
        if (matches) visible += 1;
      });
      var empty = root.querySelector("[data-media-no-results]");
      if (empty) empty.hidden = visible > 0;
      return;
    }
    if (isTextEntry(event.target)) resizeTextEntry(event.target);
  });

  root.addEventListener("keydown", function (event) {
    var editor = event.target;
    if (!editor || editor.tagName !== "TEXTAREA" || !editor.matches("[data-group-text-entry]")) return;
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    var form = editor.closest('form[data-form="send-message"]');
    if (!form) return;
    event.preventDefault();
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else handleForm(form);
  });

  root.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    handleForm(form);
  });

  root.addEventListener("change", function (event) {
    var control = event.target.closest("[data-change]");
    if (control) handleChange(control);
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function () {
      if (state.prejoinOpen) {
        if (window.GroupV3DeviceManager) window.GroupV3DeviceManager.enumerate().then(function (devices) {
          state.prejoinDevices = devices;
          render();
        }).catch(function () {});
      } else if (state.surface === "radio" && state.radioSession) radioDeviceLost();
      else if (state.mediaSession && state.mediaConnected) {
        state.deviceLost = true;
        state.error = t("deviceLost");
        render();
      }
    });
  }

  window.addEventListener("pagehide", function () {
    window.clearInterval(heartbeatTimer);
    closeGroupEvents();
    if (state.floorToken && state.radioSession && state.space) {
      window.fetch(radioBase() + "/floor/device-lost", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor_token: state.floorToken })
      }).catch(function () {});
    }
    closePrejoin(false);
    disconnectMedia(false);
  });

  window.GroupV3Runtime = Object.freeze({
    snapshot: function () {
      return {
        space_id: state.space && state.space.id || "",
        runtime_kind: state.surface === "video" ? "video" : state.surface === "radio" ? "radio" : "call",
        runtime_id: state.surface === "radio"
          ? state.burst && state.burst.id || ""
          : state.mediaSession && state.mediaSession.id || "",
        spoken_language: state.profile && state.profile.spoken_language || state.locale,
        target_language: state.profile && state.profile.preferred_output_language || "",
        auto_translate: Boolean(state.profile && state.profile.auto_translate_enabled),
        auto_read: Boolean(state.profile && state.profile.auto_read_enabled),
        consent_status: state.consent && state.consent.status || "",
        membership_id: myMembership() && myMembership().id || "",
        members: state.members.map(function (member) {
          return { id: member.id, display_name: member.display_name };
        }),
        media_participants: (state.mediaSession && state.mediaSession.participants || state.radioSession && state.radioSession.participants || []).map(function (participant) {
          return {
            membership_id: participant.membership_id,
            livekit_identity: participant.livekit_identity,
            display_name: participant.display_name
          };
        }),
        burst_id: state.burst && state.burst.id || "",
        radio_target_languages: state.burst && state.burst.target_languages || [],
        device_lost: state.deviceLost
      };
    },
    translationFinal: async function () {
      if (!state.space) return;
      var payload = await optional("/api/group/spaces/" + encodeURIComponent(state.space.id) + "/translation/history?limit=50", { events: [] });
      state.translations = payload.events || [];
      render();
      if (state.profile && state.profile.auto_read_enabled) processTtsJobs();
    }
  });

  render();
  refreshAll();
}(window, document));
