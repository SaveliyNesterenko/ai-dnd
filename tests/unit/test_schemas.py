import pytest
from pydantic import TypeAdapter, ValidationError

from ai_dnd.api.schemas import (
    ArchivistOutput,
    ConfirmEventFinalizationRequest,
    ObserverOperation,
    SetResourceOperation,
    UpdateCharacterRequest,
)


def test_resource_operation_rejects_current_above_maximum() -> None:
    with pytest.raises(ValidationError):
        SetResourceOperation(
            op="set_resource",
            character_id="character-id",
            resource="hp",
            current=20,
            maximum=10,
        )


def test_observer_operations_are_discriminated() -> None:
    operation = TypeAdapter(ObserverOperation).validate_python(
        {
            "op": "set_attribute",
            "character_id": "character-id",
            "attribute": "STR",
            "value": 15,
        }
    )
    assert operation.op == "set_attribute"


def test_forbidden_arbitrary_patch_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(ObserverOperation).validate_python(
            {
                "op": "replace",
                "character_id": "character-id",
                "path": "/private_notes",
                "value": ["stolen"],
            }
        )


@pytest.mark.parametrize(
    "player_notes",
    [
        {f"player-{index}": "A note" for index in range(101)},
        {"": "A valid note"},
        {"player-id": "   "},
        {"player-id": "x" * 100_001},
    ],
)
def test_archivist_rejects_invalid_player_notes(player_notes: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        ArchivistOutput(chronicle="A chronicle.", player_notes=player_notes)


def test_confirmation_strips_durable_memory() -> None:
    request = ConfirmEventFinalizationRequest(
        base_revision=2,
        chronicle="  Chronicle  ",
        player_notes={"player-id": "  Recollection  "},
        source="manual",
    )
    assert request.chronicle == "Chronicle"
    assert request.player_notes == {"player-id": "Recollection"}


@pytest.mark.parametrize(
    "payload",
    [
        {"base_revision": 1},
        {"base_revision": 1, "attributes": {"bad name!": 1}},
        {"base_revision": 1, "attributes": {"STR": 1_000_001}},
        {"base_revision": 1, "status_effects": ["Poisoned", "Poisoned"]},
        {"base_revision": 1, "status_effects": ["x" * 161]},
    ],
)
def test_character_card_update_validates_editable_fields(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        UpdateCharacterRequest.model_validate(payload)


def test_character_card_update_normalizes_status_effects() -> None:
    request = UpdateCharacterRequest(
        base_revision=1,
        status_effects=["  Inspired  ", ""],
    )
    assert request.status_effects == ["Inspired"]
