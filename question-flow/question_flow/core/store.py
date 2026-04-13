"""
In-memory stores shared across the API server and the LangGraph workflow.

Two singletons are exported:
  reply_store   – buffers inbound SMS replies keyed by session_id
  session_store – tracks active sessions and maps phone numbers → session ids

When db_enabled=True these stores should be replaced by / backed by the DB
layer (see question_flow/db/).  For now they are the single source of truth.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from question_flow.core.logging import get_logger

logger = get_logger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class Reply:
    session_id: str
    from_number: str
    body: str
    received_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class SessionRecord:
    session_id: str
    recipient: str
    platform: str
    questions: list[str]
    status: str = "pending"
    answers: dict[str, str] = field(default_factory=dict)
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


# ── Reply store ───────────────────────────────────────────────────────────────


class ReplyStore:
    """
    Thread-safe buffer for inbound SMS replies.

    Each session has an ordered list of replies.  get_new_replies() is
    *consuming*: it advances an internal cursor so the same replies are
    never returned twice within a session's lifetime.
    """

    def __init__(self) -> None:
        self._replies: dict[str, list[Reply]] = {}
        self._cursor: dict[str, int] = {}       # consumed-up-to index
        self._lock = asyncio.Lock()

    async def add_reply(
        self, session_id: str, from_number: str, body: str
    ) -> None:
        async with self._lock:
            self._replies.setdefault(session_id, []).append(
                Reply(session_id=session_id, from_number=from_number, body=body)
            )
            logger.info(
                "Reply stored  session=%s  from=%s  body=%r",
                session_id, from_number, body[:80],
            )

    async def get_new_replies(self, session_id: str) -> list[Reply]:
        """Return only replies that have not been returned before."""
        async with self._lock:
            all_r = self._replies.get(session_id, [])
            cursor = self._cursor.get(session_id, 0)
            new = all_r[cursor:]
            self._cursor[session_id] = len(all_r)
            return list(new)

    async def get_all_replies(self, session_id: str) -> list[Reply]:
        async with self._lock:
            return list(self._replies.get(session_id, []))

    async def clear(self, session_id: str) -> None:
        async with self._lock:
            self._replies.pop(session_id, None)
            self._cursor.pop(session_id, None)


# ── Session store ─────────────────────────────────────────────────────────────


class SessionStore:
    """
    Tracks active sessions and maintains a phone-number → session_id index
    so inbound webhooks can route replies to the correct session.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}
        self._phone_index: dict[str, str] = {}   # phone → session_id
        self._lock = asyncio.Lock()

    async def create(self, record: SessionRecord) -> None:
        async with self._lock:
            self._sessions[record.session_id] = record
            self._phone_index[record.recipient] = record.session_id
            logger.info(
                "Session created  id=%s  recipient=%s  questions=%d",
                record.session_id, record.recipient, len(record.questions),
            )

    async def get(self, session_id: str) -> Optional[SessionRecord]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def get_by_phone(self, phone: str) -> Optional[SessionRecord]:
        async with self._lock:
            sid = self._phone_index.get(phone)
            return self._sessions.get(sid) if sid else None

    async def update_status(self, session_id: str, status: str) -> None:
        async with self._lock:
            rec = self._sessions.get(session_id)
            if rec:
                rec.status = status
                rec.updated_at = datetime.utcnow()

    async def update_answers(
        self, session_id: str, answers: dict[str, str]
    ) -> None:
        async with self._lock:
            rec = self._sessions.get(session_id)
            if rec:
                rec.answers = answers
                rec.updated_at = datetime.utcnow()

    async def update_error(self, session_id: str, error: str) -> None:
        async with self._lock:
            rec = self._sessions.get(session_id)
            if rec:
                rec.error = error
                rec.updated_at = datetime.utcnow()

    async def list_all(self) -> list[SessionRecord]:
        """Return a snapshot of all tracked sessions."""
        async with self._lock:
            return list(self._sessions.values())

    async def remove(self, session_id: str) -> None:
        async with self._lock:
            rec = self._sessions.pop(session_id, None)
            if rec:
                self._phone_index.pop(rec.recipient, None)


# ── Module-level singletons ───────────────────────────────────────────────────

reply_store = ReplyStore()
session_store = SessionStore()