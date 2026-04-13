"""
Twilio SMS platform implementation.

Inbound replies are NOT handled here — they arrive via the Twilio webhook
registered on the API server (api/routes/webhooks.py) and are written
directly to the shared ReplyStore.
"""

from __future__ import annotations

import asyncio
from functools import cached_property

from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client as TwilioClient

from question_flow.core.config import settings
from question_flow.core.logging import get_logger
from question_flow.mcp_server.platforms.base import MessagingPlatform, SendResult

logger = get_logger(__name__)


class TwilioPlatform(MessagingPlatform):
    """
    Sends outbound SMS messages via the Twilio Messaging API.

    The underlying Twilio SDK is synchronous; calls are dispatched to a
    thread-pool executor so they never block the asyncio event loop.
    """

    @property
    def name(self) -> str:
        return "twilio"

    @cached_property
    def _client(self) -> TwilioClient:
        return TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token)

    async def send_message(
        self,
        recipient: str,
        message: str,
        session_id: str,
    ) -> SendResult:
        logger.debug(
            "Twilio send  recipient=%s  session=%s  chars=%d",
            recipient, session_id, len(message),
        )
        loop = asyncio.get_running_loop()
        try:
            msg = await loop.run_in_executor(
                None,
                lambda: self._client.messages.create(
                    body=message,
                    from_=settings.twilio_from_number,
                    to=recipient,
                ),
            )
            logger.info(
                "Twilio SMS sent  sid=%s  recipient=%s  session=%s",
                msg.sid, recipient, session_id,
            )
            return SendResult(success=True, message_id=msg.sid)

        except TwilioRestException as exc:
            logger.error(
                "Twilio send failed  recipient=%s  session=%s  code=%s  msg=%s",
                recipient, session_id, exc.code, exc.msg,
            )
            return SendResult(success=False, error=f"[{exc.code}] {exc.msg}")

    async def health_check(self) -> bool:
        loop = asyncio.get_running_loop()
        try:
            account = await loop.run_in_executor(
                None,
                lambda: self._client.api.accounts(
                    settings.twilio_account_sid
                ).fetch(),
            )
            healthy = account.status == "active"
            logger.debug("Twilio health_check  status=%s", account.status)
            return healthy
        except TwilioRestException as exc:
            logger.warning("Twilio health_check failed: %s", exc)
            return False