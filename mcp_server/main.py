"""
MCP Server entry point.

Run:
    uv run python -m mcp_server.main
"""

from fastmcp import FastMCP

from mcp_server.core.config import settings
from mcp_server.core.log import get_logger, setup_logging
from mcp_server.tools.questions import clean_suspicious_signs, generate_questions

setup_logging()
logger = get_logger(__name__)

# ── Server ────────────────────────────────────────────────────────────────────

mcp = FastMCP(
    name="reportloop",
    instructions="Tool layer for the reportloop AI graph.",
)

# ── Register tools ─────────────────────────────────────────────────────────────

mcp.add_tool(generate_questions)
mcp.add_tool(clean_suspicious_signs)

logger.info("MCP server ready", host=settings.mcp_server_host, port=settings.mcp_server_port)

# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host=settings.mcp_server_host,
        port=settings.mcp_server_port,
    )