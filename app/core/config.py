from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'Guilua Communication Runtime'
    app_env: str = 'development'
    debug: bool = True
    secret_key: str = Field(default='dev-only-change-me')
    deployment_version: str = 'development'
    public_base_url: str = 'http://127.0.0.1:8000'

    timeblock_api_url: str | None = None
    timeblock_api_key: str | None = None
    timeblock_timeout_seconds: float = Field(default=5.0, gt=0, le=30)

    allowed_websocket_origins: str = 'http://127.0.0.1:8000,http://localhost:8000'
    allow_missing_websocket_origin: bool = True
    connection_stale_seconds: int = Field(default=120, ge=10, le=3600)
    reconnect_token_seconds: int = Field(default=300, ge=30, le=3600)
    ended_session_cache_seconds: int = Field(default=600, ge=30, le=86400)
    idempotency_cache_seconds: int = Field(default=1800, ge=60, le=86400)
    max_room_participants: int = Field(default=2, ge=2, le=2)
    max_event_bytes: int = Field(default=131072, ge=1024, le=1048576)
    event_rate_limit_count: int = Field(default=120, ge=10, le=1000)
    event_rate_limit_window_seconds: int = Field(default=60, ge=1, le=300)
    signaling_rate_limit_count: int = Field(default=40, ge=5, le=500)
    heartbeat_rate_limit_count: int = Field(default=20, ge=2, le=120)

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == 'production' or not self.debug

    @property
    def websocket_origins(self) -> set[str]:
        return {item.strip() for item in self.allowed_websocket_origins.split(',') if item.strip()}

    @model_validator(mode='after')
    def validate_production_settings(self):
        if self.is_production and self.secret_key in {'', 'change-me', 'dev-only-change-me'}:
            raise ValueError('SECRET_KEY must be set to a strong value in production')
        if self.is_production and self.allow_missing_websocket_origin:
            self.allow_missing_websocket_origin = False
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
