"""
MCP tools for the question pipeline.
Tools are registered onto the main server in main.py via mcp.add_tool().
"""

from mcp_server.core.errors import MCPToolError
from mcp_server.core.log import get_logger
from mcp_server.models.question import (
    CleanQuestionsInput,
    CleanQuestionsResult,
    GenerateQuestionsInput,
    GenerateQuestionsResult,
)
from mcp_server.services.llm import LLMService

logger = get_logger(__name__)

_service = LLMService()


async def generate_questions(
    input: GenerateQuestionsInput,
) -> GenerateQuestionsResult | dict:
    """
    Rewrite a list of questions to sound human-like.
    Never produces the exact same phrasing twice.
    """
    try:
        return await _service.generate_questions(input)
    except MCPToolError as e:
        logger.error("generate_questions failed", error=e.message, code=e.code)
        return e.to_dict()


async def clean_suspicious_signs(
    input: CleanQuestionsInput,
) -> CleanQuestionsResult | dict:
    """
    Remove AI-generated patterns from questions —
    em-dashes, excessive formatting, unnatural punctuation.
    """
    try:
        return await _service.clean_questions(input)
    except MCPToolError as e:
        logger.error("clean_suspicious_signs failed", error=e.message, code=e.code)
        return e.to_dict()