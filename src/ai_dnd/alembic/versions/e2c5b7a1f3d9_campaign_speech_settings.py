"""Per-campaign speech switches the GM can flip during a session.

Revision ID: e2c5b7a1f3d9
Revises: a19f47c2d6e8
Create Date: 2026-07-31 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2c5b7a1f3d9"
down_revision: str | Sequence[str] | None = "a19f47c2d6e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("speech_enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "campaigns",
        sa.Column(
            "speech_speak_thoughts", sa.Boolean(), nullable=False, server_default=sa.text("1")
        ),
    )


def downgrade() -> None:
    op.drop_column("campaigns", "speech_speak_thoughts")
    op.drop_column("campaigns", "speech_enabled")
