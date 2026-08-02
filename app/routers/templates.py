"""Template management: drafts, publication, history, archiving.

The shape of this API follows one rule — **a draft is not a version.** Drafts
live under `/drafts` and are addressed by id; versions appear only once
something has been published, and are addressed by number. Nothing here lets an
unpublished draft be rendered, which is the reason the two are separate.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Principal, require_editor
from app.core.db import get_session
from app.models.schemas import (
    DraftDetailOut,
    DraftOut,
    DraftWrite,
    PlaceholdersResponse,
    TemplateCreate,
    TemplateDetailOut,
    TemplateDirectoryUpdate,
    TemplateOut,
    VersionDetailOut,
    VersionOut,
)
from app.services import directories, versioning
from app.services.template_engine import TemplateRenderError, extract_placeholders
from app.services.versioning import ConflictError, NotFoundError

router = APIRouter(prefix="/api/templates", tags=["templates"], dependencies=[Depends(require_editor)])


@router.get("", response_model=list[TemplateOut])
async def list_templates(
    response: Response,
    include_archived: bool = Query(False, description="Include archived templates"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """A page of templates. `X-Total-Count` carries the full count so a caller
    can page without asking twice."""
    rows, total = await versioning.list_templates(
        session, include_archived=include_archived, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("", response_model=TemplateOut, status_code=201)
async def create_template(body: TemplateCreate, session: AsyncSession = Depends(get_session)):
    if body.directory_id is not None:
        try:
            await directories.get_directory(session, body.directory_id)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
    try:
        return await versioning.create_template(session, body.code, body.name, body.directory_id)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{code}", response_model=TemplateDetailOut)
async def get_template(code: str, session: AsyncSession = Depends(get_session)):
    try:
        template = await versioning.get_template(session, code)
        versions = await versioning.list_versions(session, code)
        drafts = await versioning.list_drafts(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    current = next((v.version for v in versions if v.status.value == "published"), None)
    return TemplateDetailOut(
        code=template.code,
        name=template.name,
        directory_id=template.directory_id,
        archived_at=template.archived_at,
        created_at=template.created_at,
        versions=[VersionOut.model_validate(v) for v in versions],
        drafts=[DraftOut.model_validate(d) for d in drafts],
        current_version=current,
    )


@router.delete("/{code}", response_model=TemplateOut)
async def archive_template(code: str, session: AsyncSession = Depends(get_session)):
    """Archive rather than delete. Rendering by code stops; a consumer pinning
    an exact version keeps working, because that promise was made when the
    version was published."""
    try:
        return await versioning.archive_template(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{code}/restore", response_model=TemplateOut)
async def restore_template(code: str, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.restore_template(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{code}/directory", response_model=TemplateOut)
async def set_template_directory(
    code: str, body: TemplateDirectoryUpdate, session: AsyncSession = Depends(get_session)
):
    """Move a template into a bucket, or pass null to send it to General."""
    try:
        return await directories.set_template_directory(session, code, body.directory_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# --- drafts ----------------------------------------------------------------

@router.get("/{code}/drafts", response_model=list[DraftOut])
async def list_drafts(code: str, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.list_drafts(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{code}/drafts", response_model=DraftDetailOut, status_code=201)
async def create_draft(
    code: str,
    body: DraftWrite,
    session: AsyncSession = Depends(get_session),
    principal: Principal = Depends(require_editor),
):
    """Start a working copy. It gets no version number: numbers are minted at
    publication, so every number means something that was really published."""
    try:
        return await versioning.create_draft(
            session, code, body.html_content, comment=body.comment, created_by=principal.name
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/{code}/drafts/{draft_id}", response_model=DraftDetailOut)
async def get_draft(code: str, draft_id: int, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.get_draft(session, code, draft_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/{code}/drafts/{draft_id}", response_model=DraftDetailOut)
async def update_draft(
    code: str,
    draft_id: int,
    body: DraftWrite,
    session: AsyncSession = Depends(get_session),
    principal: Principal = Depends(require_editor),
):
    """Drafts are mutable — that is what makes them drafts. Published versions
    are not, and this cannot reach them."""
    try:
        return await versioning.update_draft(
            session, code, draft_id, body.html_content,
            comment=body.comment, created_by=principal.name,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.delete("/{code}/drafts/{draft_id}", status_code=204)
async def delete_draft(code: str, draft_id: int, session: AsyncSession = Depends(get_session)):
    try:
        await versioning.delete_draft(session, code, draft_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{code}/drafts/{draft_id}/publish", response_model=VersionOut)
async def publish_draft(code: str, draft_id: int, session: AsyncSession = Depends(get_session)):
    """Publish a draft: it is numbered, frozen, and becomes the version
    consumers get. The version it replaces stays in history."""
    try:
        return await versioning.publish_draft(session, code, draft_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# --- published versions ----------------------------------------------------

@router.get("/{code}/versions", response_model=list[VersionOut])
async def list_versions(code: str, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.list_versions(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{code}/versions/{version}", response_model=VersionDetailOut)
async def get_version(code: str, version: int, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.get_version(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{code}/versions/{version}/current", response_model=VersionOut)
async def set_current_version(
    code: str, version: int, session: AsyncSession = Depends(get_session)
):
    """Choose which published version consumers get. Pointing it at an older
    version IS the rollback: nothing is edited, deleted, or re-numbered."""
    try:
        return await versioning.set_current_version(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{code}/placeholders", response_model=PlaceholdersResponse)
async def get_placeholders(
    code: str, version: int | None = None, session: AsyncSession = Depends(get_session)
):
    """Placeholders of the current version (or an explicit one) — the
    integration contract for the consuming application."""
    try:
        row = (
            await versioning.get_version(session, code, version)
            if version is not None
            else await versioning.get_current_version(session, code)
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except versioning.ArchivedError as exc:
        raise HTTPException(status_code=410, detail=str(exc))
    return PlaceholdersResponse(placeholders=extract_placeholders(row.html_content))
