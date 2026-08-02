"""Content-addressed asset storage and asset:// resolution.

Assets live in the database (replicas share it, pod-local disks don't) and
are addressed by content hash, so they are immutable by construction:
"updating a logo" is uploading new bytes and referencing the new hash in a
new template version. Old versions keep rendering exactly what they were
published with.

Resolution happens in the web process — the render worker has no database
access. asset:// references are inlined as data: URIs before the HTML
crosses the process boundary; the worker's URL fetcher already allows data:.
"""

import base64
import hashlib
import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Asset
from app.services.cache import ASSETS as _data_uri_cache

ASSET_RE = re.compile(r"asset://([0-9a-f]{64})")

MAX_ASSET_SIZE = 10 * 1024 * 1024


class AssetError(Exception):
    """Message is safe to show the client."""


async def store_asset(session: AsyncSession, filename: str, mime_type: str, data: bytes) -> Asset:
    if not data:
        raise AssetError("Empty file")
    if len(data) > MAX_ASSET_SIZE:
        raise AssetError(f"Asset exceeds {MAX_ASSET_SIZE // (1024 * 1024)} MB limit")
    sha = hashlib.sha256(data).hexdigest()
    existing = (
        await session.execute(select(Asset).where(Asset.sha256 == sha))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    asset = Asset(sha256=sha, filename=filename, mime_type=mime_type, size=len(data), data=data)
    session.add(asset)
    try:
        await session.commit()
        return asset
    except IntegrityError:
        # Same content uploaded concurrently through another pod: identical
        # bytes by definition of the hash, so the other row wins harmlessly.
        await session.rollback()
        return (await session.execute(select(Asset).where(Asset.sha256 == sha))).scalar_one()


async def get_asset(session: AsyncSession, sha256: str) -> Asset | None:
    return (
        await session.execute(select(Asset).where(Asset.sha256 == sha256))
    ).scalar_one_or_none()


async def list_assets(
    session: AsyncSession, *, limit: int | None = None, offset: int = 0
):
    """A page of asset metadata and the total. The blob column is deliberately
    not selected: listing a hundred assets should not stream their bytes."""
    total = (await session.execute(select(func.count()).select_from(Asset))).scalar_one()
    query = (
        select(Asset.sha256, Asset.filename, Asset.mime_type, Asset.size, Asset.created_at)
        .order_by(Asset.created_at.desc())
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    return (await session.execute(query)).all(), total


async def inline_assets(session: AsyncSession, html: str) -> str:
    """Replace every asset://<sha256> reference with a data: URI."""
    hashes = set(ASSET_RE.findall(html))
    if not hashes:
        return html
    mapping: dict[str, str] = {}
    for sha in hashes:
        cached = _data_uri_cache.get(sha)
        if cached is None:
            asset = await get_asset(session, sha)
            if asset is None:
                raise AssetError(f"Unknown asset referenced by template: asset://{sha}")
            cached = f"data:{asset.mime_type};base64,{base64.b64encode(asset.data).decode()}"
            _data_uri_cache.put(sha, cached)
        mapping[sha] = cached
    return ASSET_RE.sub(lambda m: mapping[m.group(1)], html)
