"""A draft is not a version; templates can be archived

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-02

Before this, saving a template minted a numbered version immediately. Two
consequences followed: a number existed for work that had never been published,
and a consumer that knew the number could render an unpublished draft through
the pinning endpoint.

After this a number is assigned at publication and a draft carries NULL, so a
version number always means "something a consumer could legitimately have
rendered". Drafts are addressed by their row id instead; a template may hold
several, and each can be edited, deleted or published on its own.

The data migration is deliberately minimal: it strips the numbers off existing
drafts and does nothing else. It publishes nothing, promotes nothing and
deletes nothing — a schema change is the wrong place to decide that somebody's
unpublished work is now live, and any such rule would also have made those rows
renderable by pinning, which is the hole this change closes.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("templates") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("template_versions") as batch:
        batch.alter_column("version", existing_type=sa.Integer(), nullable=True)

    # Existing drafts stop being versions. Several drafts per template are fine:
    # a unique constraint treats NULLs as distinct in both SQLite and PostgreSQL.
    op.execute(sa.text("UPDATE template_versions SET version = NULL WHERE status = 'draft'"))


def downgrade() -> None:
    # Give the un-numbered drafts a number back, above whatever their template
    # already has, so the column can be NOT NULL again.
    connection = op.get_bind()
    drafts = connection.execute(
        sa.text("SELECT id, template_id FROM template_versions WHERE version IS NULL ORDER BY id")
    ).fetchall()
    for version_id, template_id in drafts:
        next_number = connection.execute(
            sa.text(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM template_versions "
                "WHERE template_id = :tid"
            ),
            {"tid": template_id},
        ).scalar()
        connection.execute(
            sa.text("UPDATE template_versions SET version = :v WHERE id = :vid"),
            {"v": next_number, "vid": version_id},
        )

    with op.batch_alter_table("template_versions") as batch:
        batch.alter_column("version", existing_type=sa.Integer(), nullable=False)

    with op.batch_alter_table("templates") as batch:
        batch.drop_column("archived_at")
