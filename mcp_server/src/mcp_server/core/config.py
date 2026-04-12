"""
Central configuration loaded once at startup.
All settings come from environment variables — never from hardcoded values.
All fields have defaults so the app starts without a .env file (development mode).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ───────────────────────────────────────
    # development → human-readable console | production → JSON
    mcp_env: str = "development"

    @property
    def is_production(self) -> bool:
        return self.mcp_env == "production"

    # ── Server ────────────────────────────────────────────
    mcp_server_host: str = "0.0.0.0"
    mcp_server_port: int = 8000

    # ── Twilio ────────────────────────────────────────────
    # To add a new provider later, add a new section below this one.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""         # SMS sender number  e.g. +15550000000

    # ── Database ──────────────────────────────────────────
    database_url: str = "postgresql://localhost/reportloop"

    # ── Reliability ───────────────────────────────────────
    max_retry_attempts: int = 3
    retry_wait_min: int = 1
    retry_wait_max: int = 10
    db_pool_min: int = 2
    db_pool_max: int = 10
    messaging_concurrency_limit: int = 5


# Single instance imported across the app
settings = Settings()


if __name__ == "__main__":
    print(settings)