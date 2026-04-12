"""
Typed error hierarchy for the MCP server.

Tools return structured error responses instead of raising raw exceptions.
This lets the LangGraph agent inspect the error type and decide
whether to retry, reroute, or report — rather than crashing.
"""

from enum import StrEnum


class ErrorCode(StrEnum):
    # Messaging — provider-agnostic (Twilio, SendGrid, Mailgun, Vonage, etc.)
    MESSAGING_RATE_LIMIT        = "messaging_rate_limit"
    MESSAGING_INVALID_RECIPIENT = "messaging_invalid_recipient"
    MESSAGING_DELIVERY_FAILED   = "messaging_delivery_failed"
    CHANNEL_NOT_SUPPORTED       = "channel_not_supported"

    # Database
    DB_WRITE_FAILED      = "db_write_failed"
    DB_DUPLICATE_SESSION = "db_duplicate_session"
    DB_CONNECTION_LOST   = "db_connection_lost"

    # AI — provider-agnostic (OpenAI, Anthropic, Azure, Ollama, etc.)
    AI_TIMEOUT          = "ai_timeout"
    AI_RATE_LIMIT       = "ai_rate_limit"
    AI_INVALID_RESPONSE = "ai_invalid_response"

    # Validation
    INVALID_INPUT          = "invalid_input"
    MISSING_REQUIRED_FIELD = "missing_required_field"

    # General
    UNEXPECTED_ERROR = "unexpected_error"


class MCPToolError(Exception):
    """
    Base exception for all MCP tool failures.
    Raised internally; converted to a structured dict before being returned.
    """

    def __init__(self, code: ErrorCode, message: str, retryable: bool = False) -> None:
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)

    def to_dict(self) -> dict:
        return {
            "success":   False,
            "error":     self.code,
            "message":   self.message,
            "retryable": self.retryable,
        }


class MessagingError(MCPToolError):
    """Raised by any messaging provider — Twilio, SendGrid, Mailgun, etc."""
    pass


class DatabaseError(MCPToolError):
    pass


class AIError(MCPToolError):
    """Raised by any AI provider — OpenAI, Anthropic, Azure, Ollama, etc."""
    pass


class ValidationError(MCPToolError):
    def __init__(self, message: str) -> None:
        super().__init__(
            code=ErrorCode.INVALID_INPUT,
            message=message,
            retryable=False,
        )