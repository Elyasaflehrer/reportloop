"""
Smoke tests for the question-answer workflow.

These tests run the graph with a very short reminder_interval_seconds (1 s)
and inject fake replies directly into the ReplyStore — no Twilio calls are
made.

Run with:
    pytest tests/test_workflow.py -v
"""

from __future__ import annotations

import asyncio

import pytest

from question_flow.agent.graph import build_graph
from question_flow.agent.state import WorkflowState
from question_flow.core.store import reply_store, session_store, SessionRecord


# ── Helpers ───────────────────────────────────────────────────────────────────


def _base_state(session_id: str, questions: list[str]) -> WorkflowState:
    return WorkflowState(
        session_id=session_id,
        recipient="+15550000000",
        platform="twilio",
        questions=questions,
        pending_questions=list(questions),
        answers={},
        reminder_count=0,
        max_reminders=1,
        reminder_interval_seconds=2,   # short for tests
        cycle_count=0,
        max_cycles=3,
        status="in_progress",
    )


async def _inject_reply(session_id: str, body: str, delay: float = 0.5) -> None:
    """Inject a reply into the store after *delay* seconds."""
    await asyncio.sleep(delay)
    await reply_store.add_reply(
        session_id=session_id, from_number="+15550000000", body=body
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_all_questions_answered(monkeypatch):
    """
    Happy path: user answers all questions in one reply.
    Expected final status: completed.
    """
    # Patch send_message so no real Twilio call is made
    from question_flow.mcp_server import server as srv

    async def _fake_send(**_):
        return None

    monkeypatch.setattr(srv, "send_message", _fake_send, raising=False)

    sid = "test-session-all-answered"
    questions = ["What is your name?", "What is your age?"]

    # Register session so webhook routing works
    await session_store.create(
        SessionRecord(session_id=sid, recipient="+15550000000", platform="twilio",
                      questions=questions)
    )

    state = _base_state(sid, questions)
    graph = build_graph().compile()

    # Inject replies slightly after the graph starts waiting
    asyncio.create_task(
        _inject_reply(sid, "Alice\n30", delay=0.3)
    )

    final = await graph.ainvoke(state)

    assert final["status"] == "completed"
    assert final["answers"].get("What is your name?") == "Alice"
    assert final["answers"].get("What is your age?") == "30"


@pytest.mark.asyncio
async def test_no_response_reports_failure(monkeypatch):
    """
    Failure path: user never replies.
    Expected final status: failed.
    """
    from question_flow.mcp_server import server as srv

    monkeypatch.setattr(srv, "send_message", lambda **_: None, raising=False)

    sid = "test-session-no-response"
    questions = ["How are you?"]
    state = _base_state(sid, questions)
    state["max_reminders"] = 0   # fail immediately

    graph = build_graph().compile()
    final = await graph.ainvoke(state)

    assert final["status"] == "failed"


@pytest.mark.asyncio
async def test_partial_then_complete(monkeypatch):
    """
    Partial answers on first reply → recycle → all answered on second reply.
    Expected final status: completed.
    """
    from question_flow.mcp_server import server as srv

    monkeypatch.setattr(srv, "send_message", lambda **_: None, raising=False)

    sid = "test-session-partial"
    questions = ["Name?", "City?", "Job?"]
    state = _base_state(sid, questions)
    state["max_reminders"] = 0   # no reminders; rely on recycle

    graph = build_graph().compile()

    # First reply: only two answers
    asyncio.create_task(_inject_reply(sid, "Bob\nLondon", delay=0.3))
    # Second reply (after recycle): remaining answer
    asyncio.create_task(_inject_reply(sid, "Engineer", delay=3.5))

    final = await graph.ainvoke(state)

    assert final["status"] == "completed"
    assert final["answers"]["Name?"] == "Bob"
    assert final["answers"]["City?"] == "London"
    assert final["answers"]["Job?"] == "Engineer"