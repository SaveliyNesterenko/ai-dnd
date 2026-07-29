from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Protocol, TypeVar

from openai import OpenAI
from openai.types.chat import (
    ChatCompletion,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from openai.types.shared_params import ResponseFormatJSONObject, ResponseFormatJSONSchema
from pydantic import BaseModel, ValidationError

from ai_dnd.api.schemas import (
    ArchivistOutput,
    ContextSummaryOutput,
    ObserverOutput,
    PlayerRecollectionOutput,
    PlayerTurnOutput,
)
from ai_dnd.core.settings import Settings

T = TypeVar("T", bound=BaseModel)


class LLMUnavailableError(RuntimeError):
    pass


class LLMInvalidResponseError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ModelProfile:
    model_id: str
    supports_json_schema: bool = False
    temperature: float = 0.7


class LLMProvider(Protocol):
    async def generate_player_turn(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerTurnOutput: ...

    async def generate_observer_proposal(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ObserverOutput: ...

    async def generate_archivist_result(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ArchivistOutput: ...

    async def generate_player_recollection(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerRecollectionOutput: ...

    async def generate_context_summary(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ContextSummaryOutput: ...


class DisabledLLMProvider:
    async def generate_player_turn(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerTurnOutput:
        raise LLMUnavailableError("LLM integration is disabled: no API key is configured.")

    async def generate_observer_proposal(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ObserverOutput:
        raise LLMUnavailableError("LLM integration is disabled: no API key is configured.")

    async def generate_archivist_result(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ArchivistOutput:
        raise LLMUnavailableError("LLM integration is disabled: no API key is configured.")

    async def generate_player_recollection(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerRecollectionOutput:
        raise LLMUnavailableError("LLM integration is disabled: no API key is configured.")

    async def generate_context_summary(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ContextSummaryOutput:
        raise LLMUnavailableError("LLM integration is disabled: no API key is configured.")


class OpenAICompatibleLLMProvider:
    def __init__(self, settings: Settings) -> None:
        if not settings.openai_api_key:
            raise ValueError("openai_api_key is required")
        self._client = OpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
            max_retries=1,
        )

    async def generate_player_turn(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerTurnOutput:
        return await self._generate(
            output_type=PlayerTurnOutput,
            profile=profile,
            system_prompt=system_prompt,
            prompt=prompt,
        )

    async def generate_observer_proposal(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ObserverOutput:
        return await self._generate(
            output_type=ObserverOutput,
            profile=profile,
            system_prompt=system_prompt,
            prompt=prompt,
        )

    async def generate_archivist_result(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ArchivistOutput:
        return await self._generate(
            output_type=ArchivistOutput,
            profile=profile,
            system_prompt=system_prompt,
            prompt=prompt,
        )

    async def generate_player_recollection(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> PlayerRecollectionOutput:
        return await self._generate(
            output_type=PlayerRecollectionOutput,
            profile=profile,
            system_prompt=system_prompt,
            prompt=prompt,
        )

    async def generate_context_summary(
        self, *, profile: ModelProfile, system_prompt: str, prompt: str
    ) -> ContextSummaryOutput:
        return await self._generate(
            output_type=ContextSummaryOutput,
            profile=profile,
            system_prompt=system_prompt,
            prompt=prompt,
        )

    async def _generate(
        self,
        *,
        output_type: type[T],
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> T:
        corrective_suffix = ""
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response_format: ResponseFormatJSONSchema | ResponseFormatJSONObject
                if profile.supports_json_schema:
                    response_format = {
                        "type": "json_schema",
                        "json_schema": {
                            "name": output_type.__name__,
                            "strict": True,
                            "schema": output_type.model_json_schema(),
                        },
                    }
                else:
                    response_format = {"type": "json_object"}

                def invoke(
                    format_value: ResponseFormatJSONSchema
                    | ResponseFormatJSONObject = response_format,
                    suffix: str = corrective_suffix,
                ) -> ChatCompletion:
                    messages: list[ChatCompletionMessageParam] = [
                        ChatCompletionSystemMessageParam(
                            role="system",
                            content=system_prompt,
                        ),
                        ChatCompletionUserMessageParam(
                            role="user",
                            content=(
                                prompt
                                + suffix
                                + "\nReturn only one JSON object matching the requested schema."
                            ),
                        ),
                    ]
                    response_value = self._client.chat.completions.create(
                        model=profile.model_id,
                        temperature=profile.temperature,
                        response_format=format_value,
                        messages=messages,
                    )
                    return response_value

                response = await asyncio.to_thread(invoke)
                content = response.choices[0].message.content
                if not content:
                    raise LLMInvalidResponseError("Provider returned an empty response.")
                return output_type.model_validate(json.loads(content))
            except (json.JSONDecodeError, ValidationError, LLMInvalidResponseError) as error:
                last_error = error
                corrective_suffix = (
                    "\nYour previous response did not match the schema. Correct the structure, "
                    "types, and required fields."
                )
                if attempt < 2:
                    continue
            except Exception as error:
                raise LLMUnavailableError("LLM provider request failed.") from error
        raise LLMInvalidResponseError("LLM returned invalid structured output.") from last_error


def create_llm_provider(settings: Settings) -> LLMProvider:
    if not settings.openai_api_key:
        return DisabledLLMProvider()
    return OpenAICompatibleLLMProvider(settings)
