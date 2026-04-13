"""
LLM service for question generation and cleaning.

Uses LangChain — provider is determined by which API key is in the environment.
Supports OpenAI, Anthropic, or any LangChain-compatible provider.
No provider is enforced here — set the matching env var to activate one.
"""

import os
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate

from mcp_server.core.errors import AIError, ErrorCode
from mcp_server.core.log import get_logger
from mcp_server.core.retry import ai_retry
from mcp_server.models.question import (
    CleanQuestionsInput,
    CleanQuestionsResult,
    GenerateQuestionsInput,
    GenerateQuestionsResult,
    Question,
)

logger = get_logger(__name__)


# ── LLM Factory ───────────────────────────────────────────────────────────────

def create_llm() -> BaseChatModel:
    """
    Create an LLM instance based on available environment variables.
    Checks providers in order — first match wins.
    """
    if os.getenv("OPENAI_API_KEY"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o"))

    if os.getenv("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"))

    if os.getenv("GOOGLE_API_KEY"):
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=os.getenv("GOOGLE_MODEL", "gemini-1.5-pro"))

    raise AIError(
        code=ErrorCode.AI_INVALID_RESPONSE,
        message="No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
        retryable=False,
    )


# ── Prompts ───────────────────────────────────────────────────────────────────

_GENERATE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a professional communication assistant.
Rewrite survey questions so they sound natural and human — like a colleague asking, not a robot.

Rules:
- Keep the exact same meaning and intent
- Use casual, conversational language
- No emojis, bullet points, or markdown formatting
- No em-dashes (—), en-dashes (–), or excessive punctuation
- Each question must be clearly different from any previous version listed below
- Return ONLY a valid JSON array of strings — one rewritten question per entry, same order as input

Previous phrasings to avoid repeating:
{previous_versions}
"""),
    ("human", "Rewrite these questions:\n{questions}"),
])


# ── Suspicious patterns ───────────────────────────────────────────────────────

_PATTERNS: list[tuple[str, str]] = [
    (r"—",              "-"),       # em-dash → hyphen
    (r"–",              "-"),       # en-dash → hyphen
    (r"\*\*(.*?)\*\*",  r"\1"),    # **bold** → plain
    (r"\*(.*?)\*",      r"\1"),    # *italic* → plain
    (r"^\s*[•\-\*]\s+", ""),       # leading bullet points
    (r"\s{2,}",         " "),      # multiple spaces → single
]


# ── Service ───────────────────────────────────────────────────────────────────

class LLMService:
    """
    Handles all LLM interactions for the question pipeline.
    Accepts an injected LLM for easy testing — falls back to create_llm().
    """

    def __init__(self, llm: BaseChatModel | None = None) -> None:
        self._llm = llm  # lazy — not created until first call

    @property
    def llm(self) -> BaseChatModel:
        if self._llm is None:
            self._llm = create_llm()
        return self._llm

    # ── generate_questions ────────────────────────────────────────────────────

    @ai_retry
    async def generate_questions(
        self,
        input: GenerateQuestionsInput,
    ) -> GenerateQuestionsResult:
        """Rewrite questions to sound human-like using the configured LLM."""
        logger.info("Generating questions", count=len(input.questions))

        try:
            chain = _GENERATE_PROMPT | self.llm | JsonOutputParser()

            raw: list[str] = await chain.ainvoke({
                "questions": "\n".join(
                    f"{i + 1}. {q.text}" for i, q in enumerate(input.questions)
                ),
                "previous_versions": (
                    "\n".join(f"- {v}" for v in input.previous_versions)
                    if input.previous_versions
                    else "None"
                ),
            })

            if len(raw) != len(input.questions):
                raise AIError(
                    code=ErrorCode.AI_INVALID_RESPONSE,
                    message=f"LLM returned {len(raw)} questions, expected {len(input.questions)}",
                    retryable=True,
                )

            rewritten = [
                Question(
                    text=new_text,
                    subject=original.subject,
                    question_id=original.question_id,
                )
                for original, new_text in zip(input.questions, raw)
            ]

            logger.info("Questions generated successfully", count=len(rewritten))
            return GenerateQuestionsResult(questions=rewritten)

        except AIError:
            raise
        except Exception as e:
            logger.error("LLM call failed", error=str(e))
            raise AIError(
                code=ErrorCode.AI_INVALID_RESPONSE,
                message=f"Failed to generate questions: {e}",
                retryable=True,
            ) from e

    # ── clean_suspicious_signs ────────────────────────────────────────────────

    async def clean_questions(
        self,
        input: CleanQuestionsInput,
    ) -> CleanQuestionsResult:
        """
        Remove AI-generated patterns from questions using regex.
        No LLM call — deterministic and fast.
        """
        logger.info("Cleaning questions", count=len(input.questions))

        cleaned: list[Question] = []
        all_removed: list[str] = []

        for question in input.questions:
            text = question.text

            for pattern, replacement in _PATTERNS:
                if re.search(pattern, text, flags=re.MULTILINE):
                    all_removed.append(pattern)
                text = re.sub(pattern, replacement, text, flags=re.MULTILINE)

            cleaned.append(
                Question(
                    text=text.strip(),
                    subject=question.subject,
                    question_id=question.question_id,
                )
            )

        removed_unique = list(dict.fromkeys(all_removed))  # dedup, preserve order
        logger.info("Questions cleaned", removed_patterns=removed_unique)

        return CleanQuestionsResult(
            questions=cleaned,
            removed_patterns=removed_unique,
        )