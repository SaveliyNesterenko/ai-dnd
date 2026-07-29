from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import webbrowser
from datetime import UTC, datetime
from pathlib import Path

import uvicorn

from ai_dnd.application.legacy import LegacyDataService
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.database import create_engine, create_session_factory
from ai_dnd.infrastructure.models import Base
from ai_dnd.infrastructure.security import SecurityManager
from ai_dnd.migrations import run_migrations


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai-dnd")
    subparsers = parser.add_subparsers(dest="command", required=True)

    serve = subparsers.add_parser("serve", help="Run the local AI-DND server.")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    serve.add_argument("--lan", action="store_true")
    serve.add_argument("--open", action="store_true", dest="open_browser")
    serve.add_argument("--reload", action="store_true")

    subparsers.add_parser("migrate", help="Apply database migrations.")
    access = subparsers.add_parser("show-access", help="Show local GM and spectator access data.")
    access.add_argument("--json", action="store_true", dest="as_json")

    legacy_import = subparsers.add_parser("import-legacy", help="Import legacy JSON data.")
    legacy_import.add_argument("source", type=Path)
    legacy_import.add_argument("--apply", action="store_true")
    legacy_import.add_argument("--name", default=None)

    legacy_sync = subparsers.add_parser(
        "sync-legacy",
        help="Synchronize assets and character memory into an already imported campaign.",
    )
    legacy_sync.add_argument("campaign_id")
    legacy_sync.add_argument("source", type=Path)
    legacy_sync.add_argument("--apply", action="store_true")
    return parser


async def _import_legacy(
    settings: Settings,
    source: Path,
    *,
    apply: bool,
    name: str | None,
) -> None:
    settings.ensure_directories()
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = create_session_factory(engine)
    async with factory() as session:
        report = await LegacyDataService(session, settings).import_source(
            source,
            dry_run=not apply,
            campaign_name=name,
        )
    await engine.dispose()
    print(report.model_dump_json(indent=2))


async def _sync_legacy(
    settings: Settings,
    campaign_id: str,
    source: Path,
    *,
    apply: bool,
) -> None:
    settings.ensure_directories()
    if apply and settings.database_url is None:
        database_path = settings.data_dir / "ai-dnd.db"
        if database_path.is_file():
            backup = (
                settings.data_dir
                / "backups"
                / f"pre-legacy-sync-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.db"
            )
            shutil.copy2(database_path, backup)
    engine = create_engine(settings)
    factory = create_session_factory(engine)
    async with factory() as session:
        report = await LegacyDataService(session, settings).sync_campaign(
            campaign_id,
            source,
            dry_run=not apply,
        )
    await engine.dispose()
    print(report.model_dump_json(indent=2))


def main() -> None:
    args = _parser().parse_args()
    overrides: dict[str, object] = {}
    if getattr(args, "host", None):
        overrides["host"] = args.host
    if getattr(args, "port", None):
        overrides["port"] = args.port
    if getattr(args, "lan", False):
        overrides["lan_mode"] = True
        overrides.setdefault("host", "0.0.0.0")  # noqa: S104 - explicit opt-in LAN mode
    settings = Settings().model_copy(update=overrides)
    settings.validate_runtime()
    settings.ensure_directories()

    if args.command == "migrate":
        run_migrations(settings)
        return
    if args.command == "show-access":
        security = SecurityManager(settings.data_dir)
        payload = {
            "gm_url": (
                f"http://127.0.0.1:{settings.port}/api/v1/auth/gm/bootstrap"
                f"?token={security.bootstrap_token}"
            ),
            "spectator_code": security.spectator_code,
        }
        if args.as_json:
            print(json.dumps(payload, indent=2))
        else:
            print(f"GM URL: {payload['gm_url']}")
            print(f"Spectator code: {payload['spectator_code']}")
        return
    if args.command == "import-legacy":
        asyncio.run(
            _import_legacy(
                settings,
                args.source,
                apply=args.apply,
                name=args.name,
            )
        )
        return
    if args.command == "sync-legacy":
        run_migrations(settings)
        asyncio.run(
            _sync_legacy(
                settings,
                args.campaign_id,
                args.source,
                apply=args.apply,
            )
        )
        return
    if args.command == "serve":
        run_migrations(settings)
        security = SecurityManager(settings.data_dir)
        gm_url = (
            f"http://127.0.0.1:{settings.port}/api/v1/auth/gm/bootstrap"
            f"?token={security.bootstrap_token}"
        )
        print(f"GM URL: {gm_url}")
        print(f"Spectator code: {security.spectator_code}")
        if args.open_browser:
            webbrowser.open(gm_url)
        uvicorn.run(
            "ai_dnd.main:app",
            host=settings.host,
            port=settings.port,
            reload=args.reload,
            env_file=None,
            access_log=False,
        )
