"""
Unit tests for LLMService.
The LLM is always mocked — no real API calls.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from mcp_server.core.errors import AIError, ErrorCode
from mcp_server.models.question import (
    CleanQuestionsInput,
    GenerateQuestionsInput,
    Question,
)
from mcp_server.services.llm import LLMService


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_questions(*texts: str) -> list[Question]:
    return [Question(text=t) for t in texts]


def make_service(llm_response: list[str]) -> LLMService:
    """Build an LLMService with a mocked LLM that returns llm_response."""
    mock_llm = MagicMock()
    mock_chain = AsyncMock(return_value=llm_response)

    with patch("mcp_server.services.llm._GENERATE_PROMPT") as mock_prompt:
        mock_prompt.__or__ = MagicMock(return_value=MagicMock(
            __or__=MagicMock(return_value=mock_chain)
        ))
        service = LLMService(llm=mock_llm)

    service._chain = mock_chain
    return service


# ── generate_questions ────────────────────────────────────────────────────────

class TestGenerateQuestions:
    @pytest.mark.asyncio
    async def test_returns_same_number_of_questions(self):
        service = LLMService(llm=MagicMock())
        rewritten = ["How did your day go?", "Did you finish the report?"]

        with patch.object(service, "llm"), \
             patch("mcp_server.services.llm._GENERATE_PROMPT") as mock_prompt:

            chain_mock = AsyncMock(return_value=rewritten)
            mock_prompt.__or__ = MagicMock(
                return_value=MagicMock(__or__=MagicMock(return_value=chain_mock))
            )

            input_ = GenerateQuestionsInput(
                questions=make_questions("How was your day?", "Did you finish the report?")
            )
            result = await service.generate_questions(input_)

        assert len(result.questions) == 2

    @pytest.mark.asyncio
    async def test_preserves_subject_and_id(self):
        service = LLMService(llm=MagicMock())
        original = [Question(text="How was your day?", subject="wellbeing", question_id="q1")]

        with patch.object(service, "llm"), \
             patch("mcp_server.services.llm._GENERATE_PROMPT") as mock_prompt:

            chain_mock = AsyncMock(return_value=["How did today treat you?"])
            mock_prompt.__or__ = MagicMock(
                return_value=MagicMock(__or__=MagicMock(return_value=chain_mock))
            )

            input_ = GenerateQuestionsInput(questions=original)
            result = await service.generate_questions(input_)

        assert result.questions[0].subject == "wellbeing"
        assert result.questions[0].question_id == "q1"

    @pytest.mark.asyncio
    async def test_raises_ai_error_on_count_mismatch(self):
        service = LLMService(llm=MagicMock())

        with patch.object(service, "llm"), \
             patch("mcp_server.services.llm._GENERATE_PROMPT") as mock_prompt:

            # LLM returns 1 item but input has 2 questions
            chain_mock = AsyncMock(return_value=["Only one question back"])
            mock_prompt.__or__ = MagicMock(
                return_value=MagicMock(__or__=MagicMock(return_value=chain_mock))
            )

            input_ = GenerateQuestionsInput(
                questions=make_questions("Q1?", "Q2?")
            )
            with pytest.raises(AIError) as exc:
                await service.generate_questions(input_)

        assert exc.value.code == ErrorCode.AI_INVALID_RESPONSE

    @pytest.mark.asyncio
    async def test_result_success_true(self):
        service = LLMService(llm=MagicMock())

        with patch.object(service, "llm"), \
             patch("mcp_server.services.llm._GENERATE_PROMPT") as mock_prompt:

            chain_mock = AsyncMock(return_value=["Rewritten?"])
            mock_prompt.__or__ = MagicMock(
                return_value=MagicMock(__or__=MagicMock(return_value=chain_mock))
            )

            result = await service.generate_questions(
                GenerateQuestionsInput(questions=make_questions("Original?"))
            )

        assert result.success is True


# ── clean_questions ───────────────────────────────────────────────────────────

class TestCleanQuestions:
    @pytest.mark.asyncio
    async def test_removes_em_dash(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("How was your day — really?"))
        )
        assert "—" not in result.questions[0].text

    @pytest.mark.asyncio
    async def test_removes_en_dash(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("Status – any updates?"))
        )
        assert "–" not in result.questions[0].text

    @pytest.mark.asyncio
    async def test_removes_bold_markdown(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("Did you finish the **report**?"))
        )
        assert "**" not in result.questions[0].text
        assert "report" in result.questions[0].text

    @pytest.mark.asyncio
    async def test_removes_bullet_point(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("• Did you finish the task?"))
        )
        assert result.questions[0].text.startswith("•") is False

    @pytest.mark.asyncio
    async def test_tracks_removed_patterns(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("How was your day — really?"))
        )
        assert len(result.removed_patterns) > 0

    @pytest.mark.asyncio
    async def test_preserves_subject_and_id(self):
        service = LLMService(llm=MagicMock())
        q = Question(text="How was — your day?", subject="wellness", question_id="q42")
        result = await service.clean_questions(CleanQuestionsInput(questions=[q]))
        assert result.questions[0].subject == "wellness"
        assert result.questions[0].question_id == "q42"

    @pytest.mark.asyncio
    async def test_clean_question_unchanged_if_no_patterns(self):
        service = LLMService(llm=MagicMock())
        result = await service.clean_questions(
            CleanQuestionsInput(questions=make_questions("How was your day?"))
        )
        assert result.questions[0].text == "How was your day?"
        assert result.removed_patterns == []