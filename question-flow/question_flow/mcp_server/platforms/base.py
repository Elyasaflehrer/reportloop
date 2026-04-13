"""
Abstract base class for messaging platforms.

To add a new platform (e.g. WhatsApp, Telegram):
  1. Create a new file  mcp_server/platforms/whatsapp_platform.py
  2. Subclass MessagingPlatform and implement send_message() + health_check()
  3. Register it in mcp_server/platforms/__init__.py:
       register_platform(WhatsAppPlatform())
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SendResult:
    """Result returned by every platform after a send attempt."""

    success: bool
    message_id: Optional[str] = None   # platform-specific message/SID
    error: Optional[str] = None         # human-readable error if success=False


class MessagingPlatform(ABC):
    """
    Common interface every messaging platform must implement.

    All methods are async so platforms that call external HTTP APIs
    (Twilio, WhatsApp Business API, etc.) can do so without blocking.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Lowercase platform identifier used as the registry key, e.g. 'twilio'."""

    @abstractmethod
    async def send_message(
        self,
        recipient: str,
        message: str,
        session_id: str,
    ) -> SendResult:
        """
        Send *message* to *recipient*.

        Args:
            recipient:  Platform-specific address (phone number, user ID, …).
            message:    Plain-text message body.
            session_id: Workflow session for tracing / logging purposes.

        Returns:
            SendResult indicating success or failure.
        """

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Return True when the platform credentials are valid and reachable.
        Used by the MCP server's health endpoint.
        """