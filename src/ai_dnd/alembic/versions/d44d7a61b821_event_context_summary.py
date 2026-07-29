"""durable compressed event context

Revision ID: d44d7a61b821
Revises: c12e8f9a4d10
Create Date: 2026-07-29 23:55:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d44d7a61b821"
down_revision: str | Sequence[str] | None = "c12e8f9a4d10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("game_events", sa.Column("context_summary", sa.Text(), nullable=True))
    op.add_column(
        "game_events",
        sa.Column("context_summary_through_sequence", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("game_events", "context_summary_through_sequence")
    op.drop_column("game_events", "context_summary")
