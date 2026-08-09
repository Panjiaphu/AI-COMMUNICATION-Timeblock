from __future__ import annotations

try:
    from gunicorn.glogging import Logger as GunicornLogger
except (ImportError, ModuleNotFoundError):  # pragma: no cover - Windows development fallback
    class GunicornLogger:
        """Small import-time fallback for development environments without Gunicorn."""

        def setup(self, cfg) -> None:
            return None

from app.telemetry.logging import JsonLogFormatter


class JsonGunicornLogger(GunicornLogger):
    """Apply the runtime JSON formatter to Gunicorn master and access handlers."""

    def setup(self, cfg) -> None:
        super().setup(cfg)
        formatter = JsonLogFormatter()
        configured_handlers: set[int] = set()
        for logger in (self.error_log, self.access_log):
            for handler in logger.handlers:
                handler_id = id(handler)
                if handler_id in configured_handlers:
                    continue
                handler.setFormatter(formatter)
                configured_handlers.add(handler_id)
