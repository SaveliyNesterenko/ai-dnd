import pytest
from pydantic import TypeAdapter, ValidationError

from ai_dnd.api.schemas import ObserverOperation, SetResourceOperation


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
