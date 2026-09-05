(function installGroupVideoLayout(window, document) {
  "use strict";

  var activeSpeakerIdentity = "";
  var pendingSpeakerIdentity = "";
  var speakerTimer = 0;
  var focusedIdentity = "";
  var hiddenIdentities = new Set();
  var runtimeKey = "";

  function setActiveSpeaker(identity) {
    pendingSpeakerIdentity = String(identity || "");
    window.clearTimeout(speakerTimer);
    speakerTimer = window.setTimeout(function () {
      speakerTimer = 0;
      activeSpeakerIdentity = pendingSpeakerIdentity;
      window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    }, 180);
    return snapshot();
  }

  function focus(identity) {
    focusedIdentity = focusedIdentity === String(identity || "") ? "" : String(identity || "");
    window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    return snapshot();
  }

  function clearFocus() {
    focusedIdentity = "";
    window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    return snapshot();
  }

  function hide(identity) {
    var value = String(identity || "");
    if (value) {
      hiddenIdentities.add(value);
      if (focusedIdentity === value) focusedIdentity = "";
    }
    window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    return snapshot();
  }

  function restore(identity) {
    if (identity) hiddenIdentities.delete(String(identity));
    else hiddenIdentities.clear();
    window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    return snapshot();
  }

  function presentationIdentity(participants) {
    var list = (participants || []).filter(function (item) { return !hiddenIdentities.has(String(item.livekit_identity || item.id || "")); });
    var focused = focusedIdentity && list.some(function (item) { return String(item.livekit_identity || item.id || "") === focusedIdentity; }) ? focusedIdentity : "";
    var active = activeSpeakerIdentity && list.some(function (item) { return String(item.livekit_identity || item.id || "") === activeSpeakerIdentity; }) ? activeSpeakerIdentity : "";
    return focused || active || (list[0] && String(list[0].livekit_identity || list[0].id || "")) || "";
  }

  function layoutClass(count) {
    var value = Math.max(0, Number(count) || 0);
    if (value <= 1) return "count-1";
    if (value === 2) return "count-2";
    if (value <= 4) return "count-" + value;
    if (value <= 6) return "count-" + value;
    if (value <= 10) return "count-" + value;
    return "count-10-plus";
  }

  function snapshot() {
    return {
      activeSpeakerIdentity: activeSpeakerIdentity,
      focusedIdentity: focusedIdentity,
      hiddenIdentities: Array.from(hiddenIdentities)
    };
  }

  function applyDom() {
    var native = document.querySelector(".native-app");
    var key = native && native.dataset.runtimeKey || "";
    if (key !== runtimeKey) {
      runtimeKey = key;
      activeSpeakerIdentity = pendingSpeakerIdentity = focusedIdentity = "";
      hiddenIdentities.clear();
      window.clearTimeout(speakerTimer);
    }
    var current = snapshot();
    var visible = Array.from(document.querySelectorAll(".video-tile[data-video-identity]")).filter(function (tile) {
      return current.hiddenIdentities.indexOf(tile.dataset.videoIdentity) < 0;
    });
    var preferred = current.focusedIdentity || current.activeSpeakerIdentity;
    var featured = visible.find(function (tile) { return tile.dataset.videoIdentity === preferred; }) || visible[0];
    document.querySelectorAll(".video-grid").forEach(function (grid) {
      Array.from(grid.classList).filter(function (name) { return /^count-/.test(name); }).forEach(function (name) { grid.classList.remove(name); });
      grid.classList.add(layoutClass(visible.length));
      grid.classList.toggle("has-explicit-focus", Boolean(current.focusedIdentity && featured));
    });
    document.querySelectorAll(".video-tile[data-video-identity]").forEach(function (tile) {
      var identity = String(tile.dataset.videoIdentity || "");
      var hidden = current.hiddenIdentities.indexOf(identity) >= 0;
      tile.classList.toggle("is-presentation-hidden", hidden);
      tile.classList.toggle("is-speaking", Boolean(current.activeSpeakerIdentity && identity === current.activeSpeakerIdentity));
      tile.classList.toggle("is-featured", tile === featured);
    });
  }

  window.GroupV3VideoLayout = Object.freeze({
    setActiveSpeaker: setActiveSpeaker,
    focus: focus,
    clearFocus: clearFocus,
    hide: hide,
    restore: restore,
    presentationIdentity: presentationIdentity,
    layoutClass: layoutClass,
    snapshot: snapshot
  });
  window.addEventListener("group-video-layout:change", applyDom);
  window.addEventListener("group-v3:rendered", applyDom);
  window.addEventListener("group-workspace:change", applyDom);
}(window, document));
