"""
Reusable retry decorators for external service calls.
Built on tenacity — keeps retry logic out of business code.
"""

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from mcp_server.core.config import settings
from mcp_server.core.errors import AIError, DatabaseError, MessagingError, ErrorCode


def messaging_retry(func):
    """Retry messaging provider calls on transient failures with exponential backoff."""
    return retry(
        stop=stop_after_attempt(settings.max_retry_attempts),
        wait=wait_exponential(
            min=settings.retry_wait_min,
            max=settings.retry_wait_max,
        ),
        retry=retry_if_exception_type(MessagingError),
        reraise=True,
    )(func)


def db_retry(func):
    """Retry database calls on connection failures."""
    return retry(
        stop=stop_after_attempt(settings.max_retry_attempts),
        wait=wait_exponential(
            min=settings.retry_wait_min,
            max=settings.retry_wait_max,
        ),
        retry=retry_if_exception_type(DatabaseError),
        reraise=True,
    )(func)


def ai_retry(func):
    """Retry AI provider calls on rate limits and timeouts."""
    return retry(
        stop=stop_after_attempt(settings.max_retry_attempts),
        wait=wait_exponential(
            min=settings.retry_wait_min,
            max=settings.retry_wait_max,
        ),
        retry=retry_if_exception_type(AIError),
        reraise=True,
    )(func)
