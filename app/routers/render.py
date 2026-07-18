from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import check_render_token
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.database import TemplateVersion
from app.models.schemas import AdHocRenderRequest, PlaceholdersResponse
from app.services import versioning
from app.services.assets import AssetError, inline_assets
from app.services.renderer import PdfRenderer, RenderError, RenderTimeout
from app.services.template_engine import (
    TemplateRenderError,
    extract_placeholders,
    render_html,
    render_version_html,
)
from app.services.versioning import NotFoundError

router = APIRouter(prefix="/api", tags=["render"])


def get_renderer(request: Request) -> PdfRenderer:
    return request.app.state.renderer


@router.post("/render", dependencies=[Depends(check_render_token)])
async def render_ad_hoc(
    body: AdHocRenderRequest,
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    strict = body.strict if body.strict is not None else settings.strict_placeholders
    try:
        html = render_html(body.html, body.data, strict=strict)
        html = await inline_assets(session, html)
    except (TemplateRenderError, AssetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        pdf = await renderer.render_pdf(html)
    except RenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(content=pdf, media_type="application/pdf")


async def _render_version(
    row: TemplateVersion,
    data: dict,
    session: AsyncSession,
    renderer: PdfRenderer,
    settings: Settings,
) -> Response:
    try:
        html = render_version_html(
            row.id, row.html_content, data, strict=settings.strict_placeholders
        )
        html = await inline_assets(session, html)
    except (TemplateRenderError, AssetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        pdf = await renderer.render_pdf(html)
    except RenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"X-Linform-Version": str(row.version)},
    )


@router.post("/render/{code}", dependencies=[Depends(check_render_token)])
async def render_published(
    code: str,
    data: dict = Body(default_factory=dict),
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The main integration endpoint: JSON in, PDF out, rendered with the
    currently published version. Which version that is — the analyst decides
    by publishing, the consumer's code never changes."""
    try:
        row = await versioning.get_published_version(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return await _render_version(row, data, session, renderer, settings)


@router.post("/render/{code}/versions/{version}", dependencies=[Depends(check_render_token)])
async def render_pinned(
    code: str,
    version: int,
    data: dict = Body(default_factory=dict),
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Version pinning: render exactly this version, whatever is published.
    Versions are immutable, so the result is reproducible forever. Which
    documents pin which version is the consumer's business rule, not ours."""
    try:
        row = await versioning.get_version(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return await _render_version(row, data, session, renderer, settings)


@router.post("/placeholders", dependencies=[Depends(check_render_token)])
async def list_placeholders(body: AdHocRenderRequest) -> PlaceholdersResponse:
    try:
        return PlaceholdersResponse(placeholders=extract_placeholders(body.html))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
