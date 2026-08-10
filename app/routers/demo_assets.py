"""Uploads on a public demo, served at the same paths as the real ones.

Same routes, same shapes, different store — so the editor needs to know nothing
about which instance it is talking to, while what actually happens underneath is
scoped to one visitor and swept within the hour (see services/demo_assets.py).

Mounted only for `LINFORM_ROLE=demo`, and only ever alongside the demo's own
storage: an instance never has both this and the permanent asset API.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.schemas import AssetOut
from app.routers.assets import INLINE_SAFE_MIME
from app.services import demo_assets
from app.services.assets import AssetError

router = APIRouter(prefix="/api/assets", tags=["assets"])

#: Names the browser's scratch space. HttpOnly because no script needs to read
#: it, and it is not a credential for anything beyond "these files are yours".
VISITOR_COOKIE = "lf_demo"


def visitor(request: Request, response: Response) -> str:
    """The id of the browser making this request, minted on first sight.

    The cookie is the whole identity model here, and it is enough: it separates
    one visitor's uploads from another's, which is what has to be true. It
    grants nothing — the worst a forged one can do is show somebody the files
    they would have uploaded anyway.
    """
    found = request.cookies.get(VISITOR_COOKIE)
    if found and len(found) == 32 and all(c in "0123456789abcdef" for c in found):
        return found
    fresh = secrets.token_hex(16)
    response.set_cookie(
        VISITOR_COOKIE,
        fresh,
        max_age=int(demo_assets.TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        # Only over TLS when the connection is TLS; a demo is also run on
        # http://localhost, where a Secure cookie would simply be dropped.
        secure=request.url.scheme == "https",
        path="/",
    )
    return fresh


@router.post("", response_model=AssetOut, status_code=201)
async def upload_asset(
    file: UploadFile,
    owner: str = Depends(visitor),
    session: AsyncSession = Depends(get_session),
):
    data = await file.read()
    try:
        asset = await demo_assets.store(
            session,
            owner=owner,
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
async def list_assets(
    response: Response,
    owner: str = Depends(visitor),
    session: AsyncSession = Depends(get_session),
):
    await demo_assets.sweep(session)
    rows, total = await demo_assets.list_for(session, owner)
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


@router.get("/{sha256}")
async def get_asset(
    sha256: str,
    owner: str = Depends(visitor),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Unlike the permanent store, the hash alone is not enough here.

    There a content hash is an unguessable capability and the bytes belong to
    the installation. Here they belong to whoever uploaded them, so the cookie
    is checked too — and an expired row answers 404 like any other absence,
    without saying that it ever existed.
    """
    asset = await demo_assets.get(session, owner, sha256)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    headers = {}
    if asset.mime_type.split(";")[0].strip().lower() not in INLINE_SAFE_MIME:
        headers["Content-Disposition"] = "attachment"
    return Response(content=asset.data, media_type=asset.mime_type, headers=headers)
