from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from ai_dnd.core.settings import Settings
from ai_dnd.integrations import llm as llm_module
from ai_dnd.integrations.llm import (
    DisabledLLMProvider,
    LLMUnavailableError,
    ModelProfile,
    OpenAICompatibleLLMProvider,
)


class FakeCompletions:
    def __init__(self, contents: list[str] | None = None, error: Exception | None = None) -> None:
        self.contents = list(contents or [])
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        content = self.contents.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeOpenAI:
    def __init__(self, completions: FakeCompletions) -> None:
        self.chat = SimpleNamespace(completions=completions)


@pytest.mark.asyncio
async def test_llm_corrects_invalid_json_and_uses_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completions = FakeCompletions(
        [
            '{"thought": 42}',
            '{"thought": "careful", "action": "I inspect the lock."}',
        ]
    )
    monkeypatch.setattr(
        llm_module,
        "OpenAI",
        lambda **_kwargs: FakeOpenAI(completions),
    )
    provider = OpenAICompatibleLLMProvider(
        Settings(openai_api_key="test-key", data_dir="test-data")
    )
    result = await provider.generate_player_turn(
        profile=ModelProfile(model_id="test", supports_json_schema=True),
        system_prompt="Act.",
        prompt="Open the lock.",
    )
    assert result.action == "I inspect the lock."
    assert len(completions.calls) == 2
    assert completions.calls[0]["response_format"]["type"] == "json_schema"
    assert "previous response" in completions.calls[1]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_llm_provider_and_disabled_mode_report_outage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completions = FakeCompletions(error=TimeoutError("provider timeout"))
    monkeypatch.setattr(
        llm_module,
        "OpenAI",
        lambda **_kwargs: FakeOpenAI(completions),
    )
    provider = OpenAICompatibleLLMProvider(
        Settings(openai_api_key="test-key", data_dir="test-data")
    )
    with pytest.raises(LLMUnavailableError):
        await provider.generate_player_turn(
            profile=ModelProfile(model_id="test"),
            system_prompt="Act.",
            prompt="Wait.",
        )

    disabled = DisabledLLMProvider()
    with pytest.raises(LLMUnavailableError):
        await disabled.generate_player_turn(
            profile=ModelProfile(model_id="none"),
            system_prompt="Act.",
            prompt="Wait.",
        )
