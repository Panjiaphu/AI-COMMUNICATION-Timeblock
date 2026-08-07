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
    allow_development_session_fallback: bool = False

    allowed_websocket_origins: str = 'http://127.0.0.1:8000,http://localhost:8000'
    allowed_timeblock_handoff_origins: str = 'http://127.0.0.1:5000,http://localhost:5000'
    allow_missing_websocket_origin: bool = True
    websocket_auth_timeout_seconds: float = Field(default=5.0, gt=0.5, le=30)
    max_auth_event_bytes: int = Field(default=16384, ge=1024, le=65536)
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
        return self.app_env.strip().lower() == 'production' or not self.debug

    @property
    def development_session_fallback_enabled(self) -> bool:
        return (
            not self.is_production
            and self.app_env.strip().lower() in {'development', 'test'}
            and self.allow_development_session_fallback
            and not self.timeblock_api_url
        )

    @property
    def websocket_origins(self) -> set[str]:
        return {item.strip().rstrip('/') for item in self.allowed_websocket_origins.split(',') if item.strip()}

    @property
    def timeblock_handoff_origins(self) -> set[str]:
        return {item.strip().rstrip('/') for item in self.allowed_timeblock_handoff_origins.split(',') if item.strip()}

    @property
    def development_query_handoff_enabled(self) -> bool:
        return self.development_session_fallback_enabled

    @model_validator(mode='after')
    def validate_production_settings(self):
        if self.is_production and self.secret_key in {'', 'change-me', 'dev-only-change-me'}:
            raise ValueError('SECRET_KEY must be set to a strong value in production')
        if self.is_production and self.allow_development_session_fallback:
            raise ValueError('ALLOW_DEVELOPMENT_SESSION_FALLBACK must be false in production')
        if self.is_production and self.allow_missing_websocket_origin:
            self.allow_missing_websocket_origin = False
        if self.is_production and not self.websocket_origins:
            raise ValueError('ALLOWED_WEBSOCKET_ORIGINS must be configured in production')
        if self.is_production and not self.timeblock_handoff_origins:
            raise ValueError('ALLOWED_TIMEBLOCK_HANDOFF_ORIGINS must be configured in production')
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
