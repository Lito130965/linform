"""Scratch storage for a public demo.

A table of its own rather than columns on `assets`, because the two make
opposite promises. An asset belongs to the installation, is deduplicated by
content and outlives every version that references it. A demo upload belongs to
one visitor, is not shared with anybody, and is gone within the hour — which is
what makes it safe to let strangers upload at all.

Nothing outside the demo role reads or writes this table, and emptying it loses
nothing.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "demo_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("owner", sa.String(64), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        # Content addressing scoped to the owner: two visitors uploading the
        # same bytes get a row each, so one expiry cannot delete the other's.
        sa.UniqueConstraint("sha256", "owner", name="uq_demo_asset_per_owner"),
    )
    op.create_index("ix_demo_assets_sha256", "demo_assets", ["sha256"])
    op.create_index("ix_demo_assets_owner", "demo_assets", ["owner"])
    op.create_index("ix_demo_assets_expires_at", "demo_assets", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_demo_assets_expires_at", table_name="demo_assets")
    op.drop_index("ix_demo_assets_owner", table_name="demo_assets")
    op.drop_index("ix_demo_assets_sha256", table_name="demo_assets")
    op.drop_table("demo_assets")
