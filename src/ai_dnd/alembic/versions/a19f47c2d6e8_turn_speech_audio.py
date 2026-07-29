"""Store separate thought and action speech audio.

Revision ID: a19f47c2d6e8
Revises: d44d7a61b821
Create Date: 2026-07-30 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a19f47c2d6e8"
down_revision: str | Sequence[str] | None = "d44d7a61b821"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("turns", sa.Column("thought_audio_url", sa.String(length=500), nullable=True))
    op.add_column("turns", sa.Column("action_audio_url", sa.String(length=500), nullable=True))
    op.execute("UPDATE turns SET action_audio_url = audio_url WHERE audio_url IS NOT NULL")


def downgrade() -> None:
    op.drop_column("turns", "action_audio_url")
    op.drop_column("turns", "thought_audio_url")
