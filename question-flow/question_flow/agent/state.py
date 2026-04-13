"""
LangGraph workflow state.

WorkflowState is the single dict that flows through every node.
LangGraph merges partial updates returned by each node into this dict.

Required vs. optional fields
-----------------------------
All fields marked NotRequired are populated by specific nodes and may be
absent in earlier stages of the graph; nodes that read them use .get().
"""

from __future__ import annotations

from typing import NotRequired, TypedDict


class WorkflowState(TypedDict):
    # ── Session identity ──────────────────────────────────────────────────────
    session_id: str
    recipient: str          # phone number / user address
    platform: str           # e.g. "twilio"

    # ── Questions & answers ───────────────────────────────────────────────────
    questions: list[str]            # full original list (never mutated)
    pending_questions: list[str]    # subset not yet answered
    answers: dict[str, str]         # question → answer (accumulated)

    # ── Retry / reminder tracking ─────────────────────────────────────────────
    reminder_count: int             # reminders sent in the current cycle
    max_reminders: int
    reminder_interval_seconds: int

    # ── Recycle-loop guard ────────────────────────────────────────────────────
    cycle_count: int                # number of partial-answer recycles so far
    max_cycles: int

    # ── Outcome ───────────────────────────────────────────────────────────────
    status: str                     # "in_progress" | "completed" | "failed"
    error: NotRequired[str | None]

    # ── Internal / transient (cleared after use) ──────────────────────────────
    _raw_replies: NotRequired[list[str]]   # reply bodies fetched this poll