from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_DND_",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    lan_mode: bool = False
    log_level: str = "INFO"
    debug_prompts: bool = False
    data_dir: Path = Field(default_factory=lambda: user_data_path("ai-dnd", appauthor=False))
    database_url: str | None = None
    web_dist_dir: Path = PROJECT_ROOT / "web" / "dist"
    demo_assets_dir: Path = PROJECT_ROOT / "demo" / "assets"
    allowed_dev_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, ge=1024)
    max_campaign_pack_bytes: int = Field(default=64 * 1024 * 1024, ge=1024)
    job_concurrency: int = Field(default=2, ge=1, le=8)
    openai_api_key: str | None = None
    openai_base_url: str = "https://routerai.ru/api/v1"
    default_model: str = "deepseek/deepseek-v3.2"
    llm_timeout_seconds: float = Field(default=90.0, ge=1.0, le=300.0)
    stt_api_key: str | None = None
    stt_base_url: str = "https://api.nexara.ru/api/v1"
    stt_timeout_seconds: float = Field(default=60.0, ge=1.0, le=180.0)
    tts_enabled: bool = True
    tts_model: str = "tts_models/multilingual/multi-dataset/xtts_v2"
    tts_language: str = "ru"
    tts_temperature: float = Field(default=0.75, ge=0.0, le=2.0)

    @field_validator("host")
    @classmethod
    def protect_lan_binding(cls, value: str, info: object) -> str:
        return value.strip()

    @property
    def effective_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        database_path = (self.data_dir / "ai-dnd.db").resolve()
        return f"sqlite+aiosqlite:///{database_path.as_posix()}"

    @property
    def max_request_bytes(self) -> int:
        """Общий предел запроса; endpoints загрузки применяют собственные меньшие лимиты."""
        return max(self.max_upload_bytes, self.max_campaign_pack_bytes)

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "assets").mkdir(exist_ok=True)
        (self.data_dir / "generated-audio").mkdir(exist_ok=True)
        (self.data_dir / "exports").mkdir(exist_ok=True)
        (self.data_dir / "backups").mkdir(exist_ok=True)

    def validate_runtime(self) -> None:
        if not self.lan_mode and self.host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Non-loopback binding requires AI_DND_LAN_MODE=true.")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
