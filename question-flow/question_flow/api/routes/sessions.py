"""
REST API — session management.

Endpoints
---------
POST /sessions          Create a new question-answer workflow session.
GET  /sessions/{id}     Poll the status and collected answers of a session.
GET  /sessions          List all active sessions (admin / debugging).
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from question_flow.agent.graph import workflow
from question_flow.agent.state import WorkflowState
from question_flow.core.config import settings
from question_flow.core.logging import get_logger
from question_flow.core.store import SessionRecord, reply_store, session_store

logger = get_logger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


# ── Request / response schemas ────────────────────────────────────────────────


class CreateSessionRequest(BaseModel):
    questions: list[str] = Field(
        ...,
        min_length=1,
        description="Ordered list of questions to send to the recipient.",
        examples=[["What is your full name?", "What is your date of birth?"]],
    )
    recipient: str = Field(
        ...,
        description="Platform-specific recipient address (e.g. E.164 phone number).",
        examples=["+15551234567"],
    )
    platform: str = Field(
        default="twilio",
        description="Messaging platform key (must be registered in the platform registry).",
    )
    max_reminders: Optional[int] = Field(
        default=None,
        ge=0,
        description="Override the global max_reminders setting for this session.",
    )
    reminder_interval_seconds: Optional[int] = Field(
        default=None,
        ge=10,
        description="Override the global reminder_interval_seconds for this session.",
    )


class CreateSessionResponse(BaseModel):
    session_id: str
    status: str
    message: str


class SessionStatusResponse(BaseModel):
    session_id: str
    status: str
    questions: list[str]
    answers: dict[str, str]
    error: Optional[str]


class SessionSummary(BaseModel):
    session_id: str
    recipient: str
    platform: str
    status: str
    question_count: int


# ── Background workflow runner ────────────────────────────────────────────────


async def _run_workflow(initial_state: WorkflowState) -> None:
    """Execute the LangGraph workflow as a background task."""
    sid = initial_state["session_id"]
    logger.info("Workflow starting  session=%s", sid)
    try:
        final_state = await workflow.ainvoke(initial_state)
        status = final_state.get("status", "completed")
        logger.info(
            "Workflow finished  session=%s  status=%s  answers=%d",
            sid, status, len(final_state.get("answers", {})),
        )
        # The node functions already update session_store, but we refresh
        # answers here as a safety net in case the node was skipped.
        await session_store.update_status(sid, status)
        await session_store.update_answers(sid, final_state.get("answers", {}))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Workflow error  session=%s  error=%s", sid, exc)
        await session_store.update_status(sid, "failed")
        await session_store.update_error(sid, str(exc))


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("", response_model=CreateSessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    background_tasks: BackgroundTasks,
) -> CreateSessionResponse:
    """
    Create a new question-answer session.

    The workflow starts immediately in the background:
      • Questions are sent to *recipient* via the chosen *platform*.
      • Replies are collected and matched to questions.
      • Use GET /sessions/{session_id} to poll progress.
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
        if body.max_reminders is not None
        else settings.max_reminders,
        "reminder_interval_seconds": body.reminder_interval_seconds
        if body.reminder_interval_seconds is not None
        else settings.reminder_interval_seconds,
        "cycle_count": 0,
        "max_cycles": settings.max_cycles,
        "status": "in_progress",
    }

    background_tasks.add_task(_run_workflow, initial_state)

    logger.info(
        "Session created  id=%s  recipient=%s  platform=%s  questions=%d",
        session_id, body.recipient, body.platform, len(body.questions),
    )
    return CreateSessionResponse(
        session_id=session_id,
        status="in_progress",
        message="Workflow started.  Poll GET /sessions/{session_id} for status.",
    )


@router.get("/{session_id}", response_model=SessionStatusResponse)
async def get_session(session_id: str) -> SessionStatusResponse:
    """Return the current status and collected answers for a session."""
    record = await session_store.get(session_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id!r} not found.")

    return SessionStatusResponse(
        session_id=record.session_id,
        status=record.status,
        questions=record.questions,
        answers=record.answers,
        error=record.error,
    )


@router.get("", response_model=list[SessionSummary])
async def list_sessions() -> list[SessionSummary]:
    """List all tracked sessions (useful for admin / debugging)."""
    records = await session_store.list_all()
    return [
        SessionSummary(
            session_id=r.session_id,
            recipient=r.recipient,
            platform=r.platform,
            status=r.status,
            question_count=len(r.questions),
        )
        for r in records
    ]