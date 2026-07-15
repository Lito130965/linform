from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.schemas import AssetOut
from app.routers.render import check_token
from app.services import assets as assets_service
from app.services.assets import AssetError

router = APIRouter(prefix="/api/assets", tags=["assets"], dependencies=[Depends(check_token)])


@router.post("", response_model=AssetOut, status_code=201)
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


@router.get("", response_model=list[AssetOut])
async def list_assets(session: AsyncSession = Depends(get_session)):
    return [
        AssetOut(
            url=f"asset://{row.sha256}",
            sha256=row.sha256,
            filename=row.filename,
            mime_type=row.mime_type,
            size=row.size,
        )
        for row in await assets_service.list_assets(session)
    ]


@router.get("/{sha256}")
async def get_asset(sha256: str, session: AsyncSession = Depends(get_session)) -> Response:
    asset = await assets_service.get_asset(session, sha256)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(content=asset.data, media_type=asset.mime_type)
