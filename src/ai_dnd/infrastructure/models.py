from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class CampaignModel(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    global_chronicle: Mapped[list[str]] = mapped_column(JSON, default=list)
    world_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)

    characters: Mapped[list[CharacterModel]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    events: Mapped[list[GameEventModel]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    scene: Mapped[SceneModel | None] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", uselist=False
    )
    locations: Mapped[list[LocationModel]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    music_tracks: Mapped[list[MusicTrackModel]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class CharacterModel(Base):
    __tablename__ = "characters"
    __table_args__ = (UniqueConstraint("campaign_id", "slug", name="uq_character_campaign_slug"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(32), default="npc")
    role: Mapped[str] = mapped_column(String(64), default="npc")
    biography: Mapped[str] = mapped_column(Text, default="")
    model_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    portrait_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    avatar_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sprite_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    voice_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    flip_x: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    hp_current: Mapped[int] = mapped_column(Integer, default=10)
    hp_max: Mapped[int] = mapped_column(Integer, default=10)
    mp_current: Mapped[int] = mapped_column(Integer, default=0)
    mp_max: Mapped[int] = mapped_column(Integer, default=0)
    attributes: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    global_chronicle: Mapped[list[str]] = mapped_column(JSON, default=list)
    private_notes: Mapped[list[str]] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)

    campaign: Mapped[CampaignModel] = relationship(back_populates="characters")
    inventory: Mapped[list[InventoryItemModel]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="InventoryItemModel.id"
    )
    status_effects: Mapped[list[StatusEffectModel]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="StatusEffectModel.id"
    )
    scene_state: Mapped[SceneCharacterModel | None] = relationship(
        back_populates="character", cascade="all, delete-orphan", uselist=False
    )


class LocationModel(Base):
    __tablename__ = "locations"
    __table_args__ = (UniqueConstraint("campaign_id", "slug", name="uq_location_campaign_slug"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(160))
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    campaign: Mapped[CampaignModel] = relationship(back_populates="locations")


class MusicTrackModel(Base):
    __tablename__ = "music_tracks"
    __table_args__ = (UniqueConstraint("campaign_id", "slug", name="uq_music_track_campaign_slug"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(160))
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    campaign: Mapped[CampaignModel] = relationship(back_populates="music_tracks")


class SceneModel(Base):
    __tablename__ = "scenes"

    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True
    )
    location_id: Mapped[str | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    music_track_id: Mapped[str | None] = mapped_column(
        ForeignKey("music_tracks.id", ondelete="SET NULL"), nullable=True
    )
    music_is_playing: Mapped[bool] = mapped_column(Boolean, default=False)
    music_volume: Mapped[int] = mapped_column(Integer, default=50)
    avatar_size: Mapped[int] = mapped_column(Integer, default=270)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(default=utc_now, onupdate=utc_now)

    campaign: Mapped[CampaignModel] = relationship(back_populates="scene")
    characters: Mapped[list[SceneCharacterModel]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", order_by="SceneCharacterModel.order"
    )


class SceneCharacterModel(Base):
    __tablename__ = "scene_characters"

    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.campaign_id", ondelete="CASCADE"), primary_key=True
    )
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True
    )
    is_visible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    x: Mapped[int] = mapped_column(Integer, default=50)
    y: Mapped[int] = mapped_column(Integer, default=75)
    order: Mapped[int] = mapped_column(Integer, default=0)
    flip_x: Mapped[bool] = mapped_column(Boolean, default=False)
    scale: Mapped[int] = mapped_column(Integer, default=100)
    revision: Mapped[int] = mapped_column(Integer, default=1)

    scene: Mapped[SceneModel] = relationship(back_populates="characters")
    character: Mapped[CharacterModel] = relationship(back_populates="scene_state")


class InventoryItemModel(Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    description: Mapped[str] = mapped_column(Text, default="")

    character: Mapped[CharacterModel] = relationship(back_populates="inventory")


class StatusEffectModel(Base):
    __tablename__ = "status_effects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))

    character: Mapped[CharacterModel] = relationship(back_populates="status_effects")


class GameEventModel(Base):
    __tablename__ = "game_events"
    __table_args__ = (
        Index(
            "uq_game_events_one_active_per_campaign",
            "campaign_id",
            unique=True,
            sqlite_where=text("status IN ('draft', 'active', 'finalizing')"),
            postgresql_where=text("status IN ('draft', 'active', 'finalizing')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="Game event")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finalization_started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finalization_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    context_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_summary_through_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    archive_chronicle: Mapped[str | None] = mapped_column(Text, nullable=True)
    archive_player_notes: Mapped[dict[str, str] | None] = mapped_column(JSON, nullable=True)
    finalization_source: Mapped[str | None] = mapped_column(String(24), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)

    campaign: Mapped[CampaignModel] = relationship(back_populates="events")
    turns: Mapped[list[TurnModel]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="TurnModel.sequence"
    )
    participants: Mapped[list[GameEventParticipantModel]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class GameEventParticipantModel(Base):
    __tablename__ = "game_event_participants"

    event_id: Mapped[str] = mapped_column(
        ForeignKey("game_events.id", ondelete="CASCADE"), primary_key=True
    )
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="RESTRICT"), primary_key=True
    )
    joined_at: Mapped[datetime] = mapped_column(default=utc_now)

    event: Mapped[GameEventModel] = relationship(back_populates="participants")


class TurnModel(Base):
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("event_id", "sequence", name="uq_turn_event_sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        ForeignKey("game_events.id", ondelete="CASCADE"), index=True
    )
    character_id: Mapped[str | None] = mapped_column(
        ForeignKey("characters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    actor_name: Mapped[str] = mapped_column(String(160))
    actor_role: Mapped[str] = mapped_column(String(64))
    thought: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str] = mapped_column(Text)
    dice_roll: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thought_audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    action_audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)

    event: Mapped[GameEventModel] = relationship(back_populates="turns")


class ObserverProposalModel(Base):
    __tablename__ = "observer_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[str] = mapped_column(
        ForeignKey("game_events.id", ondelete="CASCADE"), index=True
    )
    turn_id: Mapped[str] = mapped_column(ForeignKey("turns.id", ondelete="CASCADE"), index=True)
    gm_brief: Mapped[str] = mapped_column(Text)
    base_revision: Mapped[int] = mapped_column(Integer)
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AssetModel(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    relative_path: Mapped[str] = mapped_column(String(500), unique=True)
    media_type: Mapped[str] = mapped_column(String(120))
    sha256: Mapped[str] = mapped_column(String(64))
    license_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class BackgroundJobModel(Base):
    __tablename__ = "background_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    input_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    output_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)


class RealtimeEventModel(Base):
    __tablename__ = "realtime_events"
    __table_args__ = (
        UniqueConstraint("campaign_id", "sequence", name="uq_realtime_campaign_sequence"),
        Index("ix_realtime_campaign_sequence", "campaign_id", "sequence"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(100))
    audience: Mapped[str] = mapped_column(String(16), default="public")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    occurred_at: Mapped[datetime] = mapped_column(default=utc_now)


class IdempotencyRecordModel(Base):
    __tablename__ = "idempotency_records"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    scope: Mapped[str] = mapped_column(String(160), primary_key=True)
    status_code: Mapped[int] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
