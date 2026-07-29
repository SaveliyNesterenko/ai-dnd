from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProblemDetails(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str
    code: str
    request_id: str
    field_errors: dict[str, list[str]] | None = None


class InventoryItem(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=160)
    quantity: int = Field(default=1, ge=0, le=1_000_000)
    description: str = Field(default="", max_length=4_000)


class CharacterPublic(BaseModel):
    id: str
    slug: str
    name: str
    kind: str
    role: str
    biography: str
    sprite_url: str | None = None
    flip_x: bool
    is_active: bool
    hp_current: int
    hp_max: int
    mp_current: int
    mp_max: int
    attributes: dict[str, int]
    inventory: list[InventoryItem]
    status_effects: list[str]
    revision: int


class CharacterGM(CharacterPublic):
    model_id: str | None = None
    voice_asset_id: str | None = None
    private_notes: list[str]


class CampaignSummary(BaseModel):
    id: str
    slug: str
    name: str
    revision: int
    is_active: bool


class TurnView(BaseModel):
    id: str
    sequence: int
    character_id: str | None
    actor_name: str
    actor_role: str
    thought: str | None
    action: str
    dice_roll: int | None
    audio_url: str | None
    created_at: datetime


class GameEventView(BaseModel):
    id: str
    title: str
    status: str
    revision: int
    turns: list[TurnView]


class GameStateSnapshot(BaseModel):
    campaign: CampaignSummary
    world_state: dict[str, Any]
    global_chronicle: list[str] | None = None
    active_event: GameEventView | None
    characters: list[CharacterPublic | CharacterGM]
    last_sequence: int


class CreateCampaignRequest(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")
    name: str = Field(min_length=2, max_length=160)


class StartEventRequest(BaseModel):
    title: str = Field(default="Game event", min_length=1, max_length=200)


class CreateTurnRequest(BaseModel):
    character_id: str | None = None
    actor_name: str = Field(min_length=1, max_length=160)
    actor_role: str = Field(min_length=1, max_length=64)
    thought: str | None = Field(default=None, max_length=30_000)
    action: str = Field(min_length=1, max_length=30_000)
    dice_roll: int | None = Field(default=None, ge=1, le=20)


class SetResourceOperation(BaseModel):
    op: Literal["set_resource"]
    character_id: str
    resource: Literal["hp", "mp"]
    current: int = Field(ge=0, le=1_000_000)
    maximum: int | None = Field(default=None, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def current_must_fit_maximum(self) -> SetResourceOperation:
        if self.maximum is not None and self.current > self.maximum:
            raise ValueError("current cannot exceed maximum")
        return self


class SetAttributeOperation(BaseModel):
    op: Literal["set_attribute"]
    character_id: str
    attribute: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
    value: int = Field(ge=-1_000_000, le=1_000_000)


class AddInventoryItemOperation(BaseModel):
    op: Literal["add_inventory_item"]
    character_id: str
    item: InventoryItem


class UpdateInventoryItemOperation(BaseModel):
    op: Literal["update_inventory_item"]
    character_id: str
    item_id: str
    name: str | None = Field(default=None, min_length=1, max_length=160)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    description: str | None = Field(default=None, max_length=4_000)

    @model_validator(mode="after")
    def at_least_one_change(self) -> UpdateInventoryItemOperation:
        if self.name is None and self.quantity is None and self.description is None:
            raise ValueError("at least one inventory field must be provided")
        return self


class RemoveInventoryItemOperation(BaseModel):
    op: Literal["remove_inventory_item"]
    character_id: str
    item_id: str


class AddStatusEffectOperation(BaseModel):
    op: Literal["add_status_effect"]
    character_id: str
    name: str = Field(min_length=1, max_length=160)


class RemoveStatusEffectOperation(BaseModel):
    op: Literal["remove_status_effect"]
    character_id: str
    status_effect_id: str


ObserverOperation = Annotated[
    SetResourceOperation
    | SetAttributeOperation
    | AddInventoryItemOperation
    | UpdateInventoryItemOperation
    | RemoveInventoryItemOperation
    | AddStatusEffectOperation
    | RemoveStatusEffectOperation,
    Field(discriminator="op"),
]


class CreateObserverProposalRequest(BaseModel):
    turn_id: str
    gm_brief: str = Field(min_length=1, max_length=30_000)
    base_revision: int = Field(ge=1)
    operations: list[ObserverOperation] = Field(max_length=100)


class ApplyObserverProposalRequest(BaseModel):
    operations: list[ObserverOperation] = Field(max_length=100)


class ObserverProposalView(BaseModel):
    id: str
    campaign_id: str
    event_id: str
    turn_id: str
    gm_brief: str
    base_revision: int
    operations: list[dict[str, Any]]
    status: str
    created_at: datetime
    resolved_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class PlayerTurnOutput(BaseModel):
    thought: str | None = Field(default=None, max_length=30_000)
    action: str = Field(min_length=1, max_length=30_000)


class ObserverOutput(BaseModel):
    gm_brief: str = Field(min_length=1, max_length=30_000)
    operations: list[ObserverOperation] = Field(max_length=100)


class RealtimeEvent(BaseModel):
    event_id: str
    campaign_id: str
    sequence: int
    type: str
    occurred_at: datetime
    payload: dict[str, Any]


class BackgroundJobView(BaseModel):
    id: str
    campaign_id: str | None
    kind: str
    status: str
    output_data: dict[str, Any] | None
    error_code: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class GenerateTurnJobRequest(BaseModel):
    event_id: str
    character_id: str


class GenerateObserverJobRequest(BaseModel):
    event_id: str
    turn_id: str
    model_id: str | None = None


class CapabilityView(BaseModel):
    llm_enabled: bool
    stt_enabled: bool
    tts_enabled: bool


class LegacyImportRequest(BaseModel):
    source_dir: str
    dry_run: bool = True

    @field_validator("source_dir")
    @classmethod
    def non_empty_source(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source_dir cannot be empty")
        return value


class LegacyImportReport(BaseModel):
    source_dir: str
    dry_run: bool
    characters: int
    active_characters: int
    locations: int
    events: int
    missing_assets: list[str]
    warnings: list[str]
    campaign_id: str | None = None
    backup_dir: str | None = None


class LegacyExportV1(BaseModel):
    schema_version: Literal[1] = 1
    exported_at: datetime
    campaign: dict[str, Any]
    characters: list[dict[str, Any]]
    events: list[dict[str, Any]]
