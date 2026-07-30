from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Guilua Communication Runtime"
    app_env: str = "development"
    debug: bool = True
    secret_key: str = Field(default="dev-only-change-me")
    public_base_url: str = "http://127.0.0.1:8000"
    timeblock_api_url: str | None = None
    timeblock_api_key: str | None = None
    allowed_websocket_origins: str = "http://127.0.0.1:8000,http://localhost:8000"
    connection_stale_seconds: int = 120
    reconnect_token_seconds: int = 300
    ended_session_cache_seconds: int = 600
    idempotency_cache_seconds: int = 1800

    @model_validator(mode="after")
    def validate_production_settings(self):
        is_production = self.app_env.lower() == "production" or not self.debug
        if is_production and self.secret_key in {"", "change-me", "dev-only-change-me"}:
            raise ValueError("SECRET_KEY must be set to a strong value in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
