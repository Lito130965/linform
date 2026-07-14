"""Template versioning: immutable versions, atomic publish, rollback-by-publish.

Correctness here must not depend on deployment topology (single pod or ten):
every race is resolved by the database — unique constraints plus retry for
version numbering, a partial unique index for "one published per template".
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Template, TemplateVersion, VersionStatus
from app.services.template_engine import validate_template


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


async def create_template(session: AsyncSession, code: str, name: str) -> Template:
    template = Template(code=code, name=name)
    session.add(template)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError(f"Template code {code!r} already exists")
    return template


async def list_templates(session: AsyncSession) -> list[Template]:
    return list((await session.execute(select(Template).order_by(Template.code))).scalars())


async def get_template(session: AsyncSession, code: str) -> Template:
    template = (
        await session.execute(select(Template).where(Template.code == code))
    ).scalar_one_or_none()
    if template is None:
        raise NotFoundError(f"Template {code!r} not found")
    return template


async def get_versions(session: AsyncSession, code: str) -> list[TemplateVersion]:
    template = await get_template(session, code)
    return list(
        (
            await session.execute(
                select(TemplateVersion)
                .where(TemplateVersion.template_id == template.id)
                .order_by(TemplateVersion.version)
            )
        ).scalars()
    )


async def create_version(
    session: AsyncSession,
    code: str,
    html_content: str,
    *,
    comment: str = "",
    created_by: str = "",
) -> TemplateVersion:
    """Add a new draft version. Never mutates existing versions."""
    # Reject templates that don't even compile — a broken draft helps nobody.
    validate_template(html_content)

    template = await get_template(session, code)

    # Two pods can compute the same next number; the unique constraint decides,
    # the loser recomputes. Three attempts is plenty for realistic contention.
    for attempt in range(3):
        current_max = (
            await session.execute(
                select(TemplateVersion.version)
                .where(TemplateVersion.template_id == template.id)
                .order_by(TemplateVersion.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        version = TemplateVersion(
            template_id=template.id,
            version=(current_max or 0) + 1,
            html_content=html_content,
            status=VersionStatus.draft,
            comment=comment,
            created_by=created_by,
        )
        session.add(version)
        try:
            await session.commit()
            return version
        except IntegrityError:
            await session.rollback()
    raise ConflictError("Could not allocate a version number, retry the request")


async def get_version(session: AsyncSession, code: str, version: int) -> TemplateVersion:
    template = await get_template(session, code)
    row = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template.id,
                TemplateVersion.version == version,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Template {code!r} has no version {version}")
    return row


async def get_published_version(session: AsyncSession, code: str) -> TemplateVersion:
    template = await get_template(session, code)
    row = (
        await session.execute(
            select(TemplateVersion).where(
                TemplateVersion.template_id == template.id,
                TemplateVersion.status == VersionStatus.published,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Template {code!r} has no published version")
    return row


async def publish_version(session: AsyncSession, code: str, version: int) -> TemplateVersion:
    """Make the given version the active one. Publishing an older version IS
    the rollback mechanism — nothing is ever edited or deleted."""
    target = await get_version(session, code, version)

    # Single transaction: demote the current published version (if any),
    # promote the target. The partial unique index backs this atomically.
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
            # Demote first and flush: the partial unique index must never see
            # two published rows, and UPDATE ordering inside one flush is not
            # guaranteed to match the code order.
            current.status = VersionStatus.archived
            await session.flush()
        target.status = VersionStatus.published
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Concurrent publish detected, retry the request")
    return target
