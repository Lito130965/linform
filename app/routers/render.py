from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.models.schemas import AdHocRenderRequest, PlaceholdersResponse
from app.services.renderer import PdfRenderer, RenderError, RenderTimeout
from app.services.template_engine import TemplateRenderError, extract_placeholders, render_html

router = APIRouter(prefix="/api", tags=["render"])

_bearer = HTTPBearer(auto_error=False)


def check_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.api_token:
        return  # auth disabled (dev mode)
    if credentials is None or credentials.credentials != settings.api_token:
        raise HTTPException(status_code=401, detail="Invalid or missing token")


def get_renderer(request: Request) -> PdfRenderer:
    return request.app.state.renderer


@router.post("/render", dependencies=[Depends(check_token)])
async def render_ad_hoc(
    body: AdHocRenderRequest,
    renderer: PdfRenderer = Depends(get_renderer),
    settings: Settings = Depends(get_settings),
) -> Response:
    try:
        html = render_html(body.html, body.data, strict=settings.strict_placeholders)
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        pdf = await renderer.render_pdf(html)
    except RenderTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(content=pdf, media_type="application/pdf")


@router.post("/placeholders", dependencies=[Depends(check_token)])
async def list_placeholders(body: AdHocRenderRequest) -> PlaceholdersResponse:
    try:
        return PlaceholdersResponse(placeholders=extract_placeholders(body.html))
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
