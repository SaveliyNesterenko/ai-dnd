"""durable event finalization metadata

Revision ID: c12e8f9a4d10
Revises: 8c8d8c80e6c1
Create Date: 2026-07-29 23:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c12e8f9a4d10"
down_revision: str | Sequence[str] | None = "8c8d8c80e6c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("game_events", sa.Column("finalization_started_at", sa.DateTime(), nullable=True))
    op.add_column("game_events", sa.Column("finalization_job_id", sa.String(36), nullable=True))
    op.add_column("game_events", sa.Column("archive_chronicle", sa.Text(), nullable=True))
    op.add_column("game_events", sa.Column("archive_player_notes", sa.JSON(), nullable=True))
    op.add_column("game_events", sa.Column("finalization_source", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("game_events", "finalization_source")
    op.drop_column("game_events", "archive_player_notes")
    op.drop_column("game_events", "archive_chronicle")
    op.drop_column("game_events", "finalization_job_id")
    op.drop_column("game_events", "finalization_started_at")
