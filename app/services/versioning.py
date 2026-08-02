"""Templates, drafts and published versions.

The distinction that shapes everything here: **a draft is not a version.**

A draft is a working copy. It has no number, it can be edited and deleted, and
nothing outside the editor can render it. A template may hold several at once —
two people trying different things, or one person keeping an idea aside — and
each is addressed by its row id.

A version comes into existence at publication. It is numbered, immutable, and
renderable forever by pinning. Exactly one version at a time is *current*: the
one a consumer gets when it renders by template code. Making an older version
current again is the rollback, and it mints no new number.

Correctness must not depend on deployment topology — one pod or ten — so every
race is resolved by the database: unique constraints plus retry for numbering,
a partial unique index for "one current version".
"""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Template, TemplateVersion, VersionStatus
from app.services.template_engine import validate_template


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class ArchivedError(Exception):
    """The template exists but has been archived; it renders no more."""


# --- templates -------------------------------------------------------------

async def create_template(
    session: AsyncSession, code: str, name: str, directory_id: int | None = None
) -> Template:
    template = Template(code=code, name=name, directory_id=directory_id)
    session.add(template)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError(f"Template code {code!r} already exists")
    return template


async def list_templates(
    session: AsyncSession,
    *,
    include_archived: bool = False,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[Template], int]:
    """A page of templates and the total that matched, so a caller can page
    without a second round trip for the count."""
    where = [] if include_archived else [Template.archived_at.is_(None)]
    total = (
        await session.execute(select(func.count()).select_from(Template).where(*where))
    ).scalar_one()
    query = select(Template).where(*where).order_by(Template.code).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return list((await session.execute(query)).scalars()), total


async def get_template(session: AsyncSession, code: str) -> Template:
    template = (
        await session.execute(select(Template).where(Template.code == code))
    ).scalar_one_or_none()
    if template is None:
        raise NotFoundError(f"Template {code!r} not found")
    return template


async def archive_template(session: AsyncSession, code: str) -> Template:
    """Retire a template without deleting anything. Rendering by code stops;
    a consumer pinning an exact version keeps working, because that promise
    was made when the version was published."""
    template = await get_template(session, code)
    if template.archived_at is None:
        template.archived_at = datetime.now(timezone.utc)
        await session.commit()
    return template


async def restore_template(session: AsyncSession, code: str) -> Template:
    template = await get_template(session, code)
    if template.archived_at is not None:
        template.archived_at = None
        await session.commit()
    return template


# --- drafts ----------------------------------------------------------------

async def list_drafts(session: AsyncSession, code: str) -> list[TemplateVersion]:
    template = await get_template(session, code)
    return list(
        (
            await session.execute(
                select(TemplateVersion)
                .where(
                    TemplateVersion.template_id == template.id,
                    TemplateVersion.status == VersionStatus.draft,
                )
                .order_by(TemplateVersion.created_at.desc(), TemplateVersion.id.desc())
            )
        ).scalars()
    )


async def get_draft(session: AsyncSession, code: str, draft_id: int) -> TemplateVersion:
    template = await get_template(session, code)
    row = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.id == draft_id,
                TemplateVersion.template_id == template.id,
                TemplateVersion.status == VersionStatus.draft,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Template {code!r} has no draft {draft_id}")
    return row


async def create_draft(
    session: AsyncSession,
    code: str,
    html_content: str,
    *,
    comment: str = "",
    created_by: str = "",
) -> TemplateVersion:
    """Start a new working copy. No number is assigned — that happens when it
    is published, if it ever is."""
    validate_template(html_content)
    template = await get_template(session, code)
    draft = TemplateVersion(
        template_id=template.id,
        version=None,
        html_content=html_content,
        status=VersionStatus.draft,
        comment=comment,
        created_by=created_by,
    )
    session.add(draft)
    await session.commit()
    await session.refresh(draft)
    return draft


async def update_draft(
    session: AsyncSession,
    code: str,
    draft_id: int,
    html_content: str,
    *,
    comment: str | None = None,
    created_by: str = "",
) -> TemplateVersion:
    """Drafts are mutable — that is the whole point of them. Immutability
    applies to published versions, which this cannot touch."""
    validate_template(html_content)
    draft = await get_draft(session, code, draft_id)
    draft.html_content = html_content
    if comment is not None:
        draft.comment = comment
    if created_by:
        draft.created_by = created_by
    await session.commit()
    await session.refresh(draft)
    return draft


async def delete_draft(session: AsyncSession, code: str, draft_id: int) -> None:
    draft = await get_draft(session, code, draft_id)
    await session.delete(draft)
    await session.commit()


# --- published versions ----------------------------------------------------

async def list_versions(session: AsyncSession, code: str) -> list[TemplateVersion]:
    """Published history, newest first. Drafts are not in here."""
    template = await get_template(session, code)
    return list(
        (
            await session.execute(
                select(TemplateVersion)
                .where(
                    TemplateVersion.template_id == template.id,
                    TemplateVersion.status != VersionStatus.draft,
                )
                .order_by(TemplateVersion.version.desc())
            )
        ).scalars()
    )


async def get_version(session: AsyncSession, code: str, version: int) -> TemplateVersion:
    """A published (current or superseded) version. A draft has no number, so
    it cannot be reached here — which is the point: unpublished work is not
    renderable by anyone."""
    template = await get_template(session, code)
    row = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template.id,
                TemplateVersion.version == version,
                TemplateVersion.status != VersionStatus.draft,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Template {code!r} has no published version {version}")
    return row


async def get_current_version(session: AsyncSession, code: str) -> TemplateVersion:
    template = await get_template(session, code)
    if template.archived_at is not None:
        raise ArchivedError(
            f"Template {code!r} is archived. Pinned versions still render; "
            "restore the template to render by code again."
        )
    row = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template.id,
                TemplateVersion.status == VersionStatus.published,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            f"Template {code!r} has no published version yet — publish a draft first"
        )
    return row


async def publish_draft(session: AsyncSession, code: str, draft_id: int) -> TemplateVersion:
    """Turn a draft into the current version.

    This is where a number is minted. Two pods can compute the same next
    number; the unique constraint decides and the loser recomputes.
    """
    draft = await get_draft(session, code, draft_id)
    # Read the ids ONCE as plain ints: the rollback below expires every ORM
    # object in the session, and touching an expired attribute later would
    # trigger a lazy refresh — which SQLAlchemy's async layer refuses outside
    # an await. The retry would then die of the very race it exists for.
    template_id = draft.template_id
    version_id = draft.id

    for _ in range(3):
        next_number = (
            (
                await session.execute(
                    select(func.max(TemplateVersion.version)).where(
                        TemplateVersion.template_id == template_id
                    )
                )
            ).scalar()
            or 0
        ) + 1
        current = (
            await session.execute(
                select(TemplateVersion).where(
                    TemplateVersion.template_id == template_id,
                    TemplateVersion.status == VersionStatus.published,
                )
            )
        ).scalar_one_or_none()
        row = await session.get(TemplateVersion, version_id)
        if row is None:
            raise NotFoundError(f"Template {code!r} has no draft {draft_id}")
        try:
            if current is not None:
                # Demote first and flush: the partial unique index must never
                # see two published rows, and UPDATE ordering inside one flush
                # is not guaranteed to match the order written here.
                current.status = VersionStatus.archived
                await session.flush()
            row.version = next_number
            row.status = VersionStatus.published
            await session.commit()
            await session.refresh(row)
            return row
        except IntegrityError:
            await session.rollback()
    raise ConflictError("Could not allocate a version number, retry the request")


async def set_current_version(session: AsyncSession, code: str, version: int) -> TemplateVersion:
    """Make an already-published version the current one again — the rollback.
    Nothing is edited or deleted, and no new number is minted."""
    target = await get_version(session, code, version)
    if target.status == VersionStatus.published:
        return target

    current = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.template_id == target.template_id,
                TemplateVersion.status == VersionStatus.published,
            )
        )
    ).scalar_one_or_none()
    try:
        if current is not None and current.id != target.id:
            current.status = VersionStatus.archived
            await session.flush()
        target.status = VersionStatus.published
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Concurrent publish detected, retry the request")
    return target
