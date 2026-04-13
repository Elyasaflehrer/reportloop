"""
Entry-point: run the FastAPI / Uvicorn server.

    python scripts/run_api.py

Override host/port via environment variables or .env:
    API_HOST=0.0.0.0  API_PORT=8000
"""

import uvicorn

from question_flow.core.config import settings
from question_flow.core.logging import get_logger

logger = get_logger(__name__)

if __name__ == "__main__":
    logger.info(
        "Starting API server  host=%s  port=%d", settings.api_host, settings.api_port
    )
    uvicorn.run(
        "question_flow.api.app:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
        log_level=settings.log_level.lower(),
        # Use Uvicorn's own access log so every request appears in the log file
        access_log=True,
    )