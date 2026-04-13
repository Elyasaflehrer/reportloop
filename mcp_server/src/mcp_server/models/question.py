"""
Pydantic models for the question pipeline.

Used as input/output contracts for:
  - tools/questions.py   (MCP tool layer)
  - services/llm.py      (LLM service layer)
"""

from pydantic import BaseModel, Field, field_validator


# ── Core ──────────────────────────────────────────────────────────────────────

class Question(BaseModel):
    """A single question with optional subject grouping."""

    text: str = Field(..., min_length=1, description="The question text")
    subject: str | None = Field(None, description="Optional subject this question belongs to")
    question_id: str | None = Field(None, description="Optional stable ID from the database")

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Question text must not be blank")
        return v.strip()


# ── generate_questions ────────────────────────────────────────────────────────

class GenerateQuestionsInput(BaseModel):
    """Input for the generate_questions tool."""

    questions: list[Question] = Field(
        ...,
        min_length=1,
        description="Questions to rewrite as human-like",
    )
    previous_versions: list[str] = Field(
        default_factory=list,
        description="Previously sent phrasings — LLM avoids repeating these",
    )


class GenerateQuestionsResult(BaseModel):
    """Output of the generate_questions tool."""

    questions: list[Question] = Field(
        ...,
        description="Rewritten human-like questions, same order as input",
    )
    success: bool = True


# ── clean_suspicious_signs ────────────────────────────────────────────────────

class CleanQuestionsInput(BaseModel):
    """Input for the clean_suspicious_signs tool."""

    questions: list[Question] = Field(
        ...,
        min_length=1,
        description="Questions to clean from AI-generated patterns",
    )


class CleanQuestionsResult(BaseModel):
    """Output of the clean_suspicious_signs tool."""

    questions: list[Question] = Field(
        ...,
        description="Cleaned questions, same order as input",
    )
    removed_patterns: list[str] = Field(
        default_factory=list,
        description="List of patterns that were detected and removed",
    )
    success: bool = True