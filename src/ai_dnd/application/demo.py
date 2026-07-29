from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.infrastructure.models import (
    CampaignModel,
    CharacterModel,
    InventoryItemModel,
    SceneCharacterModel,
    SceneModel,
    StatusEffectModel,
)


async def seed_demo_if_empty(session: AsyncSession) -> None:
    if (await session.scalar(select(func.count(CampaignModel.id)))) != 0:
        return
    campaign = CampaignModel(
        slug="demo-campaign",
        name="The Clockwork Crossroads",
        is_active=False,
        global_chronicle=[
            "Aria and Bram arrived at a crossroads where an abandoned clockwork tower "
            "started moving again."
        ],
        world_state={
            "location": {
                "id": "clockwork-crossroads",
                "name": "Clockwork Crossroads",
                "image_url": "/demo-assets/crossroads.svg",
            },
            "music": {"is_playing": False, "volume": 0.5},
        },
    )
    session.add(campaign)
    await session.flush()
    aria = CharacterModel(
        campaign_id=campaign.id,
        slug="aria-vale",
        name="Aria Vale",
        kind="player",
        role="Player",
        biography="A careful artificer searching for the origin of the moving tower.",
        model_id="demo/player-model",
        is_active=True,
        hp_current=28,
        hp_max=30,
        mp_current=14,
        mp_max=18,
        attributes={"STR": 8, "DEX": 14, "END": 12, "INT": 17, "WIS": 13},
        global_chronicle=list(campaign.global_chronicle),
        private_notes=["The tower reacts to the brass compass."],
    )
    bram = CharacterModel(
        campaign_id=campaign.id,
        slug="bram-ironwood",
        name="Bram Ironwood",
        kind="player",
        role="Player",
        biography="A veteran guardian who distrusts machinery that moves on its own.",
        model_id="demo/player-model",
        is_active=True,
        hp_current=42,
        hp_max=42,
        mp_current=4,
        mp_max=8,
        attributes={"STR": 17, "DEX": 10, "END": 16, "INT": 9, "WIS": 12},
        global_chronicle=list(campaign.global_chronicle),
        private_notes=["Keep Aria away from exposed gears."],
    )
    session.add_all([aria, bram])
    await session.flush()
    session.add(SceneModel(campaign_id=campaign.id))
    await session.flush()
    session.add_all(
        [
            SceneCharacterModel(
                campaign_id=campaign.id,
                character_id=aria.id,
                is_visible=True,
                x=35,
                y=75,
                order=0,
            ),
            SceneCharacterModel(
                campaign_id=campaign.id,
                character_id=bram.id,
                is_visible=True,
                x=65,
                y=75,
                order=1,
            ),
            InventoryItemModel(
                character_id=aria.id,
                name="Brass compass",
                quantity=1,
                description="Its needle points toward active mechanisms.",
            ),
            InventoryItemModel(
                character_id=bram.id,
                name="Tower shield",
                quantity=1,
                description="Scarred by old campaign marks.",
            ),
            StatusEffectModel(character_id=aria.id, name="Focused"),
        ]
    )
    await session.commit()
