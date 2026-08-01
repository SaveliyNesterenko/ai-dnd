# ruff: noqa: RUF002
from __future__ import annotations

import os

from ai_dnd.core.settings import Settings


def test_settings_in_tests_ignore_developer_env() -> None:
    """Страховка на изоляцию из conftest.

    Без неё `.env` разработчика включает LLM и STT, и проверки отключённых
    возможностей начинают падать только на его машине.
    """
    settings = Settings()

    assert settings.openai_api_key is None
    assert settings.stt_api_key is None
    assert not [name for name in os.environ if name.upper().startswith("AI_DND_")]


def test_settings_defaults_are_loopback_only() -> None:
    settings = Settings()

    settings.validate_runtime()
    assert settings.host == "127.0.0.1"
    assert settings.lan_mode is False


def test_campaign_pack_and_voice_upload_limits_are_independent() -> None:
    settings = Settings(max_upload_bytes=20 * 1024 * 1024, max_campaign_pack_bytes=64 * 1024 * 1024)

    assert settings.max_upload_bytes == 20 * 1024 * 1024
    assert settings.max_campaign_pack_bytes == 64 * 1024 * 1024
    assert settings.max_request_bytes == 64 * 1024 * 1024
