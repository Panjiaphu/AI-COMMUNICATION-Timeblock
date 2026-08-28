from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_group_livekit_client_is_pinned_scoped_and_memory_only():
    template = (ROOT / "app/templates/communication.html").read_text(encoding="utf-8")
    script = (ROOT / "app/static/group-ui/livekit_group_session.js").read_text(encoding="utf-8")
    handoff = (ROOT / "app/static/group-ui/group_handoff.js").read_text(encoding="utf-8")

    assert "livekit-client@2.21.0" in template
    assert "integrity=\"sha384-" in template
    assert "crossorigin=\"anonymous\"" in template
    assert "livekit_group_session.js" in template
    assert "navigator.mediaDevices.getUserMedia" in script
    assert "new library.Room" in script
    assert "adaptiveStream: true" in script
    assert "dynacast: true" in script
    assert "disconnectOnPageLeave: false" in script
    assert "token_ttl_seconds: 300" in script
    assert "max_participants: 8" in script
    assert '"media/session"' in script
    assert '"reject"' in script
    assert "localStorage" not in script
    assert "sessionStorage" not in script
    assert "session_token" not in script
    assert "mode: payload.mode" in handoff
