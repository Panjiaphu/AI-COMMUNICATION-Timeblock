from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone
from typing import IO, Any

ALLOWED_RUNTIME_FIELDS = (
    "result",
    "trace_id",
    "session_id",
    "room_id",
    "workspace_id",
    "participant_id",
    "connection_id",
    "event_name",
    "event_version",
    "error_code",
    "deployment_version",
    "duration_ms",
)

_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(authorization|api[_-]?key|reconnect[_-]?token|session[_-]?token|token|password|cookie)"
    r"\s*[:=]\s*(?:bearer\s+)?[^\s,;]+"
)
_SIGNALING_ASSIGNMENT = re.compile(r"(?i)\b(sdp|candidate)\s*[:=]\s*[^\r\n,;]+")


def _sanitize_text(value: str, *, limit: int = 2048) -> str:
    sanitized = _SECRET_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
    sanitized = _SIGNALING_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[REDACTED]", sanitized)
    return sanitized[:limit]


def _safe_scalar(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return _sanitize_text(value, limit=512)
    return None


class JsonLogFormatter(logging.Formatter):
    """Emit one allowlisted JSON object per log line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": _sanitize_text(record.getMessage()),
        }
        for field_name in ALLOWED_RUNTIME_FIELDS:
            if not hasattr(record, field_name):
                continue
            safe_value = _safe_scalar(getattr(record, field_name))
            if safe_value is not None:
                payload[field_name] = safe_value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: int = logging.INFO, stream: IO[str] | None = None) -> None:
    """Configure application, Gunicorn and Uvicorn logs without access-query leakage."""

    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    for logger_name in ("uvicorn", "uvicorn.error", "gunicorn.error"):
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True

    # Access logs include the raw request target and can expose WebSocket query tokens.
    for logger_name in ("uvicorn.access", "gunicorn.access"):
        logging.getLogger(logger_name).disabled = True
