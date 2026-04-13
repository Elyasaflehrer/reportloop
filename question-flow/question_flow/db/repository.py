"""
Database repository functions.

⚠️  FUTURE FEATURE — not active until db_enabled=True in .env ⚠️

All functions are async and use SQLAlchemy 2.x async sessions.

To activate:
  1. Set db_enabled=True and database_url=<your pg url> in .env
  2. Call init_db() once at startup (in api/app.py lifespan)
  3. Run the schema migration (or create_all shown below)
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from question_flow.core.config import settings
from question_flow.core.logging import get_logger
from question_flow.db.models import AnswerModel, Base, QuestionModel, SessionModel

logger = get_logger(__name__)

# Engine and session factory — initialised lazily by init_db()
_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


async def init_db() -> None:
    """
    Create the async engine, run schema migrations (create_all), and store
    the session factory.  Call once at application startup.
    """
    global _engine, _session_factory  # noqa: PLW0603

    if not settings.db_enabled:
        logger.info("DB disabled — skipping init_db()")
        return

    logger.info("Initialising database  url=%s", settings.database_url)
    _engine = create_async_engine(
        settings.database_url,
        echo=False,        # set True for SQL query logging
        pool_size=5,
        max_overflow=10,
    )
    _session_factory = async_sessionmaker(
        _engine, expire_on_commit=False, class_=AsyncSession
    )

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database initialised")


def _get_session() -> AsyncSession:
    if _session_factory is None:
        raise RuntimeError(
            "Database is not initialised.  "
            "Call init_db() at startup or set db_enabled=False."
        )
    return _session_factory()


# ── Repository operations ─────────────────────────────────────────────────────


async def save_session_answers(
    session_id: str,
    answers: dict[str, str],
) -> None:
    """
    Upsert all collected answers for *session_id* and mark the session completed.

    If the session row doesn't exist yet it is created.  Existing answers for
    the session are deleted and replaced to keep the data consistent.
    """
    sid = uuid.UUID(session_id)

    async with _get_session() as db:
        async with db.begin():
            # Upsert session row
            session_row = await db.get(SessionModel, sid)
            if session_row is None:
                session_row = SessionModel(id=sid, recipient="", platform="", status="completed")
                db.add(session_row)
            else:
                session_row.status = "completed"

            # Replace answers
            for answer in list(session_row.answers):
                await db.delete(answer)

            for question_text, answer_text in answers.items():
                db.add(
                    AnswerModel(
                        session_id=sid,
                        question_text=question_text,
                        answer_text=answer_text,
                    )
                )

    logger.info(
        "DB save_session_answers OK  session=%s  answers=%d",
        session_id, len(answers),
    )


async def get_session_answers(session_id: str) -> dict[str, str]:
    """Retrieve all collected answers for *session_id* from the database."""
    sid = uuid.UUID(session_id)

    async with _get_session() as db:
        session_row = await db.get(SessionModel, sid)
        if session_row is None:
            return {}
        return {a.question_text: a.answer_text for a in session_row.answers}