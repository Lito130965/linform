"""Templates and immutable versions

Revision ID: 0001
Revises:
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("code <> ''", name="ck_template_code_not_empty"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_templates_code", "templates", ["code"])

    op.create_table(
        "template_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("html_content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_version_status"),
        sa.UniqueConstraint("template_id", "version", name="uq_version_per_template"),
    )
    op.create_index(
        "uq_one_published_per_template",
        "template_versions",
        ["template_id"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
        sqlite_where=sa.text("status = 'published'"),
    )


def downgrade() -> None:
    op.drop_table("template_versions")
    op.drop_table("templates")
