"""
Central configuration loaded once at startup.
All settings come from environment variables — never from hardcoded values.
All fields have defaults so the app starts without a .env file (development mode).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Environment ───────────────────────────────────────
    # development → human-readable console | production → JSON
    mcp_env: str = "development"

    @property
    def is_production(self) -> bool:
        return self.mcp_env == "production"

    # ── Server ────────────────────────────────────────────
    mcp_server_host: str = os.getenv("MCP_SERVER_HOST", "0.0.0.0")
    mcp_server_port: int = os.getenv("MCP_SERVER_PORT", 8000)

    # ── Messaging ─────────────────────────────────────────
    # Provider-agnostic — works with Twilio, SendGrid, Mailgun, etc.
    messaging_provider: str = os.getenv("MESSAGING_PROVIDER", "twilio")
    messaging_api_key: str = os.getenv("MESSAGING_API_KEY", "")
    messaging_api_secret: str = os.getenv("MESSAGING_API_SECRET", "")
    messaging_from: str = os.getenv("MESSAGING_FROM", "")

    # ── OpenAI ────────────────────────────────────────────
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")

    # ── Database ──────────────────────────────────────────
    database_url: str = os.getenv("DATABASE_URL", "postgresql://localhost/reportloop")

    # ── Reliability ───────────────────────────────────────
    max_retry_attempts: int = os.getenv("MAX_RETRY_ATTEMPTS", 3)
    retry_wait_min: int = os.getenv("RETRY_WAIT_MIN", 1)
    retry_wait_max: int = os.getenv("RETRY_WAIT_MAX", 10)
    db_pool_min: int = os.getenv("DB_POOL_MIN", 2)
    db_pool_max: int = os.getenv("DB_POOL_MAX", 10)
    messaging_concurrency_limit: int = os.getenv("MESSAGING_CONCURRENCY_LIMIT", 5)


# Single instance imported across the app
settings = Settings()

if __name__ == "__main__":
    print(settings)