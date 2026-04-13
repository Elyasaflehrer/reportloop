"""
MCP server — exposes messaging tools via the Model Context Protocol.

Tools
-----
send_message          Send a message via any registered platform.
get_replies           Fetch unconsumed replies for a session.
list_available_platforms  Enumerate registered platforms.

The server can be used in two modes:

  In-process (default, used by LangGraph nodes):
      from question_flow.mcp_server.server import mcp
      async with Client(mcp) as client:
          await client.call_tool("send_message", {...})

  Standalone HTTP server (for external clients / other agents):
      python scripts/run_mcp.py
      # → listens on MCP_HOST:MCP_PORT with SSE transport
"""

from __future__ import annotations

import json

from fastmcp import FastMCP
from pydantic import BaseModel

from question_flow.core.logging import get_logger
from question_flow.core.store import reply_store
from question_flow.mcp_server.platforms import get_platform, list_platforms

logger = get_logger(__name__)

# ── FastMCP instance ──────────────────────────────────────────────────────────

mcp = FastMCP(
    name="QuestionFlow Messaging Server",
    instructions=(
        "Provides tools to send messages to users via configurable messaging "
        "platforms and to retrieve their replies for question-answer workflows."
    ),
)


# ── Response models ───────────────────────────────────────────────────────────


class SendMessageResult(BaseModel):
    success: bool
    message_id: str | None = None
    error: str | None = None
    platform: str
    recipient: str
    session_id: str


class ReplyItem(BaseModel):
    from_number: str
    body: str
    received_at: str   # ISO-8601


# ── Tools ─────────────────────────────────────────────────────────────────────


@mcp.tool()
async def send_message(
    platform: str,
    recipient: str,
    message: str,
    session_id: str,
) -> SendMessageResult:
    """
    Send a plain-text message to a recipient via the specified platform.

    Args:
        platform:   Messaging platform key (e.g. 'twilio').
        recipient:  Platform-specific address (phone number, user ID, …).
        message:    Message body to send.
        session_id: Workflow session ID — used to route inbound replies back.

    Returns:
        SendMessageResult with success flag, platform message_id, or error.
    """
    logger.info(
        "Tool send_message  platform=%s  recipient=%s  session=%s",
        platform, recipient, session_id,
    )
    p = get_platform(platform)
    result = await p.send_message(
        recipient=recipient, message=message, session_id=session_id
    )
    return SendMessageResult(
        success=result.success,
        message_id=result.message_id,
        error=result.error,
        platform=platform,
        recipient=recipient,
        session_id=session_id,
    )


@mcp.tool()
async def get_replies(session_id: str) -> list[ReplyItem]:
    """
    Return unconsumed (new) replies received for *session_id*.

    Each call advances an internal cursor so the same replies are never
    returned twice.  Replies arrive via the platform's inbound webhook
    (e.g. Twilio → POST /webhook/twilio on the API server).

    Args:
        session_id: The workflow session ID.

    Returns:
        List of ReplyItem objects (may be empty if no new replies).
    """
    logger.debug("Tool get_replies  session=%s", session_id)
    replies = await reply_store.get_new_replies(session_id)
    logger.debug(
        "Tool get_replies  session=%s  count=%d", session_id, len(replies)
    )
    return [
        ReplyItem(
            from_number=r.from_number,
            body=r.body,
            received_at=r.received_at.isoformat(),
        )
        for r in replies
    ]


@mcp.tool()
async def list_available_platforms() -> list[str]:
    """Return the names of all registered messaging platforms."""
    platforms = list_platforms()
    logger.debug("Tool list_available_platforms  result=%s", platforms)
    return platforms


# ── Helper used by LangGraph nodes ───────────────────────────────────────────


def parse_mcp_result(result: object) -> object:
    """
    Extract Python value from a FastMCP tool-call result.

    fastmcp >= 2.x returns a CallToolResult with a .content list.
    Older builds returned a plain list.  This helper handles both.

    CallToolResult.content is a list of TextContent / ImageContent blocks;
    each TextContent has a .text attribute holding the JSON-serialised value.
    """
    if result is None:
        return None

    # fastmcp 2.x: CallToolResult object
    content = getattr(result, "content", None)
    if content is None:
        # fallback: treat result itself as the content list
        content = result

    if not content:
        return None

    # grab first content block
    try:
        item = content[0]
    except (TypeError, IndexError):
        return None

    text = getattr(item, "text", None)
    if text is None:
        return None

    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text