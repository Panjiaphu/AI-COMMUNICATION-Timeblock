from __future__ import annotations

import io
import json
import logging

from app.telemetry.logging import JsonLogFormatter, configure_logging


def test_json_formatter_allowlists_and_redacts():
    record = logging.LogRecord(
        "guilua.communication",
        logging.INFO,
        __file__,
        10,
        (
            "authorization=Bearer sample-value "
            "session_token=sample-value reconnect_token=sample-value "
            "token=sample-value sdp=v=0 candidate=host-value"
        ),
        (),
        None,
    )
    record.result = "connection_rejected"
    record.trace_id = "trace-test"
    record.event_name = "signaling.offer"
    record.unknown_extra = "drop-me"
    record.reconnect_token = "drop-me"

    rendered = JsonLogFormatter().format(record)
    payload = json.loads(rendered)
    assert payload["logger"] == "guilua.communication"
    assert payload["result"] == "connection_rejected"
    assert payload["trace_id"] == "trace-test"
    assert payload["event_name"] == "signaling.offer"
    assert "unknown_extra" not in payload
    assert "reconnect_token" not in payload
    assert "sample-value" not in rendered
    assert "v=0" not in rendered
    assert "host-value" not in rendered
    assert rendered.count("[REDACTED]") >= 5


def test_configure_logging_emits_json_and_disables_access_logs():
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
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
                "token": "drop-me",
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
        root.handlers[:] = handlers
        root.setLevel(level)
        logging.getLogger("uvicorn.access").disabled = False
        logging.getLogger("gunicorn.access").disabled = False


def test_gunicorn_logger_formats_master_lines(monkeypatch):
    from app.telemetry.gunicorn import GunicornLogger, JsonGunicornLogger

    stream = io.StringIO()
    error_log = logging.Logger("gunicorn.error", logging.INFO)
    access_log = logging.Logger("gunicorn.access", logging.INFO)
    error_handler = logging.StreamHandler(stream)
    access_handler = logging.StreamHandler(io.StringIO())
    error_log.addHandler(error_handler)
    access_log.addHandler(access_handler)

    logger = object.__new__(JsonGunicornLogger)
    logger.error_log = error_log
    logger.access_log = access_log
    monkeypatch.setattr(GunicornLogger, "setup", lambda self, cfg: None)
    logger.setup(None)
    error_log.info("Starting gunicorn")

    payload = json.loads(stream.getvalue())
    assert payload["logger"] == "gunicorn.error"
    assert payload["message"] == "Starting gunicorn"
    assert isinstance(error_handler.formatter, JsonLogFormatter)
    assert isinstance(access_handler.formatter, JsonLogFormatter)
