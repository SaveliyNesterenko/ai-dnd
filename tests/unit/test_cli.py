from __future__ import annotations

import sys
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import pytest

from ai_dnd import cli
from ai_dnd.core.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        data_dir=tmp_path / "runtime",
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'cli.db').as_posix()}",
        web_dist_dir=tmp_path / "web",
    )


def test_cli_migrate_and_show_access(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = _settings(tmp_path)
    migrated: list[Settings] = []
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "run_migrations", migrated.append)

    monkeypatch.setattr(sys, "argv", ["ai-dnd", "migrate"])
    cli.main()
    assert migrated == [settings]

    monkeypatch.setattr(sys, "argv", ["ai-dnd", "show-access", "--json"])
    cli.main()
    output = capsys.readouterr().out
    assert '"gm_url"' in output
    assert '"spectator_code"' in output


def test_cli_serve_is_local_and_opens_bootstrap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    opened: list[str] = []
    uvicorn_calls: list[dict[str, Any]] = []
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "run_migrations", lambda _settings: None)
    monkeypatch.setattr(cli.webbrowser, "open", lambda url: opened.append(url))
    monkeypatch.setattr(
        cli.uvicorn,
        "run",
        lambda *_args, **kwargs: uvicorn_calls.append(kwargs),
    )
    monkeypatch.setattr(sys, "argv", ["ai-dnd", "serve", "--open"])

    cli.main()

    assert opened and opened[0].startswith("http://127.0.0.1:8000/")
    assert uvicorn_calls[0]["host"] == "127.0.0.1"
    assert uvicorn_calls[0]["reload"] is False


def test_cli_import_defaults_to_dry_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    captured: list[Coroutine[Any, Any, None]] = []
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def capture(coroutine: Coroutine[Any, Any, None]) -> None:
        captured.append(coroutine)
        coroutine.close()

    monkeypatch.setattr(cli.asyncio, "run", capture)
    monkeypatch.setattr(
        sys,
        "argv",
        ["ai-dnd", "import-legacy", str(tmp_path)],
    )
    cli.main()
    assert len(captured) == 1
