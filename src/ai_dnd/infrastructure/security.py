from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import cast


class SecurityManager:
    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "security.json"
        state = self._load_or_create()
        self.bootstrap_token = state["bootstrap_token"]
        self.spectator_code = state["spectator_code"]
        self._secret = bytes.fromhex(state["session_secret"])

    def _load_or_create(self) -> dict[str, str]:
        if self._path.is_file():
            raw_value = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(raw_value, dict) and all(
                isinstance(raw_value.get(key), str)
                for key in ("bootstrap_token", "spectator_code", "session_secret")
            ):
                return cast(dict[str, str], raw_value)
        value = {
            "bootstrap_token": secrets.token_urlsafe(24),
            "spectator_code": f"{secrets.randbelow(1_000_000):06d}",
            "session_secret": secrets.token_hex(32),
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._write_state(value)
        return value

    def _write_state(self, value: dict[str, str]) -> None:
        temporary = self._path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
        temporary.replace(self._path)

    def issue_gm_session(self, *, lifetime_seconds: int = 12 * 60 * 60) -> str:
        expires_at = int(time.time()) + lifetime_seconds
        payload = f"gm.{expires_at}"
        signature = hmac.new(self._secret, payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}.{signature}"

    def verify_gm_session(self, token: str | None) -> bool:
        if not token:
            return False
        try:
            role, expires_raw, signature = token.split(".", 2)
            expires_at = int(expires_raw)
        except (ValueError, TypeError):
            return False
        if role != "gm" or expires_at < int(time.time()):
            return False
        payload = f"{role}.{expires_at}"
        expected = hmac.new(self._secret, payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)

    def verify_bootstrap(self, token: str) -> bool:
        return hmac.compare_digest(token, self.bootstrap_token)

    def consume_bootstrap(self, token: str) -> bool:
        if not self.verify_bootstrap(token):
            return False
        state = {
            "bootstrap_token": secrets.token_urlsafe(24),
            "spectator_code": self.spectator_code,
            "session_secret": self._secret.hex(),
        }
        self._write_state(state)
        self.bootstrap_token = state["bootstrap_token"]
        return True

    def verify_spectator_code(self, code: str | None) -> bool:
        return code is not None and hmac.compare_digest(code, self.spectator_code)
