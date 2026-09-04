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
