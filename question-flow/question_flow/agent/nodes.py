"""
LangGraph node functions.

Each node receives the full WorkflowState and returns a *partial* dict
that LangGraph merges back into the state.  Nodes are pure async functions
— no side-effects except logging and MCP tool calls.

MCP tools are invoked in-process via a FastMCP Client session so the same
server.py is reused whether the graph runs inside the API server or as a
standalone script.
"""

from __future__ import annotations

import asyncio
import json

from fastmcp import Client

from question_flow.agent.state import WorkflowState
from question_flow.core.logging import get_logger
from question_flow.mcp_server.server import mcp, parse_mcp_result

logger = get_logger(__name__)


# ── Message formatting helpers ────────────────────────────────────────────────


def _questions_body(questions: list[str]) -> str:
    lines = ["Please answer the following questions (one answer per line, in order):"]
    for i, q in enumerate(questions, 1):
        lines.append(f"{i}. {q}")
    lines.append("\nReply with your answers in the same order.")
    return "\n".join(lines)


def _reminder_body(questions: list[str], reminder_num: int) -> str:
    lines = [f"Reminder #{reminder_num} — we are still waiting for your responses:"]
    for i, q in enumerate(questions, 1):
        lines.append(f"{i}. {q}")
    lines.append("\nPlease reply with your answers in order.")
    return "\n".join(lines)


# ── Nodes ─────────────────────────────────────────────────────────────────────


async def send_questions_node(state: WorkflowState) -> dict:
    """
    Send (or resend) the pending questions to the recipient.

    Resets reminder_count to 0 so the reminder counter restarts fresh
    after a partial-answer recycle.
    """
    logger.info(
        "Node send_questions  session=%s  cycle=%d  pending=%d",
        state["session_id"], state["cycle_count"], len(state["pending_questions"]),
    )

    message = _questions_body(state["pending_questions"])

    async with Client(mcp) as client:
        result = await client.call_tool(
            "send_message",
            {
                "platform": state["platform"],
                "recipient": state["recipient"],
                "message": message,
                "session_id": state["session_id"],
            },
        )

    send_result = parse_mcp_result(result)
    if isinstance(send_result, dict) and not send_result.get("success"):
        logger.warning(
            "send_message reported failure  session=%s  error=%s",
            state["session_id"], send_result.get("error"),
        )

    return {
        "status": "in_progress",
        "reminder_count": 0,   # always reset when (re)sending questions
        "_raw_replies": [],     # clear any stale replies
    }


async def wait_for_replies_node(state: WorkflowState) -> dict:
    """
    Sleep for reminder_interval_seconds while polling for new replies.

    Polls every POLL_INTERVAL seconds (max 30 s) so the process stays
    responsive to testing with short intervals.  Returns as soon as the
    first batch of replies arrives, or when the full interval has elapsed.
    """
    interval = state["reminder_interval_seconds"]
    poll_every = min(30, max(1, interval))
    elapsed = 0

    logger.info(
        "Node wait_for_replies  session=%s  interval=%ds  poll_every=%ds",
        state["session_id"], interval, poll_every,
    )

    while elapsed < interval:
        await asyncio.sleep(poll_every)
        elapsed += poll_every

        async with Client(mcp) as client:
            result = await client.call_tool(
                "get_replies", {"session_id": state["session_id"]}
            )

        replies_data = parse_mcp_result(result)
        bodies: list[str] = []
        if isinstance(replies_data, list):
            bodies = [r["body"] for r in replies_data if isinstance(r, dict) and "body" in r]

        if bodies:
            logger.info(
                "Node wait_for_replies  session=%s  got %d replies after %ds",
                state["session_id"], len(bodies), elapsed,
            )
            return {"_raw_replies": bodies}

        logger.debug(
            "Node wait_for_replies  session=%s  no replies yet  elapsed=%ds",
            state["session_id"], elapsed,
        )

    logger.info(
        "Node wait_for_replies  session=%s  timeout after %ds — no replies",
        state["session_id"], interval,
    )
    return {"_raw_replies": []}


async def send_reminder_node(state: WorkflowState) -> dict:
    """Increment the reminder counter and send a reminder message."""
    new_count = state["reminder_count"] + 1
    logger.info(
        "Node send_reminder  session=%s  reminder=%d/%d",
        state["session_id"], new_count, state["max_reminders"],
    )

    message = _reminder_body(state["pending_questions"], new_count)

    async with Client(mcp) as client:
        await client.call_tool(
            "send_message",
            {
                "platform": state["platform"],
                "recipient": state["recipient"],
                "message": message,
                "session_id": state["session_id"],
            },
        )

    return {"reminder_count": new_count}


async def parse_and_match_node(state: WorkflowState) -> dict:
    """
    Parse raw reply bodies and match answers to pending questions.

    Matching strategy (positional, in order):
      - Flatten all reply bodies; split multi-line replies line-by-line.
      - Strip blank lines.
      - Zip the resulting lines with the pending_questions list.
      - Only questions that receive a corresponding line are marked answered.

    If you need smarter matching (e.g. LLM-assisted), replace the body of
    this function with a call to an LLM with a structured prompt.
    """
    raw_replies: list[str] = state.get("_raw_replies", [])

    # Flatten into individual answer lines
    answer_lines: list[str] = []
    for reply in raw_replies:
        for line in reply.strip().splitlines():
            stripped = line.strip()
            if stripped:
                answer_lines.append(stripped)

    logger.info(
        "Node parse_and_match  session=%s  reply_msgs=%d  answer_lines=%d  pending=%d",
        state["session_id"], len(raw_replies), len(answer_lines),
        len(state["pending_questions"]),
    )

    new_answers = dict(state.get("answers", {}))
    for i, question in enumerate(state["pending_questions"]):
        if i < len(answer_lines):
            new_answers[question] = answer_lines[i]
            logger.debug(
                "Matched  Q=%r  A=%r", question, answer_lines[i][:60]
            )
        else:
            logger.debug("No answer provided for Q=%r", question)

    return {
        "answers": new_answers,
        "_raw_replies": [],   # consume raw replies
    }


async def check_completeness_node(state: WorkflowState) -> dict:
    """
    Compute which questions still lack answers and update pending_questions.
    """
    answers = state.get("answers", {})
    pending = [q for q in state["questions"] if q not in answers]

    logger.info(
        "Node check_completeness  session=%s  answered=%d/%d  pending=%d",
        state["session_id"], len(answers), len(state["questions"]), len(pending),
    )
    return {"pending_questions": pending}


async def increment_cycle_node(state: WorkflowState) -> dict:
    """
    Increment the recycle counter before looping back to send_questions.
    Also resets the reminder counter for the new cycle.
    """
    new_cycle = state["cycle_count"] + 1
    logger.info(
        "Node increment_cycle  session=%s  cycle=%d→%d",
        state["session_id"], state["cycle_count"], new_cycle,
    )
    return {"cycle_count": new_cycle, "reminder_count": 0}


async def write_to_db_node(state: WorkflowState) -> dict:
    """
    Persist the completed answers to the database.

    The DB layer is a *future feature* (db_enabled=False by default).
    When enabled, import and call the repository function; otherwise log
    the result and mark the session completed in the in-memory store.
    """
    from question_flow.core.config import settings  # noqa: PLC0415
    from question_flow.core.store import session_store  # noqa: PLC0415

    logger.info(
        "Node write_to_db  session=%s  answers=%d  db_enabled=%s",
        state["session_id"], len(state["answers"]), settings.db_enabled,
    )

    if settings.db_enabled:
        try:
            from question_flow.db.repository import save_session_answers  # noqa: PLC0415

            await save_session_answers(
                session_id=state["session_id"],
                answers=state["answers"],
            )
            logger.info("DB write OK  session=%s", state["session_id"])
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "DB write failed  session=%s  error=%s", state["session_id"], exc
            )
            await session_store.update_status(state["session_id"], "failed")
            await session_store.update_error(state["session_id"], str(exc))
            return {"status": "failed", "error": str(exc)}
    else:
        logger.info(
            "DB disabled — answers logged only  session=%s  answers=%s",
            state["session_id"], state["answers"],
        )

    await session_store.update_answers(state["session_id"], state["answers"])
    await session_store.update_status(state["session_id"], "completed")
    return {"status": "completed"}


async def report_failure_node(state: WorkflowState) -> dict:
    """
    Mark the session as failed — called when reminders are exhausted
    or when the maximum recycle cycle count is reached.
    """
    from question_flow.core.store import session_store  # noqa: PLC0415

    reason = (
        f"No complete response after {state['reminder_count']} reminder(s) "
        f"and {state['cycle_count']} recycle cycle(s)."
    )
    logger.warning(
        "Node report_failure  session=%s  reason=%s", state["session_id"], reason
    )
    await session_store.update_status(state["session_id"], "failed")
    await session_store.update_error(state["session_id"], reason)
    return {"status": "failed", "error": reason}