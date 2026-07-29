from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from alembic import command
from alembic.config import Config

from ai_dnd.core.settings import Settings


def main() -> None:
    with TemporaryDirectory(prefix="ai-dnd-migration-") as directory:
        database = Path(directory) / "roundtrip.db"
        settings = Settings(
            environment="test",
            data_dir=Path(directory),
            database_url=f"sqlite+aiosqlite:///{database.as_posix()}",
        )
        config = Config()
        config.set_main_option(
            "script_location",
            str(Path(__file__).resolve().parents[1] / "src" / "ai_dnd" / "alembic"),
        )
        config.set_main_option("sqlalchemy.url", settings.effective_database_url)
        command.upgrade(config, "head")
        command.downgrade(config, "base")
        command.upgrade(config, "head")
    print("Alembic upgrade/downgrade round-trip succeeded.")


if __name__ == "__main__":
    main()
