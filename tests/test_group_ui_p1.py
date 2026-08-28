from __future__ import annotations

from pathlib import Path

from app.core.communication_i18n import communication_copy


ROOT = Path(__file__).resolve().parents[1]


def test_group_ui_templates_are_mounted_without_mixing_direct_runtime():
    template = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    script = (ROOT / "app/static/group-ui/group_ui.js").read_text(encoding="utf-8")
    styles = (ROOT / "app/static/group-ui.css").read_text(encoding="utf-8")

    for include in (
        'include "group_call_stage.html"',
        'include "group_radio_panel.html"',
        'include "group_translation_panel.html"',
        'include "group_translation_preferences.html"',
    ):
        assert include in template
    assert "/static/group-ui/group_ui.js" in template
    assert ".group-ui-grid" in styles
    assert "getUserMedia" not in script
    assert "LiveKit" not in script
    assert "speechSynthesis" not in script
    assert "fetch(" not in script


def test_group_copy_has_vi_en_zh_tw_parity():
    required = {
        "group_title",
        "group_call",
        "group_radio",
        "group_ui_only",
        "group_join",
        "group_reject",
        "group_start_talking",
        "group_stop_commit",
        "group_leave",
        "group_translation_title",
        "group_preferences_title",
        "group_preferences_saved",
        "group_call_leave",
        "group_call_joining",
        "group_call_connected",
        "group_call_reconnecting",
        "group_call_failed",
    }
    copies = {locale: communication_copy(locale) for locale in ("vi", "en", "zh-TW")}
    for locale, copy in copies.items():
        assert required <= set(copy), locale
        assert all(str(copy[key]).strip() and copy[key] != key for key in required)
