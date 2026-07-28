"""Template directories (flat buckets) — editor-side organization. The render
API is unaffected: it routes by template code, never by directory."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Principal, require_editor
from app.core.db import get_session
from app.models.schemas import DirectoryCreate, DirectoryOut
from app.services import directories
from app.services.versioning import ConflictError, NotFoundError

router = APIRouter(
    prefix="/api/directories", tags=["directories"], dependencies=[Depends(require_editor)]
)


def _out(directory, count: int) -> DirectoryOut:
    return DirectoryOut(
        id=directory.id,
        name=directory.name,
        created_by=directory.created_by,
        created_at=directory.created_at,
        template_count=count,
    )


@router.get("", response_model=list[DirectoryOut])
async def list_directories(session: AsyncSession = Depends(get_session)):
    return [_out(d, count) for d, count in await directories.list_directories(session)]


@router.post("", response_model=DirectoryOut, status_code=201)
async def create_directory(
    body: DirectoryCreate,
    session: AsyncSession = Depends(get_session),
    principal: Principal = Depends(require_editor),
):
    try:
        row = await directories.create_directory(session, body.name, principal.name)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return _out(row, 0)


@router.put("/{directory_id}", response_model=DirectoryOut)
async def rename_directory(
    directory_id: int, body: DirectoryCreate, session: AsyncSession = Depends(get_session)
):
    try:
        row = await directories.rename_directory(session, directory_id, body.name)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return _out(row, 0)


@router.delete("/{directory_id}", status_code=204)
async def delete_directory(directory_id: int, session: AsyncSession = Depends(get_session)):
    """Remove a bucket. Its templates are un-filed to General, never deleted."""
    if not await directories.delete_directory(session, directory_id):
        raise HTTPException(status_code=404, detail="No such directory")
