from app.bff.session_store import SessionStore
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def test_session_store_never_exposes_timeblock_token_in_browser_record():
    store = SessionStore(session_ttl_seconds=3600, pending_ttl_seconds=120)
    session = store.create_session(
        timeblock_token="timeblock-secret-token",
        principal={"id": "1", "display_name": "Member"},
        scope=["identity.read"],
        expires_at="2099-01-01T00:00:00+00:00",
    )
    assert session.session_id != session.timeblock_token
    assert store.get(session.session_id).timeblock_token == "timeblock-secret-token"


def test_production_mutations_require_same_origin():
    settings = Settings(
        app_env="production",
        debug=False,
        secret_key="production-secret-key-with-at-least-32-bytes",
        public_base_url="https://guilua.onrender.com",
        allowed_websocket_origins="https://guilua.onrender.com",
        allowed_timeblock_handoff_origins="https://timeblock-commercial-pro.onrender.com",
        allow_missing_bff_origin=False,
    )
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/session/logout")
    assert response.status_code == 403
    assert response.json()["detail"] == "origin_not_allowed"
