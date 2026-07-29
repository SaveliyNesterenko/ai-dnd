from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ai_dnd.core.settings import Settings


@event.listens_for(Engine, "connect")
def configure_sqlite_connection(dbapi_connection: object, _connection_record: object) -> None:
    module_name = dbapi_connection.__class__.__module__
    if "sqlite" not in module_name and "aiosqlite" not in module_name:
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.effective_database_url,
        pool_pre_ping=True,
        echo=settings.environment == "development" and False,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def session_dependency(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with factory() as session:
        yield session
