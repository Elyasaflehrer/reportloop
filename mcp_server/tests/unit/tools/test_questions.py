"""
Unit tests for the question MCP tools.
Service is always mocked — tests only verify the tool layer behaviour.
"""

import pytest
from unittest.mock import AsyncMock, patch

from mcp_server.core.errors import AIError, ErrorCode
from mcp_server.models.question import (
    CleanQuestionsInput,
    CleanQuestionsResult,
    GenerateQuestionsInput,
    GenerateQuestionsResult,
    Question,
)
from mcp_server.tools.questions import clean_suspicious_signs, generate_questions


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_questions(*texts: str) -> list[Question]:
    return [Question(text=t) for t in texts]


# ── generate_questions ────────────────────────────────────────────────────────

class TestGenerateQuestionsTool:
    @pytest.mark.asyncio
    async def test_returns_result_on_success(self):
        expected = GenerateQuestionsResult(questions=make_questions("How did today go?"))

        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.generate_questions = AsyncMock(return_value=expected)
            result = await generate_questions(
                GenerateQuestionsInput(questions=make_questions("How was your day?"))
            )

        assert isinstance(result, GenerateQuestionsResult)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_returns_error_dict_on_failure(self):
        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.generate_questions = AsyncMock(
                side_effect=AIError(ErrorCode.AI_RATE_LIMIT, "rate limited", retryable=True)
            )
            result = await generate_questions(
                GenerateQuestionsInput(questions=make_questions("Q?"))
            )

        assert isinstance(result, dict)
        assert result["success"] is False
        assert result["error"] == ErrorCode.AI_RATE_LIMIT
        assert result["retryable"] is True

    @pytest.mark.asyncio
    async def test_passes_input_to_service(self):
        questions = make_questions("Q1?", "Q2?")
        input_ = GenerateQuestionsInput(questions=questions, previous_versions=["old Q1?"])

        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.generate_questions = AsyncMock(
                return_value=GenerateQuestionsResult(questions=questions)
            )
            await generate_questions(input_)
            mock_service.generate_questions.assert_called_once_with(input_)


# ── clean_suspicious_signs ────────────────────────────────────────────────────

class TestCleanSuspiciousSignsTool:
    @pytest.mark.asyncio
    async def test_returns_result_on_success(self):
        expected = CleanQuestionsResult(
            questions=make_questions("How was your day?"),
            removed_patterns=["—"],
        )

        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.clean_questions = AsyncMock(return_value=expected)
            result = await clean_suspicious_signs(
                CleanQuestionsInput(questions=make_questions("How was your day — really?"))
            )

        assert isinstance(result, CleanQuestionsResult)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_returns_error_dict_on_failure(self):
        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.clean_questions = AsyncMock(
                side_effect=AIError(ErrorCode.UNEXPECTED_ERROR, "unexpected")
            )
            result = await clean_suspicious_signs(
                CleanQuestionsInput(questions=make_questions("Q?"))
            )

        assert isinstance(result, dict)
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_passes_input_to_service(self):
        input_ = CleanQuestionsInput(questions=make_questions("Q — ?"))

        with patch("mcp_server.tools.questions._service") as mock_service:
            mock_service.clean_questions = AsyncMock(
                return_value=CleanQuestionsResult(questions=make_questions("Q - ?"))
            )
            await clean_suspicious_signs(input_)
            mock_service.clean_questions.assert_called_once_with(input_)