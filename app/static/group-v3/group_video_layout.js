(function installGroupVideoLayout(window, document) {
  "use strict";

  var activeSpeakerIdentity = "";
  var pendingSpeakerIdentity = "";
  var speakerTimer = 0;
  var focusedIdentity = "";
  var hiddenIdentities = new Set();

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
    focusedIdentity = String(identity || "");
    return setActiveSpeaker(focusedIdentity);
  }

  function clearFocus() {
    focusedIdentity = "";
    window.dispatchEvent(new CustomEvent("group-video-layout:change", { detail: snapshot() }));
    return snapshot();
  }

  function hide(identity) {
    var value = String(identity || "");
    if (value) hiddenIdentities.add(value);
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
    return focusedIdentity || activeSpeakerIdentity || (list[0] && String(list[0].livekit_identity || list[0].id || "")) || "";
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
    var current = snapshot();
    document.querySelectorAll(".video-tile[data-video-identity]").forEach(function (tile) {
      var identity = String(tile.dataset.videoIdentity || "");
      var hidden = current.hiddenIdentities.indexOf(identity) >= 0;
      tile.classList.toggle("is-presentation-hidden", hidden);
      tile.classList.toggle("is-speaking", Boolean(current.activeSpeakerIdentity && identity === current.activeSpeakerIdentity));
      tile.classList.toggle("is-featured", Boolean((current.focusedIdentity || current.activeSpeakerIdentity) && identity === (current.focusedIdentity || current.activeSpeakerIdentity)));
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
}(window, document));
