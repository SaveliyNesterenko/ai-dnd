# ruff: noqa: RUF002
from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.application.demo import seed_demo_if_empty
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.database import create_engine, create_session_factory
from ai_dnd.infrastructure.models import Base
from ai_dnd.main import create_app


@pytest.fixture(autouse=True)
def isolated_settings_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Отвязывает Settings от окружения разработчика.

    Settings читает `.env` из корня проекта и переменные `AI_DND_*`, поэтому
    без изоляции результат тестов зависит от того, какие ключи прописаны на
    конкретной машине: с заполненным `.env` провайдеры LLM и STT включаются и
    проверки отключённых возможностей падают. Тесты должны видеть только те
    значения, которые задают сами.
    """
    for name in list(os.environ):
        if name.upper().startswith("AI_DND_"):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        data_dir=tmp_path / "runtime",
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        web_dist_dir=tmp_path / "missing-web-dist",
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def authenticated_client(client: TestClient) -> TestClient:
    token = client.app.state.security.bootstrap_token
    response = client.get(
        f"/api/v1/auth/gm/bootstrap?token={token}",
        follow_redirects=False,
    )
    assert response.status_code == 303
    return client


@pytest.fixture
def demo_campaign_id(client: TestClient) -> str:
    response = client.get("/api/v1/campaigns")
    assert response.status_code == 200
    campaigns = response.json()
    assert len(campaigns) == 1
    return str(campaigns[0]["id"])


@pytest_asyncio.fixture
async def repository_session(settings: Settings) -> AsyncIterator[AsyncSession]:
    settings.ensure_directories()
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = create_session_factory(engine)
    async with factory() as session:
        await seed_demo_if_empty(session)
        yield session
    await engine.dispose()
