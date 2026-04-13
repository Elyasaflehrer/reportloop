"""
Platform registry.

Adding a new platform requires only two steps:
  1. Create the platform class (subclass MessagingPlatform).
  2. Call register_platform() here (or at app startup).

The MCP tools in server.py call get_platform() by name at runtime, so
every registered platform is automatically available to the workflow.
"""

from __future__ import annotations

from question_flow.core.logging import get_logger
from question_flow.mcp_server.platforms.base import MessagingPlatform, SendResult
from question_flow.mcp_server.platforms.twilio_platform import TwilioPlatform

logger = get_logger(__name__)

_REGISTRY: dict[str, MessagingPlatform] = {}


def register_platform(platform: MessagingPlatform) -> None:
    """Register (or replace) a messaging platform."""
    _REGISTRY[platform.name] = platform
    logger.info("Platform registered: %s", platform.name)


def get_platform(name: str) -> MessagingPlatform:
    """Return the platform with *name*, raising ValueError if unknown."""
    platform = _REGISTRY.get(name)
    if platform is None:
        available = list(_REGISTRY)
        raise ValueError(
            f"Unknown platform {name!r}.  Available: {available}"
        )
    return platform


def list_platforms() -> list[str]:
    return list(_REGISTRY)


# ── Built-in platform registrations ──────────────────────────────────────────
# Add future platforms (WhatsApp, Telegram, …) below this line.

register_platform(TwilioPlatform())

__all__ = [
    "MessagingPlatform",
    "SendResult",
    "register_platform",
    "get_platform",
    "list_platforms",
]