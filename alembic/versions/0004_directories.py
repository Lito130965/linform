"""Template directories (flat buckets)

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "directories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("created_by", sa.String(length=150), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("name <> ''", name="ck_directory_name_not_empty"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_directories_name", "directories", ["name"])

    # Batch mode so SQLite (no ALTER ADD FK) rebuilds the table cleanly too.
    with op.batch_alter_table("templates") as batch:
        batch.add_column(sa.Column("directory_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_templates_directory_id",
            "directories",
            ["directory_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_templates_directory_id", "templates", ["directory_id"])


def downgrade() -> None:
    op.drop_index("ix_templates_directory_id", table_name="templates")
    with op.batch_alter_table("templates") as batch:
        batch.drop_constraint("fk_templates_directory_id", type_="foreignkey")
        batch.drop_column("directory_id")
    op.drop_table("directories")
