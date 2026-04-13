"""
Inbound webhook routes.

Twilio webhook
--------------
Twilio posts to POST /webhook/twilio whenever an SMS is received on any
of your Twilio numbers.  Configure the webhook URL in the Twilio Console:

    Messaging → Phone Numbers → <your number> → Messaging Configuration
    Webhook URL: https://<your-domain>/webhook/twilio  (HTTP POST)

The handler:
  1. Extracts From / Body from the form-encoded payload.
  2. Looks up the active session for that phone number.
  3. Stores the reply in the shared ReplyStore (polled by the workflow).
  4. Returns a TwiML <Response/> (empty = no auto-reply).

Future platforms
----------------
Add a new route (e.g. /webhook/whatsapp) that parses the platform-specific
payload and calls reply_store.add_reply() with the same interface.
"""

from __future__ import annotations

from fastapi import APIRouter, Form, Response
from fastapi.responses import PlainTextResponse

from question_flow.core.logging import get_logger
from question_flow.core.store import reply_store, session_store

logger = get_logger(__name__)

router = APIRouter(tags=["webhooks"])

# Minimal TwiML response — tells Twilio "message received, no reply needed"
_TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


async def _handle_twilio_sms(From: str, Body: str, To: str | None, MessageSid: str | None) -> PlainTextResponse:
    """Shared handler for all Twilio inbound SMS routes."""
    logger.info(
        "Twilio inbound  from=%s  to=%s  sid=%s  body=%r",
        From, To, MessageSid, Body[:80],
    )

    session = await session_store.get_by_phone(From)

    if session is None:
        logger.warning(
            "Twilio inbound  from=%s  no active session found — reply discarded", From
        )
        return PlainTextResponse(_TWIML_EMPTY, media_type="application/xml")

    if session.status not in ("in_progress", "pending"):
        logger.info(
            "Twilio inbound  from=%s  session=%s  status=%s — session not active",
            From, session.session_id, session.status,
        )
        return PlainTextResponse(_TWIML_EMPTY, media_type="application/xml")

    await reply_store.add_reply(
        session_id=session.session_id,
        from_number=From,
        body=Body,
    )
    logger.info("Reply stored  session=%s  from=%s", session.session_id, From)
    return PlainTextResponse(_TWIML_EMPTY, media_type="application/xml")


# ── Routes — register every path Twilio might POST to ────────────────────────

@router.post(
    "/sms/incoming",
    response_class=PlainTextResponse,
    summary="Twilio inbound SMS — /sms/incoming",
)
async def twilio_sms_incoming(
    From: str = Form(..., alias="From"),
    Body: str = Form(..., alias="Body"),
    To: str = Form(None, alias="To"),
    MessageSid: str = Form(None, alias="MessageSid"),
) -> PlainTextResponse:
    logger.info(
        "Twilio inbound  from=%s  to=%s  sid=%s  body=%r",
        From, To, MessageSid, Body[:80],
    )
    return await _handle_twilio_sms(From, Body, To, MessageSid)


@router.post(
    "/webhook/twilio",
    response_class=PlainTextResponse,
    summary="Twilio inbound SMS — /webhook/twilio",
)
async def twilio_webhook(
    From: str = Form(..., alias="From"),
    Body: str = Form(..., alias="Body"),
    To: str = Form(None, alias="To"),
    MessageSid: str = Form(None, alias="MessageSid"),
) -> PlainTextResponse:
    return await _handle_twilio_sms(From, Body, To, MessageSid)