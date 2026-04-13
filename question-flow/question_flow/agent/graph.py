"""
LangGraph workflow definition.

Graph topology
--------------

    START
      │
      ▼
  send_questions  ◄─────────────────────────────┐
      │                                          │
      ▼                                          │
  wait_for_replies                               │
      │                                          │
      ├─ has replies ──► parse_and_match         │
      │                       │                 │
      │                       ▼                 │
      │               check_completeness        │
      │                       │                 │
      │           ┌───────────┴──────────┐      │
      │           │ all done             │ not  │
      │           ▼                      │ done │
      │       write_to_db            increment  │
      │           │                  _cycle ────┘
      │           ▼
      │          END
      │
      ├─ no replies, reminders < max ──► send_reminder
      │                                       │
      │                                       ▼
      │                               (back to wait_for_replies)
      │
      └─ no replies, reminders ≥ max  ──► report_failure ──► END

      check_completeness also routes to report_failure when
      cycle_count ≥ max_cycles (safety valve for infinite loops).
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from question_flow.agent.nodes import (
    check_completeness_node,
    increment_cycle_node,
    parse_and_match_node,
    report_failure_node,
    send_questions_node,
    send_reminder_node,
    wait_for_replies_node,
    write_to_db_node,
)
from question_flow.agent.state import WorkflowState
from question_flow.core.logging import get_logger

logger = get_logger(__name__)


# ── Conditional edge routers ──────────────────────────────────────────────────


def _route_after_wait(state: WorkflowState) -> str:
    """
    Decide what to do after the reply-wait window expires.

    Priority:
      1. Replies received           → parse them.
      2. Reminders still available  → send a reminder and wait again.
      3. Reminders exhausted        → give up.
    """
    has_replies = bool(state.get("_raw_replies"))

    if has_replies:
        logger.debug(
            "Router after_wait  session=%s  → parse_and_match  replies=%d",
            state["session_id"], len(state.get("_raw_replies", [])),
        )
        return "parse_and_match"

    if state["reminder_count"] < state["max_reminders"]:
        logger.debug(
            "Router after_wait  session=%s  → send_reminder  count=%d/%d",
            state["session_id"], state["reminder_count"], state["max_reminders"],
        )
        return "send_reminder"

    logger.debug(
        "Router after_wait  session=%s  → report_failure  reminders_exhausted",
        state["session_id"],
    )
    return "report_failure"


def _route_after_completeness(state: WorkflowState) -> str:
    """
    Decide what to do after checking how many questions are still pending.

    Priority:
      1. All answered          → write to DB.
      2. Max cycles reached    → give up (prevents infinite recycle loops).
      3. Still pending answers → recycle (increment cycle, resend questions).
    """
    pending = state.get("pending_questions", [])

    if not pending:
        logger.debug(
            "Router after_completeness  session=%s  → write_to_db  all answered",
            state["session_id"],
        )
        return "write_to_db"

    if state["cycle_count"] >= state["max_cycles"]:
        logger.warning(
            "Router after_completeness  session=%s  → report_failure  "
            "max_cycles=%d reached with %d pending",
            state["session_id"], state["max_cycles"], len(pending),
        )
        return "report_failure"

    logger.debug(
        "Router after_completeness  session=%s  → increment_cycle  pending=%d",
        state["session_id"], len(pending),
    )
    return "increment_cycle"


# ── Graph builder ─────────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    """Construct and return the compiled workflow graph."""
    g = StateGraph(WorkflowState)

    # Register nodes
    g.add_node("send_questions",      send_questions_node)
    g.add_node("wait_for_replies",    wait_for_replies_node)
    g.add_node("send_reminder",       send_reminder_node)
    g.add_node("parse_and_match",     parse_and_match_node)
    g.add_node("check_completeness",  check_completeness_node)
    g.add_node("increment_cycle",     increment_cycle_node)
    g.add_node("write_to_db",         write_to_db_node)
    g.add_node("report_failure",      report_failure_node)

    # Fixed edges
    g.add_edge(START,              "send_questions")
    g.add_edge("send_questions",   "wait_for_replies")
    g.add_edge("send_reminder",    "wait_for_replies")    # reminder → wait again
    g.add_edge("parse_and_match",  "check_completeness")
    g.add_edge("increment_cycle",  "send_questions")      # recycle loop
    g.add_edge("write_to_db",      END)
    g.add_edge("report_failure",   END)

    # Conditional edges
    g.add_conditional_edges(
        "wait_for_replies",
        _route_after_wait,
        {
            "parse_and_match":  "parse_and_match",
            "send_reminder":    "send_reminder",
            "report_failure":   "report_failure",
        },
    )

    g.add_conditional_edges(
        "check_completeness",
        _route_after_completeness,
        {
            "write_to_db":      "write_to_db",
            "increment_cycle":  "increment_cycle",
            "report_failure":   "report_failure",
        },
    )

    return g


# ── Module-level compiled graph (singleton) ───────────────────────────────────

workflow = build_graph().compile()

__all__ = ["workflow", "build_graph"]