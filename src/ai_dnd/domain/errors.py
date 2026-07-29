class DomainError(Exception):
    code = "domain_error"


class NotFoundError(DomainError):
    code = "not_found"


class ConflictError(DomainError):
    code = "conflict"


class InvalidTransitionError(ConflictError):
    code = "invalid_transition"


class StaleRevisionError(ConflictError):
    code = "stale_revision"


class ValidationError(DomainError):
    code = "validation_error"
