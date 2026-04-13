"""
Simple /questions endpoint.

POST /questions  →  sends SMS, starts workflow, returns session_id.
GET  /questions/{session_id}/answers  →  returns answers (poll until status != in_progress).

This is a thin convenience wrapper around /sessions that lets you test
the full flow with a single curl:

    curl -X POST http://localhost:8000/questions \
      -H "Content-Type: application/json" \
      -d '{"questions": ["Name?", "City?"], "recipient": "+972XXXXXXXXX"}'
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from question_flow.agent.graph import workflow
from question_flow.agent.state import WorkflowState
from question_flow.core.config import settings
from question_flow.core.logging import get_logger
from question_flow.core.store import SessionRecord, reply_store, session_store

logger = get_logger(__name__)

router = APIRouter(prefix="/questions", tags=["questions"])

# ANSI colors for terminal output
_GREEN  = "\033[92m"
_CYAN   = "\033[96m"
_YELLOW = "\033[93m"
_RED    = "\033[91m"
_BOLD   = "\033[1m"
_RESET  = "\033[0m"


# ── Schemas ───────────────────────────────────────────────────────────────────


class AskRequest(BaseModel):
    questions: list[str] = Field(
        ...,
        min_length=1,
        examples=[["What is your full name?", "What city are you in?"]],
    )
    recipient: str = Field(
        ...,
        examples=["+972XXXXXXXXX"],
        description="E.164 phone number of the person to question.",
    )
    platform: str = Field(default="twilio")
    reminder_interval_seconds: int | None = Field(default=None, ge=10)
    max_reminders: int | None = Field(default=None, ge=0)


class AskResponse(BaseModel):
    session_id: str
    status: str
    message: str


class AnswersResponse(BaseModel):
    session_id: str
    status: str                  # "in_progress" | "completed" | "failed"
    answers: dict[str, str]
    pending: list[str]           # questions not yet answered
    error: str | None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _print_banner(session_id: str, questions: list[str], recipient: str) -> None:
    print(f"\n{_BOLD}{_CYAN}{'═' * 60}{_RESET}")
    print(f"{_BOLD}{_CYAN}  🚀  WORKFLOW STARTED{_RESET}")
    print(f"{_CYAN}{'═' * 60}{_RESET}")
    print(f"  Session  : {_YELLOW}{session_id}{_RESET}")
    print(f"  Recipient: {recipient}")
    print(f"  Questions:")
    for i, q in enumerate(questions, 1):
        print(f"    {i}. {q}")
    print(f"{_CYAN}{'─' * 60}{_RESET}\n")


def _print_answers(session_id: str, answers: dict[str, str]) -> None:
    print(f"\n{_BOLD}{_GREEN}{'═' * 60}{_RESET}")
    print(f"{_BOLD}{_GREEN}  ✅  ALL ANSWERS RECEIVED — SESSION COMPLETE{_RESET}")
    print(f"{_GREEN}{'═' * 60}{_RESET}")
    print(f"  Session : {_YELLOW}{session_id}{_RESET}\n")
    for question, answer in answers.items():
        print(f"  {_BOLD}Q:{_RESET} {question}")
        print(f"  {_GREEN}A:{_RESET} {_BOLD}{answer}{_RESET}\n")
    print(f"{_GREEN}{'═' * 60}{_RESET}\n")


def _print_failure(session_id: str, reason: str) -> None:
    print(f"\n{_BOLD}{_RED}{'═' * 60}{_RESET}")
    print(f"{_BOLD}{_RED}  ❌  SESSION FAILED{_RESET}")
    print(f"{_RED}{'═' * 60}{_RESET}")
    print(f"  Session : {_YELLOW}{session_id}{_RESET}")
    print(f"  Reason  : {reason}")
    print(f"{_RED}{'═' * 60}{_RESET}\n")


def _print_partial(session_id: str, answers: dict, pending: list) -> None:
    print(f"\n{_YELLOW}  ↩️  PARTIAL ANSWERS — recycling{_RESET}")
    print(f"  Session  : {session_id}")
    print(f"  Answered : {len(answers)}  |  Still pending : {len(pending)}")
    for q in pending:
        print(f"    • {q}")
    print()


# ── Background workflow runner ────────────────────────────────────────────────


async def _run_workflow(initial_state: WorkflowState) -> None:
    sid = initial_state["session_id"]
    _print_banner(sid, initial_state["questions"], initial_state["recipient"])

    try:
        final_state = await workflow.ainvoke(initial_state)
        status  = final_state.get("status", "completed")
        answers = final_state.get("answers", {})
        error   = final_state.get("error")

        await session_store.update_status(sid, status)
        await session_store.update_answers(sid, answers)

        if status == "completed":
            _print_answers(sid, answers)
        else:
            _print_failure(sid, error or "unknown error")

    except Exception as exc:  # noqa: BLE001
        logger.exception("Workflow crashed  session=%s", sid)
        _print_failure(sid, str(exc))
        await session_store.update_status(sid, "failed")
        await session_store.update_error(sid, str(exc))


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("", response_model=AskResponse, status_code=201)
async def ask(
    body: AskRequest,
    background_tasks: BackgroundTasks,
) -> AskResponse:
    """
    Send questions to a recipient and start the answer-collection workflow.

    The questions are sent immediately via SMS.  The workflow runs in the
    background and prints answers to the server terminal when they arrive.
    Poll GET /questions/{session_id}/answers to read the results via API.
    """
    session_id = str(uuid.uuid4())

    record = SessionRecord(
        session_id=session_id,
        recipient=body.recipient,
        platform=body.platform,
        questions=body.questions,
        status="in_progress",
    )
    await session_store.create(record)

    initial_state: WorkflowState = {
        "session_id": session_id,
        "recipient": body.recipient,
        "platform": body.platform,
        "questions": body.questions,
        "pending_questions": list(body.questions),
        "answers": {},
        "reminder_count": 0,
        "max_reminders": body.max_reminders
            if body.max_reminders is not None else settings.max_reminders,
        "reminder_interval_seconds": body.reminder_interval_seconds
            if body.reminder_interval_seconds is not None
            else settings.reminder_interval_seconds,
        "cycle_count": 0,
        "max_cycles": settings.max_cycles,
        "status": "in_progress",
    }

    background_tasks.add_task(_run_workflow, initial_state)

    logger.info(
        "Questions sent  session=%s  recipient=%s  count=%d",
        session_id, body.recipient, len(body.questions),
    )
    return AskResponse(
        session_id=session_id,
        status="in_progress",
        message=(
            f"Questions sent to {body.recipient}.  "
            f"Answers will print in the server terminal when received.  "
            f"Poll GET /questions/{session_id}/answers for API access."
        ),
    )


@router.get("/{session_id}/answers", response_model=AnswersResponse)
async def get_answers(session_id: str) -> AnswersResponse:
    """
    Poll this endpoint to read collected answers.

    Returns immediately with the current state.  Keep polling until
    status = 'completed' or 'failed'.
    """
    record = await session_store.get(session_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id!r} not found.")

    pending = [q for q in record.questions if q not in record.answers]

    return AnswersResponse(
        session_id=session_id,
        status=record.status,
        answers=record.answers,
        pending=pending,
        error=record.error,
    )