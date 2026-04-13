"""
Entry-point: run the MCP server as a standalone HTTP/SSE service.

    python scripts/run_mcp.py

The MCP server exposes the same tools (send_message, get_replies,
list_available_platforms) to any external MCP client — e.g. another
LangGraph agent running in a separate process.

Override host/port via environment variables or .env:
    MCP_HOST=0.0.0.0  MCP_PORT=8001

Note: when the API server and the LangGraph agent run in the same process
(the default), you don't need this script — the agent calls the MCP tools
in-process via  `async with Client(mcp) as client`.  Use this script only
when you want to expose the messaging tools to external consumers.
"""

from question_flow.core.config import settings
from question_flow.core.logging import get_logger
from question_flow.mcp_server.server import mcp

logger = get_logger(__name__)

if __name__ == "__main__":
    logger.info(
        "Starting MCP server  host=%s  port=%d",
        settings.mcp_host,
        settings.mcp_port,
    )
    mcp.run(
        transport="streamable-http",
        host=settings.mcp_host,
        port=settings.mcp_port,
    )