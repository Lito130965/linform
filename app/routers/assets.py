from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.schemas import AssetOut
from app.core.auth import require_editor
from app.services import assets as assets_service
from app.services.assets import AssetError

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("", response_model=AssetOut, status_code=201, dependencies=[Depends(require_editor)])
async def upload_asset(file: UploadFile, session: AsyncSession = Depends(get_session)):
    data = await file.read()
    try:
        asset = await assets_service.store_asset(
            session,
            filename=file.filename or "unnamed",
            mime_type=file.content_type or "application/octet-stream",
            data=data,
        )
    except AssetError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return AssetOut(
        url=f"asset://{asset.sha256}",
        sha256=asset.sha256,
        filename=asset.filename,
        mime_type=asset.mime_type,
        size=asset.size,
    )


@router.get("", response_model=list[AssetOut], dependencies=[Depends(require_editor)])
async def list_assets(
    response: Response,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await assets_service.list_assets(session, limit=limit, offset=offset)
    response.headers["X-Total-Count"] = str(total)
    return [
        AssetOut(
            url=f"asset://{row.sha256}",
            sha256=row.sha256,
            filename=row.filename,
            mime_type=row.mime_type,
            size=row.size,
        )
        for row in rows
    ]


# Types a browser may render inline from this origin. Everything else is sent
# as an attachment — most importantly SVG, which is an executable document
# (it can carry <script>) and would otherwise run in the editor's origin when
# opened directly. Uploaded SVG still works as an <img> source; only direct
# navigation is defused.
INLINE_SAFE_MIME = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "image/x-icon",
    "font/woff",
    "font/woff2",
    "font/ttf",
    "font/otf",
    "application/pdf",
}


@router.get("/{sha256}")
async def get_asset(sha256: str, session: AsyncSession = Depends(get_session)) -> Response:
    """Raw bytes are served without auth on purpose: browsers cannot attach
    headers to <img src>, and the 64-hex content hash is an unguessable
    capability URL. Listing and uploading stay admin-only."""
    asset = await assets_service.get_asset(session, sha256)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    headers = {}
    if asset.mime_type.split(";")[0].strip().lower() not in INLINE_SAFE_MIME:
        headers["Content-Disposition"] = "attachment"
    return Response(content=asset.data, media_type=asset.mime_type, headers=headers)
