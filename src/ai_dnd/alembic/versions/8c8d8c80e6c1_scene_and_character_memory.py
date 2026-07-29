"""scene state and per-character campaign memory

Revision ID: 8c8d8c80e6c1
Revises: f55a19fa38f4
Create Date: 2026-07-29 22:10:00.000000
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "8c8d8c80e6c1"
down_revision: str | Sequence[str] | None = "f55a19fa38f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _asset_id(url: object) -> str | None:
    if not isinstance(url, str) or "/api/v1/assets/" not in url:
        return None
    value = url.rsplit("/", 1)[-1]
    return value or None


def upgrade() -> None:
    op.add_column("characters", sa.Column("portrait_asset_id", sa.String(36), nullable=True))
    op.add_column("characters", sa.Column("avatar_asset_id", sa.String(36), nullable=True))
    op.add_column(
        "characters",
        sa.Column(
            "global_chronicle",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    op.execute("UPDATE characters SET portrait_asset_id = sprite_asset_id")
    op.execute(
        "UPDATE characters SET kind = CASE "
        "WHEN lower(role) = 'player' THEN 'player' "
        "WHEN lower(role) = 'enemy' THEN 'enemy' "
        "ELSE 'npc' END"
    )

    op.create_table(
        "locations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.String(36),
            sa.ForeignKey("campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column(
            "asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("campaign_id", "slug", name="uq_location_campaign_slug"),
    )
    op.create_index("ix_locations_campaign_id", "locations", ["campaign_id"])

    op.create_table(
        "music_tracks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.String(36),
            sa.ForeignKey("campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column(
            "asset_id",
            sa.String(36),
            sa.ForeignKey("assets.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("campaign_id", "slug", name="uq_music_track_campaign_slug"),
    )
    op.create_index("ix_music_tracks_campaign_id", "music_tracks", ["campaign_id"])

    op.create_table(
        "scenes",
        sa.Column(
            "campaign_id",
            sa.String(36),
            sa.ForeignKey("campaigns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "location_id",
            sa.String(36),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "music_track_id",
            sa.String(36),
            sa.ForeignKey("music_tracks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("music_is_playing", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("music_volume", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("avatar_size", sa.Integer(), nullable=False, server_default="270"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "scene_characters",
        sa.Column(
            "campaign_id",
            sa.String(36),
            sa.ForeignKey("scenes.campaign_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "character_id",
            sa.String(36),
            sa.ForeignKey("characters.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("x", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("y", sa.Integer(), nullable=False, server_default="75"),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("flip_x", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("scale", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_scene_characters_is_visible", "scene_characters", ["is_visible"])

    op.create_table(
        "game_event_participants",
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("game_events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "character_id",
            sa.String(36),
            sa.ForeignKey("characters.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
    )

    bind = op.get_bind()
    metadata = sa.MetaData()
    campaigns = sa.Table("campaigns", metadata, autoload_with=bind)
    characters = sa.Table("characters", metadata, autoload_with=bind)
    events = sa.Table("game_events", metadata, autoload_with=bind)
    locations = sa.Table("locations", metadata, autoload_with=bind)
    music_tracks = sa.Table("music_tracks", metadata, autoload_with=bind)
    scenes = sa.Table("scenes", metadata, autoload_with=bind)
    scene_characters = sa.Table("scene_characters", metadata, autoload_with=bind)
    participants = sa.Table("game_event_participants", metadata, autoload_with=bind)

    for campaign in bind.execute(sa.select(campaigns)).mappings():
        world_state = campaign["world_state"] if isinstance(campaign["world_state"], dict) else {}
        location_ids: dict[str, str] = {}
        raw_locations = world_state.get("locations", {})
        if isinstance(raw_locations, dict):
            for order, (slug, raw_location) in enumerate(raw_locations.items()):
                if not isinstance(raw_location, dict):
                    continue
                asset_id = _asset_id(raw_location.get("image_url"))
                if not asset_id:
                    continue
                location_id = str(uuid4())
                bind.execute(
                    locations.insert().values(
                        id=location_id,
                        campaign_id=campaign["id"],
                        slug=str(slug),
                        name=str(raw_location.get("name") or slug),
                        asset_id=asset_id,
                        sort_order=order,
                    )
                )
                location_ids[str(slug)] = location_id

        current_location = world_state.get("location", {})
        current_location_id = None
        if isinstance(current_location, dict):
            current_slug = str(current_location.get("id") or "")
            current_location_id = location_ids.get(current_slug)

        music_track_id = None
        music = world_state.get("music", {})
        if isinstance(music, dict):
            asset_id = _asset_id(music.get("url"))
            if asset_id:
                music_track_id = str(uuid4())
                slug = str(music.get("track_id") or "current-track")
                bind.execute(
                    music_tracks.insert().values(
                        id=music_track_id,
                        campaign_id=campaign["id"],
                        slug=slug,
                        name=slug,
                        asset_id=asset_id,
                        sort_order=0,
                    )
                )

        bind.execute(
            scenes.insert().values(
                campaign_id=campaign["id"],
                location_id=current_location_id,
                music_track_id=music_track_id,
                music_is_playing=bool(music.get("is_playing", False))
                if isinstance(music, dict)
                else False,
                music_volume=round(float(music.get("volume", 0.5)) * 100)
                if isinstance(music, dict)
                else 50,
                avatar_size=int(world_state.get("avatar_size", 270)),
                revision=1,
                updated_at=campaign["updated_at"],
            )
        )

        campaign_characters = list(
            bind.execute(
                sa.select(characters).where(characters.c.campaign_id == campaign["id"])
            ).mappings()
        )
        visible_count = max(1, sum(bool(row["is_active"]) for row in campaign_characters))
        visible_index = 0
        for order, character in enumerate(campaign_characters):
            is_visible = bool(character["is_active"])
            x = round(((visible_index + 1) / (visible_count + 1)) * 100) if is_visible else 50
            if is_visible:
                visible_index += 1
            bind.execute(
                scene_characters.insert().values(
                    campaign_id=campaign["id"],
                    character_id=character["id"],
                    is_visible=is_visible,
                    x=x,
                    y=75,
                    order=order,
                    flip_x=bool(character["flip_x"]),
                    scale=100,
                    revision=1,
                )
            )

        active_events = bind.execute(
            sa.select(events.c.id).where(
                events.c.campaign_id == campaign["id"],
                events.c.status.in_(["draft", "active", "finalizing"]),
            )
        ).scalars()
        for event_id in active_events:
            for character in campaign_characters:
                if character["is_active"]:
                    bind.execute(
                        participants.insert().values(
                            event_id=event_id,
                            character_id=character["id"],
                            joined_at=campaign["updated_at"],
                        )
                    )


def downgrade() -> None:
    op.drop_table("game_event_participants")
    op.drop_index("ix_scene_characters_is_visible", table_name="scene_characters")
    op.drop_table("scene_characters")
    op.drop_table("scenes")
    op.drop_index("ix_music_tracks_campaign_id", table_name="music_tracks")
    op.drop_table("music_tracks")
    op.drop_index("ix_locations_campaign_id", table_name="locations")
    op.drop_table("locations")
    op.drop_column("characters", "global_chronicle")
    op.drop_column("characters", "avatar_asset_id")
    op.drop_column("characters", "portrait_asset_id")
