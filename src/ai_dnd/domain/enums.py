from enum import StrEnum


class EventStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    FINALIZING = "finalizing"
    ARCHIVED = "archived"


class ProposalStatus(StrEnum):
    PENDING = "pending"
    APPLIED = "applied"
    REJECTED = "rejected"
    STALE = "stale"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DEGRADED = "degraded"
    CANCELLED = "cancelled"


class RealtimeAudience(StrEnum):
    PUBLIC = "public"
    GM = "gm"
