"""
Structured logging setup using Python's built-in logging module.
Produces JSON in production, human-readable output in development.
Every log entry includes the file path and line number of the caller.
"""

import json
import logging
import sys

from mcp_server.core.config import settings


# ── Formatters ────────────────────────────────────────────────────────────────

class JSONFormatter(logging.Formatter):
    """JSON formatter for production — one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":     record.levelname,
            "filename":  record.filename,
            "lineno":    record.lineno,
            "func":      record.funcName,
            "logger":    record.name,
            "message":   record.getMessage(),
            **({"exc_info": self.formatException(record.exc_info)}
               if record.exc_info else {}),
        })


DEV_FORMAT = "%(asctime)s - %(filename)s:%(lineno)d - %(levelname)s - %(message)s"


# ── Setup ─────────────────────────────────────────────────────────────────────

def setup_logging() -> None:
    """Configure logging — call once at application startup."""

    handler = logging.StreamHandler(sys.stdout)

    if settings.is_production:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(logging.Formatter(DEV_FORMAT))

    logging.basicConfig(
        level=logging.DEBUG,
        handlers=[handler],
        force=True,   # override any previously set handlers
    )


def get_logger(name: str) -> logging.Logger:
    """Return a named logger bound to the given component."""
    return logging.getLogger(name)