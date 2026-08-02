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
    kind: Literal["player", "npc", "enemy"]
    role: str
    biography: str
    model_id: str | None = None
    portrait_url: str | None = None
    avatar_url: str | None = None
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
    voice_asset_id: str | None = None
    global_chronicle: list[str]
    private_notes: list[str]


class CampaignSummary(BaseModel):
    id: str
    slug: str
    name: str
    revision: int
    is_active: bool
    speech_enabled: bool
    speech_speak_thoughts: bool


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
    thought_audio_url: str | None
    action_audio_url: str | None
    created_at: datetime


class GameEventView(BaseModel):
    id: str
    title: str
    status: str
    revision: int
    participant_ids: list[str]
    finalization_job_id: str | None = None
    context_summary: str | None = None
    context_summary_through_sequence: int | None = None
    turns: list[TurnView]


class LocationView(BaseModel):
    id: str
    slug: str
    name: str
    image_url: str


class MusicTrackView(BaseModel):
    id: str
    slug: str
    name: str
    audio_url: str


class SceneCharacterView(BaseModel):
    character_id: str
    is_visible: bool
    x: int = Field(ge=0, le=100)
    y: int = Field(ge=0, le=100)
    order: int
    flip_x: bool
    scale: int = Field(ge=25, le=250)
    revision: int


class SceneView(BaseModel):
    location_id: str | None
    music_track_id: str | None
    music_is_playing: bool
    music_volume: int = Field(ge=0, le=100)
    avatar_size: int = Field(ge=80, le=600)
    revision: int
    locations: list[LocationView]
    music_tracks: list[MusicTrackView]
    characters: list[SceneCharacterView]


class GameStateSnapshot(BaseModel):
    campaign: CampaignSummary
    world_state: dict[str, Any]
    global_chronicle: list[str] | None = None
    scene: SceneView
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
    roll_dice: bool = False
    dice_roll: int | None = Field(default=None, ge=1, le=20)


class UpdateSceneRequest(BaseModel):
    location_id: str | None = None
    music_track_id: str | None = None
    music_is_playing: bool | None = None
    music_volume: int | None = Field(default=None, ge=0, le=100)
    avatar_size: int | None = Field(default=None, ge=80, le=600)
    base_revision: int = Field(ge=1)

    @model_validator(mode="after")
    def contains_change(self) -> UpdateSceneRequest:
        fields = (
            self.location_id,
            self.music_track_id,
            self.music_is_playing,
            self.music_volume,
            self.avatar_size,
        )
        if all(value is None for value in fields):
            raise ValueError("at least one scene field must be provided")
        return self


class UpdateSpeechSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speech_enabled: bool | None = None
    speech_speak_thoughts: bool | None = None

    @model_validator(mode="after")
    def contains_change(self) -> UpdateSpeechSettingsRequest:
        if self.speech_enabled is None and self.speech_speak_thoughts is None:
            raise ValueError("at least one speech setting must be provided")
        return self


class SkipSpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_id: str | None = None


class UpdateSceneCharacterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_visible: bool | None = None
    x: int | None = Field(default=None, ge=0, le=100)
    y: int | None = Field(default=None, ge=0, le=100)
    order: int | None = Field(default=None, ge=0, le=10_000)
    flip_x: bool | None = None
    base_revision: int = Field(ge=1)

    @model_validator(mode="after")
    def contains_change(self) -> UpdateSceneCharacterRequest:
        fields = (self.is_visible, self.x, self.y, self.order, self.flip_x)
        if all(value is None for value in fields):
            raise ValueError("at least one scene character field must be provided")
        return self


class UpdateCharacterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    kind: Literal["player", "npc", "enemy"] | None = None
    role: str | None = Field(default=None, min_length=1, max_length=64)
    biography: str | None = Field(default=None, max_length=50_000)
    model_id: str | None = Field(default=None, max_length=160)
    hp_current: int | None = Field(default=None, ge=0, le=1_000_000)
    hp_max: int | None = Field(default=None, ge=0, le=1_000_000)
    mp_current: int | None = Field(default=None, ge=0, le=1_000_000)
    mp_max: int | None = Field(default=None, ge=0, le=1_000_000)
    attributes: dict[str, int] | None = None
    inventory: list[InventoryItem] | None = Field(default=None, max_length=500)
    status_effects: list[str] | None = Field(default=None, max_length=100)
    global_chronicle: list[str] | None = Field(default=None, max_length=1_000)
    private_notes: list[str] | None = Field(default=None, max_length=1_000)

    @field_validator("name", "role")
    @classmethod
    def validate_required_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value cannot be blank")
        return cleaned

    @field_validator("model_id")
    @classmethod
    def normalize_model_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for name, score in value.items():
            if not name or len(name) > 32 or not name.replace("_", "").isalnum():
                raise ValueError("invalid attribute name")
            if not -1_000_000 <= score <= 1_000_000:
                raise ValueError("attribute value is out of range")
        return value

    @field_validator("status_effects")
    @classmethod
    def validate_status_effects(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [effect.strip() for effect in value if effect.strip()]
        if any(len(effect) > 160 for effect in cleaned):
            raise ValueError("status effect is too long")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("duplicate status effects are not allowed")
        return cleaned

    @field_validator("global_chronicle", "private_notes")
    @classmethod
    def validate_memory_entries(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [entry.strip() for entry in value if entry.strip()]
        if any(len(entry) > 10_000 for entry in cleaned):
            raise ValueError("memory entry is too long")
        return cleaned

    @model_validator(mode="after")
    def contains_character_change(self) -> UpdateCharacterRequest:
        if self.model_fields_set == {"base_revision"}:
            raise ValueError("at least one character field must be provided")
        non_nullable_fields = {
            "name",
            "kind",
            "role",
            "biography",
            "attributes",
            "inventory",
            "status_effects",
            "global_chronicle",
            "private_notes",
        }
        if any(
            field in self.model_fields_set and getattr(self, field) is None
            for field in non_nullable_fields
        ):
            raise ValueError("only model_id can be cleared with null")
        return self


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
    item_id: str | None = None
    item_name: str | None = Field(default=None, min_length=1, max_length=160)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    description: str | None = Field(default=None, max_length=4_000)

    @model_validator(mode="after")
    def locator_and_change_are_required(self) -> UpdateInventoryItemOperation:
        if self.item_id is None and self.item_name is None:
            raise ValueError("item_id or item_name must be provided")
        if self.name is None and self.quantity is None and self.description is None:
            raise ValueError("at least one inventory field must be provided")
        return self


class RemoveInventoryItemOperation(BaseModel):
    op: Literal["remove_inventory_item"]
    character_id: str
    item_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)

    @model_validator(mode="after")
    def locator_is_required(self) -> RemoveInventoryItemOperation:
        if self.item_id is None and self.name is None:
            raise ValueError("item_id or name must be provided")
        return self


class AdjustInventoryItemOperation(BaseModel):
    op: Literal["adjust_inventory_item"]
    character_id: str
    item_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    quantity_delta: int = Field(ge=-1_000_000, le=1_000_000)

    @model_validator(mode="after")
    def locator_is_required(self) -> AdjustInventoryItemOperation:
        if self.item_id is None and self.name is None:
            raise ValueError("item_id or name must be provided")
        return self


class AddStatusEffectOperation(BaseModel):
    op: Literal["add_status_effect"]
    character_id: str
    name: str = Field(min_length=1, max_length=160)


class RemoveStatusEffectOperation(BaseModel):
    op: Literal["remove_status_effect"]
    character_id: str
    status_effect_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)

    @model_validator(mode="after")
    def locator_is_required(self) -> RemoveStatusEffectOperation:
        if self.status_effect_id is None and self.name is None:
            raise ValueError("status_effect_id or name must be provided")
        return self


ObserverOperation = Annotated[
    SetResourceOperation
    | SetAttributeOperation
    | AddInventoryItemOperation
    | UpdateInventoryItemOperation
    | RemoveInventoryItemOperation
    | AdjustInventoryItemOperation
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
    gm_brief: str | None = Field(default=None, min_length=1, max_length=30_000)
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


class ArchivistOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chronicle: str = Field(min_length=1, max_length=100_000)


class PlayerRecollectionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(min_length=1, max_length=100_000)

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str) -> str:
        return value.strip()


class ContextSummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=100_000)

    @field_validator("summary")
    @classmethod
    def strip_summary(cls, value: str) -> str:
        return value.strip()


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
    input_data: dict[str, Any] | None
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


class GenerateEventFinalizationJobRequest(BaseModel):
    event_id: str
    base_revision: int = Field(ge=1)
    model_id: str | None = None


class GenerateContextCompressionJobRequest(BaseModel):
    event_id: str
    base_revision: int = Field(ge=1)
    model_id: str | None = None


class ConfirmEventFinalizationRequest(BaseModel):
    base_revision: int = Field(ge=1)
    chronicle: str = Field(min_length=1, max_length=100_000)
    player_notes: dict[str, str]
    source: Literal["llm", "manual"]

    @field_validator("chronicle")
    @classmethod
    def strip_chronicle(cls, value: str) -> str:
        return value.strip()

    @field_validator("player_notes")
    @classmethod
    def validate_notes(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 100:
            raise ValueError("too many player notes")
        cleaned: dict[str, str] = {}
        for character_id, note in value.items():
            if not character_id.strip():
                raise ValueError("player note character id cannot be empty")
            note = note.strip()
            if not note:
                raise ValueError("player note cannot be empty")
            if len(note) > 100_000:
                raise ValueError("player note is too long")
            cleaned[character_id] = note
        return cleaned


class TTSCapabilityView(BaseModel):
    """`ready` — синтез работает, `off` — выключен настройкой, `unavailable` —
    движка нет в сборке. Отличать их важно: лечатся они по-разному."""

    status: Literal["ready", "off", "unavailable"]
    detail: str | None = None


class CapabilityView(BaseModel):
    llm_enabled: bool
    stt_enabled: bool
    tts_enabled: bool
    tts: TTSCapabilityView


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


class LegacySyncReport(BaseModel):
    source_dir: str
    campaign_id: str
    dry_run: bool
    matched_characters: int
    updated_characters: int
    missing_campaign_characters: list[str]
    missing_source_characters: list[str]
    missing_assets: list[str]


class LegacyExportV1(BaseModel):
    schema_version: Literal[1] = 1
    exported_at: datetime
    campaign: dict[str, Any]
    characters: list[dict[str, Any]]
    events: list[dict[str, Any]]


class CampaignPackImportReport(BaseModel):
    campaign_id: str
    campaign_name: str
    characters: int
    locations: int
    music_tracks: int
