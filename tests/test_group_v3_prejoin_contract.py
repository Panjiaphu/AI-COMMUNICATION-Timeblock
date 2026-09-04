from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_group_v3_prejoin_is_explicit_and_device_coordinator_isolated():
    template = (ROOT / "app/templates/group_communication_v3.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app/static/group-v3/group_v3_app.js").read_text(encoding="utf-8")
    manager_js = (ROOT / "app/static/group-v3/group_device_manager.js").read_text(encoding="utf-8")
    runtime_css = (ROOT / "app/static/group-v3/group_v3_runtime.css").read_text(encoding="utf-8")

    assert "group_device_manager.js?v=20260904-prejoin-1" in template
    assert "prejoinOpen" in app_js
    assert 'action("prepare-prejoin"' in app_js
    assert 'action("confirm-prejoin"' in app_js
    assert "getUserMedia" not in app_js.split("async function connectWithGrant", 1)[0]
    assert "preserveStream" in app_js
    assert "permission_denied" in manager_js
    assert "device_not_found" in manager_js
    assert "device_busy" in manager_js
    assert "setSinkId" in manager_js
    assert "AudioContext" in manager_js
    assert ".prejoin-backdrop" in runtime_css
    assert "@media (max-width: 640px)" in runtime_css


def test_group_v3_prejoin_never_persists_handoff_or_media_secrets():
    manager_js = (ROOT / "app/static/group-v3/group_device_manager.js").read_text(encoding="utf-8")
    assert "localStorage" not in manager_js
    assert "sessionStorage" not in manager_js
    assert "token" not in manager_js.lower()


def test_group_v3_media_reconnect_is_bounded_and_cleanup_cancels_stale_work():
    app_js = (ROOT / "app/static/group-v3/group_v3_app.js").read_text(encoding="utf-8")
    assert "mediaReconnectAttempts >= 3" in app_js
    assert "Math.pow(2, attempt)" in app_js
    assert "clearMediaReconnect" in app_js
    assert "keepReconnect" in app_js
    assert "devicechange" in app_js
    assert "beforeunload" in app_js or "pagehide" in app_js
    assert "group_media_stale_attempt" in app_js


def test_group_v3_incoming_ringtone_is_gesture_gated_and_single_tab_coordinated():
    template = (ROOT / "app/templates/group_communication_v3.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app/static/group-v3/group_v3_app.js").read_text(encoding="utf-8")
    ringtone_js = (ROOT / "app/static/group-v3/group_incoming_ringtone.js").read_text(encoding="utf-8")
    assert "group_incoming_ringtone.js?v=20260904-ringtone-1" in template
    assert "syncIncomingRingtone" in app_js
    assert "GroupV3IncomingRingtone.arm" in app_js
    assert "BroadcastChannel" in ringtone_js
    assert "AudioContext" in ringtone_js
    assert "getUserMedia" not in ringtone_js
    assert "localStorage" not in ringtone_js


def test_group_v3_attachment_viewer_has_authenticated_inline_media_and_mobile_exit():
    router = (ROOT / "app/group_v3/router.py").read_text(encoding="utf-8")
    service = (ROOT / "app/group_v3/service.py").read_text(encoding="utf-8")
    app_js = (ROOT / "app/static/group-v3/group_v3_app.js").read_text(encoding="utf-8")
    runtime_css = (ROOT / "app/static/group-v3/group_v3_runtime.css").read_text(encoding="utf-8")
    assert "/attachments/{attachment_id}/inline" in router
    assert '"Content-Disposition": f"inline;' in router
    assert "inline_media_not_supported" in router
    assert '"inline_url"' in service and '"is_image"' in service
    assert "attachmentViewer" in app_js
    assert 'data-action=\"close-attachment\"' in app_js
    assert ".attachment-viewer-backdrop" in runtime_css
    assert ".attachment-viewer-download" in runtime_css
