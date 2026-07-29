import pytest

from ai_dnd.domain.enums import EventStatus
from ai_dnd.domain.errors import InvalidTransitionError
from ai_dnd.domain.state_machine import ensure_event_transition


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (EventStatus.DRAFT, EventStatus.ACTIVE),
        (EventStatus.ACTIVE, EventStatus.FINALIZING),
        (EventStatus.FINALIZING, EventStatus.ACTIVE),
        (EventStatus.FINALIZING, EventStatus.ARCHIVED),
        (EventStatus.ACTIVE, EventStatus.ACTIVE),
    ],
)
def test_valid_event_transitions(current: EventStatus, target: EventStatus) -> None:
    ensure_event_transition(current, target)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (EventStatus.DRAFT, EventStatus.ARCHIVED),
        (EventStatus.ACTIVE, EventStatus.ARCHIVED),
        (EventStatus.ARCHIVED, EventStatus.ACTIVE),
    ],
)
def test_invalid_event_transitions(current: EventStatus, target: EventStatus) -> None:
    with pytest.raises(InvalidTransitionError):
        ensure_event_transition(current, target)
