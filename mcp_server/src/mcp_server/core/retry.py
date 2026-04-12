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
from mcp_server.core.errors import ErrorCode
from mcp_server.core.config import settings
from mcp_server.core.errors import DatabaseError, LLMError, TwilioError


def twilio_retry(func):
    """Retry Twilio calls on transient failures with exponential backoff."""
    return retry(
        stop=stop_after_attempt(settings.max_retry_attempts),
        wait=wait_exponential(
            min=settings.retry_wait_min,
            max=settings.retry_wait_max,
        ),
        retry=retry_if_exception_type(TwilioError),
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


def llm_retry(func):
    """Retry LLM calls on rate limits and timeouts."""
    return retry(
        stop=stop_after_attempt(settings.max_retry_attempts),
        wait=wait_exponential(
            min=settings.retry_wait_min,
            max=settings.retry_wait_max,
        ),
        retry=retry_if_exception_type(LLMError),
        reraise=True,
    )(func)