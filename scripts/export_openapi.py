from __future__ import annotations

import json
from pathlib import Path

from ai_dnd.main import create_app


def main() -> None:
    target = Path("docs/openapi.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(create_app().openapi(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
