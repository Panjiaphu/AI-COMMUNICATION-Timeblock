from __future__ import annotations

import io
import json
import logging

from app.telemetry.logging import JsonLogFormatter, configure_logging


def test_json_formatter_allowlists_fields_and_redacts_secrets():
    record = logging.LogRecord(
        name="guilua.communication",
        level=logging.INFO,
        pathname=__file__,
        lineno=10,
        msg="authorization=Bearer top-secret token=hidden sdp=v=0 candidate=host-secret",
        args=(),
        exc_info=None,
    )
    record.result = "connection_rejected"
    record.trace_id = "trace-test"
    record.event_name = "signaling.offer"
    record.unknown_extra = "must-not-appear"
    record.reconnect_token = "must-not-appear"

    rendered = JsonLogFormatter().format(record)
    payload = json.loads(rendered)

    assert payload["logger"] == "guilua.communication"
    assert payload["result"] == "connection_rejected"
    assert payload["trace_id"] == "trace-test"
    assert payload["event_name"] == "signaling.offer"
    assert "unknown_extra" not in payload
    assert "reconnect_token" not in payload
    assert "top-secret" not in rendered
    assert "hidden" not in rendered
    assert "v=0" not in rendered
    assert "host-secret" not in rendered
    assert rendered.count("[REDACTED]") >= 3


def test_configure_logging_emits_json_and_disables_access_query_logs():
    root = logging.getLogger()
    previous_handlers = root.handlers[:]
    previous_level = root.level
    stream = io.StringIO()
    try:
        configure_logging(stream=stream)
        logging.getLogger("guilua.communication").info(
            "communication_runtime",
            extra={
                "result": "participant_joined",
                "session_id": "synthetic-session",
                "participant_id": "participant-a",
                "duration_ms": 12.5,
                "token": "never-serialize",
            },
        )
        payload = json.loads(stream.getvalue())
        assert payload["message"] == "communication_runtime"
        assert payload["session_id"] == "synthetic-session"
        assert payload["participant_id"] == "participant-a"
        assert payload["duration_ms"] == 12.5
        assert "token" not in payload
        assert logging.getLogger("uvicorn.access").disabled is True
        assert logging.getLogger("gunicorn.access").disabled is True
    finally:
        root.handlers[:] = previous_handlers
        root.setLevel(previous_level)
        logging.getLogger("uvicorn.access").disabled = False
        logging.getLogger("gunicorn.access").disabled = False
