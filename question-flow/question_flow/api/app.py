"""
FastAPI application factory.

Mounts:
  /sessions   — workflow session CRUD (see routes/sessions.py)
  /webhook    — inbound platform webhooks (see routes/webhooks.py)
  /health     — liveness / readiness check
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from question_flow.api.routes.questions import router as questions_router
from question_flow.api.routes.sessions import router as sessions_router
from question_flow.api.routes.webhooks import router as webhooks_router
from question_flow.core.logging import get_logger

logger = get_logger(__name__)


# ── Lifespan ──────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup / shutdown logic."""
    logger.info("QuestionFlow API server starting up")
    # Future: open DB connection pool here when db_enabled=True
    yield
    logger.info("QuestionFlow API server shutting down")


# ── Application factory ───────────────────────────────────────────────────────


def create_app() -> FastAPI:
    app = FastAPI(
        title="QuestionFlow API",
        description=(
            "REST interface for the LangGraph question-answer workflow.\n\n"
            "Create a session with a list of questions and a recipient phone "
            "number.  The system sends the questions via SMS, collects answers, "
            "and retries with reminders if no response is received."
        ),
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Allow all origins in development; tighten in production.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(questions_router)   # simple /questions interface
    app.include_router(sessions_router)    # full session CRUD
    app.include_router(webhooks_router)    # inbound platform webhooks

    # Health endpoints
    @app.get("/health", tags=["meta"], summary="Liveness check")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/health/platforms", tags=["meta"], summary="Platform readiness check")
    async def platform_health() -> dict:
        from question_flow.mcp_server.platforms import (  # noqa: PLC0415
            _REGISTRY, list_platforms,
        )

        results: dict[str, bool] = {}
        for name, platform in _REGISTRY.items():
            results[name] = await platform.health_check()

        all_healthy = all(results.values())
        return {
            "status": "ok" if all_healthy else "degraded",
            "platforms": results,
        }

    logger.info("FastAPI app created  routes=%d", len(app.routes))
    return app


# Module-level app instance (used by Uvicorn)
app = create_app()