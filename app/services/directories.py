"""Template directories: flat organizational buckets.

Metadata only — the render API never routes by directory, it routes by the
template's stable code. Deleting a directory un-files its templates (the FK is
ON DELETE SET NULL) rather than deleting anything.
"""

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Directory, Template
from app.services.versioning import ConflictError, NotFoundError


async def list_directories(session: AsyncSession) -> list[tuple[Directory, int]]:
    """Every directory with how many templates it holds, name-ordered."""
    dirs = list((await session.execute(select(Directory).order_by(Directory.name))).scalars())
    counts = dict(
        (
            await session.execute(
                select(Template.directory_id, func.count())
                .where(Template.directory_id.is_not(None))
                .group_by(Template.directory_id)
            )
        ).all()
    )
    return [(d, counts.get(d.id, 0)) for d in dirs]


async def get_directory(session: AsyncSession, directory_id: int) -> Directory:
    row = await session.get(Directory, directory_id)
    if row is None:
        raise NotFoundError(f"No directory {directory_id}")
    return row


async def create_directory(session: AsyncSession, name: str, created_by: str) -> Directory:
    name = name.strip()
    if not name:
        raise ConflictError("Directory name must not be empty")
    row = Directory(name=name, created_by=created_by)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError(f"A directory named {name!r} already exists")
    await session.refresh(row)
    return row


async def rename_directory(session: AsyncSession, directory_id: int, name: str) -> Directory:
    row = await get_directory(session, directory_id)
    row.name = name.strip()
    if not row.name:
        raise ConflictError("Directory name must not be empty")
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError(f"A directory named {name!r} already exists")
    await session.refresh(row)
    return row


async def delete_directory(session: AsyncSession, directory_id: int) -> bool:
    row = await session.get(Directory, directory_id)
    if row is None:
        return False
    # Un-file templates explicitly rather than trust the FK cascade: SQLite (the
    # zero-config default) does not enforce foreign keys unless asked, so a
    # removed bucket would otherwise leave templates pointing at a ghost id.
    await session.execute(
        update(Template).where(Template.directory_id == directory_id).values(directory_id=None)
    )
    await session.delete(row)
    await session.commit()
    return True


async def set_template_directory(
    session: AsyncSession, code: str, directory_id: int | None
) -> Template:
    template = (
        await session.execute(select(Template).where(Template.code == code))
    ).scalar_one_or_none()
    if template is None:
        raise NotFoundError(f"Template {code!r} not found")
    if directory_id is not None:
        await get_directory(session, directory_id)  # 404 if the bucket is gone
    template.directory_id = directory_id
    await session.commit()
    await session.refresh(template)
    return template
