from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_group_mobile_viewport_adapter_is_the_only_group_viewport_owner():
    template = (ROOT / "app/templates/group_communication_v3.html").read_text(encoding="utf-8")
    adapter = (
        ROOT / "app/static/group-v3/group_mobile_viewport_contract_v1.js"
    ).read_text(encoding="utf-8")
    contract = (
        ROOT / "app/static/group-v3/group_mobile_nav_pwa_contract_v1.css"
    ).read_text(encoding="utf-8")

    assert "group_mobile_nav_pwa_contract_v1.css?v=20260903-nav-pwa-1" in template
    assert "group_mobile_viewport_contract_v1.js?v=20260903-nav-pwa-1" in template
    assert "visualViewport" in adapter
    assert "--group-visual-viewport-height" in adapter
    assert "--group-visual-viewport-offset-top" in adapter
    assert "--group-visual-viewport-bottom" in adapter
    assert "group-keyboard-open" in adapter
    assert "group-pwa-standalone" in adapter
    assert "orientationchange" in adapter
    assert "pageshow" in adapter
    assert "visibilitychange" in adapter
    assert "position: fixed" in contract
    assert "inset: auto 0 0" in contract
    assert "env(safe-area-inset-bottom" in contract
    assert "100vh !important" in contract
    assert "display: none" in contract
    assert "scrollIntoView" not in adapter
    assert "window.scrollTo" not in adapter


def test_direct_communication_template_does_not_load_group_viewport_adapter():
    direct_template = (ROOT / "app/templates/communication.html").read_text(
        encoding="utf-8"
    )
    assert "group_mobile_viewport_contract_v1.js" not in direct_template
    assert "group_mobile_nav_pwa_contract_v1.css" not in direct_template
