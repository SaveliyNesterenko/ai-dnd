# ruff: noqa: RUF001
"""Собрать воспроизводимый публичный ZIP кампании AI-DND из закрытой исходной папки."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from ai_dnd.application.campaign_pack import REQUIRED_DOCUMENTS, inspect_campaign_pack


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Закрытая папка с manifest.json и assets/")
    parser.add_argument("output", type=Path, help="Путь для итогового ZIP")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_dir():
        parser.error(f"Исходная папка не существует: {source}")
    required = REQUIRED_DOCUMENTS | {"manifest.json"}
    missing = [name for name in sorted(required) if not (source / name).is_file()]
    if missing:
        parser.error(f"Отсутствуют обязательные файлы: {', '.join(missing)}")
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for asset in manifest.get("assets", []):
        path = source / str(asset.get("path", ""))
        if not path.is_file():
            parser.error(f"Отсутствует ассет: {path}")
        asset["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    document_names = REQUIRED_DOCUMENTS | {"GM_GUIDE.md"}
    files = [source / name for name in sorted(document_names) if (source / name).is_file()]
    files.extend(source / str(asset["path"]) for asset in manifest.get("assets", []))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        manifest_info = zipfile.ZipInfo("manifest.json", date_time=(2020, 1, 1, 0, 0, 0))
        manifest_info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(manifest_info, manifest_bytes)
        for path in sorted(set(files)):
            if path == manifest_path:
                continue
            info = zipfile.ZipInfo(
                path.relative_to(source).as_posix(), date_time=(2020, 1, 1, 0, 0, 0)
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    # Проверяем именно те байты, которые будут опубликованы.
    inspect_campaign_pack(args.output.read_bytes())
    checksum = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix(args.output.suffix + ".sha256").write_text(
        f"{checksum}  {args.output.name}\n", encoding="ascii"
    )


if __name__ == "__main__":
    main()
