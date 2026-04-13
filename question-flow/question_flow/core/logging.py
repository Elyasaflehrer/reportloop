"""
Logger factory.

Every log line includes the source file name and line number so issues
can be located instantly without a debugger:

    2025-01-15 12:34:56 | DEBUG    | nodes.py:87  | agent.nodes | Waiting for replies…
"""

import logging
import sys
from functools import lru_cache


_FORMAT = (
    "%(asctime)s | %(levelname)-8s | %(filename)s:%(lineno)d "
    "| %(name)s | %(message)s"
)
_DATEFMT = "%Y-%m-%d %H:%M:%S"


def _build_formatter() -> logging.Formatter:
    return logging.Formatter(fmt=_FORMAT, datefmt=_DATEFMT)


def _configure_root_logger(log_level: str, log_file: str) -> None:
    """
    Attach a console handler and a rotating file handler to the root logger.
    Called once at startup; subsequent calls to get_logger() reuse the config.
    """
    root = logging.getLogger()
    if root.handlers:
        return  # already configured

    formatter = _build_formatter()
    level = getattr(logging, log_level.upper(), logging.DEBUG)

    # Console
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    # File
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    root.setLevel(level)


@lru_cache(maxsize=None)
def get_logger(name: str) -> logging.Logger:
    """
    Return a named logger.  The first call also wires up root-level handlers
    so every module that calls get_logger() benefits from the same format.

    Usage:
        from question_flow.core.logging import get_logger
        logger = get_logger(__name__)
    """
    # Lazy-import to avoid circular deps at module load time
    from question_flow.core.config import settings  # noqa: PLC0415

    _configure_root_logger(settings.log_level, settings.log_file)
    return logging.getLogger(name)