from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.schemas import (
    PlaceholdersResponse,
    TemplateCreate,
    TemplateDetailOut,
    TemplateOut,
    VersionCreate,
    VersionDetailOut,
    VersionOut,
)
from app.core.auth import check_admin_token
from app.services import versioning
from app.services.template_engine import TemplateRenderError, extract_placeholders
from app.services.versioning import ConflictError, NotFoundError

router = APIRouter(prefix="/api/templates", tags=["templates"], dependencies=[Depends(check_admin_token)])


@router.get("", response_model=list[TemplateOut])
async def list_templates(session: AsyncSession = Depends(get_session)):
    return await versioning.list_templates(session)


@router.post("", response_model=TemplateOut, status_code=201)
async def create_template(body: TemplateCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.create_template(session, body.code, body.name)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{code}", response_model=TemplateDetailOut)
async def get_template(code: str, session: AsyncSession = Depends(get_session)):
    try:
        template = await versioning.get_template(session, code)
        versions = await versioning.get_versions(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return TemplateDetailOut(
        code=template.code,
        name=template.name,
        created_at=template.created_at,
        versions=[VersionOut.model_validate(v) for v in versions],
    )


@router.put("/{code}", response_model=VersionOut, status_code=201)
async def create_version(code: str, body: VersionCreate, session: AsyncSession = Depends(get_session)):
    """Creates a NEW draft version; existing versions are immutable."""
    try:
        return await versioning.create_version(
            session, code, body.html_content, comment=body.comment, created_by=body.created_by
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{code}/versions/{version}", response_model=VersionDetailOut)
async def get_version(code: str, version: int, session: AsyncSession = Depends(get_session)):
    try:
        return await versioning.get_version(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{code}/publish/{version}", response_model=VersionOut)
async def publish_version(code: str, version: int, session: AsyncSession = Depends(get_session)):
    """Publish = make active. Publishing an older version is the rollback."""
    try:
        return await versioning.publish_version(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/{code}/placeholders", response_model=PlaceholdersResponse)
async def get_placeholders(
    code: str, version: int | None = None, session: AsyncSession = Depends(get_session)
):
    """Placeholders of the published version (or an explicit one) — the
    integration contract for the consuming application."""
    try:
        row = (
            await versioning.get_version(session, code, version)
            if version is not None
            else await versioning.get_published_version(session, code)
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return PlaceholdersResponse(placeholders=extract_placeholders(row.html_content))
