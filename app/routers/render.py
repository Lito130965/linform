import time

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.auth import require_render
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.schemas import AdHocRenderRequest, PlaceholdersResponse
from app.routers.demo_assets import visitor
from app.services import demo_assets, versioning
from app.services.assets import AssetError, inline_assets
from app.services.renderer import PdfRenderer, RenderBusy, RenderError, RenderTimeout
from app.services.template_engine import (
    TemplateRenderError,
    extract_placeholders,
    render_html,
    render_version_html,
)
from app.services.versioning import ArchivedError, NotFoundError

# Two routers, because a deployment may want only one of them. `router` is what
# the editor needs — render the markup I am holding, tell me its placeholders.
# `stored_router` is the consuming application's integration surface: a code, a
# payload, a PDF. A node serving one audience does not carry the other's routes.
router = APIRouter(prefix="/api", tags=["render"])
stored_router = APIRouter(prefix="/api", tags=["render"])


def get_renderer(request: Request) -> PdfRenderer:
    return request.app.state.renderer


async def render_measured(
    renderer: PdfRenderer, html: str, template_code: str | None
) -> bytes:
    """Render, and record how it went.

    Measured here rather than inside the renderer because this is where the
    template code is known, and the outcome labels line up with the status
    codes the caller actually sees: ok / rejected (429) / timeout (504) /
    error (422).
    """
    started = time.perf_counter()

    def done(outcome: str) -> None:
        metrics.observe_render(template_code, outcome, time.perf_counter() - started)

    try:
        pdf = await renderer.render_pdf(html)
    except RenderBusy:
        metrics.render_rejected_total.inc()
        done("rejected")
        raise
    except RenderTimeout:
        metrics.render_timeout_total.inc()
        done("timeout")
        raise
    except RenderError:
        done("error")
        raise
    done("ok")
    return pdf


@router.post("/render", dependencies=[Depends(require_render)])
async def render_ad_hoc(
    body: AdHocRenderRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    strict = body.strict if body.strict is not None else settings.strict_placeholders
    try:
        html = render_html(body.html, body.data, strict=strict)
        # On a demo, an asset:// reference resolves against that visitor's own
        # scratch uploads and nobody else's — the same rule the asset endpoints
        # enforce, applied where the bytes actually reach a document.
        if getattr(request.app.state, "role", "all") == "demo":
            html = await demo_assets.inline(session, visitor(request, response), html)
        else:
            html = await inline_assets(session, html)
    except (TemplateRenderError, AssetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        pdf = await render_measured(renderer, html, None)
    except RenderBusy as exc:
        # Backpressure, not a client error: tell them to come back.
        raise HTTPException(
            status_code=429, detail=str(exc), headers={"Retry-After": "2"}
        )
    except RenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(content=pdf, media_type="application/pdf")


async def _render_version(
    target: versioning.RenderTarget,
    data: dict,
    session: AsyncSession,
    renderer: PdfRenderer,
    settings: Settings,
    template_code: str | None = None,
) -> Response:
    try:
        html = render_version_html(
            target.version_id, target.html, data, strict=settings.strict_placeholders
        )
        html = await inline_assets(session, html)
    except (TemplateRenderError, AssetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        pdf = await render_measured(renderer, html, template_code)
    except RenderBusy as exc:
        # Backpressure, not a client error: tell them to come back.
        raise HTTPException(
            status_code=429, detail=str(exc), headers={"Retry-After": "2"}
        )
    except RenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"X-Linform-Version": str(target.version)},
    )


@stored_router.post("/render/{code}", dependencies=[Depends(require_render)])
async def render_published(
    code: str,
    data: dict = Body(default_factory=dict),
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The main integration endpoint: JSON in, PDF out, rendered with whichever
    version is current. Which one that is — the analyst decides by publishing;
    the consumer's code never changes.

    A template with only drafts has no current version and answers 404: work in
    progress is not something a consuming application can reach."""
    try:
        target = await versioning.resolve_current(session, code)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ArchivedError as exc:
        raise HTTPException(status_code=410, detail=str(exc))
    return await _render_version(target, data, session, renderer, settings, code)


@stored_router.post("/render/{code}/versions/{version}", dependencies=[Depends(require_render)])
async def render_pinned(
    code: str,
    version: int,
    data: dict = Body(default_factory=dict),
    session: AsyncSession = Depends(get_session),
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Version pinning: render exactly this version, whatever is current.
    Published versions are immutable, so the result is reproducible forever —
    including after the template is archived. Drafts have no number and cannot
    be reached here at all."""
    try:
        target = await versioning.resolve_pinned(session, code, version)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return await _render_version(target, data, session, renderer, settings, code)


@router.post("/placeholders", dependencies=[Depends(require_render)])
async def list_placeholders(body: AdHocRenderRequest) -> PlaceholdersResponse:
    try:
        return PlaceholdersResponse(placeholders=extract_placeholders(body.html))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
