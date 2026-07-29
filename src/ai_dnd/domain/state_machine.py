from ai_dnd.domain.enums import EventStatus
from ai_dnd.domain.errors import InvalidTransitionError

_TRANSITIONS: dict[EventStatus, set[EventStatus]] = {
    EventStatus.DRAFT: {EventStatus.ACTIVE},
    EventStatus.ACTIVE: {EventStatus.FINALIZING},
    EventStatus.FINALIZING: {EventStatus.ACTIVE, EventStatus.ARCHIVED},
    EventStatus.ARCHIVED: set(),
}


def ensure_event_transition(current: EventStatus, target: EventStatus) -> None:
    if current == target:
        return
    if target not in _TRANSITIONS[current]:
        raise InvalidTransitionError(f"Cannot transition event from {current} to {target}.")
