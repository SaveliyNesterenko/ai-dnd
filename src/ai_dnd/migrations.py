from pathlib import Path

from alembic import command
from alembic.config import Config

from ai_dnd.core.settings import Settings


def run_migrations(settings: Settings) -> None:
    config = Config()
    config.set_main_option(
        "script_location",
        str(Path(__file__).resolve().parent / "alembic"),
    )
    config.set_main_option("sqlalchemy.url", settings.effective_database_url)
    command.upgrade(config, "head")
