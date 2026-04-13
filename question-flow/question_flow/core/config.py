"""
Central configuration loaded from environment variables / .env file.
All tuneable knobs live here so nothing is hardcoded elsewhere.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Twilio ────────────────────────────────────────────────────────────────
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # ── Workflow ──────────────────────────────────────────────────────────────
    # How many reminder messages to send before giving up
    max_reminders: int = 3
    # Seconds to wait between a send and the next reminder check
    reminder_interval_seconds: int = 3600  # 1 hour
    # Max recycle loops (partial-answer re-sends) before giving up
    max_cycles: int = 5

    # ── API server ────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # ── MCP server ────────────────────────────────────────────────────────────
    mcp_host: str = "0.0.0.0"
    mcp_port: int = 8001

    # ── Database (future feature) ─────────────────────────────────────────────
    # Set db_enabled=true and supply database_url to activate persistence.
    db_enabled: bool = False
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost/question_flow"

    # ── Logging ───────────────────────────────────────────────────────────────
    log_level: str = "DEBUG"
    log_file: str = "question_flow.log"


settings = Settings()