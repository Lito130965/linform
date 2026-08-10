"""Uploads on a public demo: one visitor's, and not for long.

A demo lets strangers upload files. That is the point — a logo in the corner is
what makes the editor feel like yours — and it is also the reason this cannot
reuse the ordinary asset store. Somebody will upload something unlawful,
malicious, or merely embarrassing, and the service must not become the place
that serves it to other people or keeps it on the domain.

Three rules answer that, and they are the whole module:

- **an upload is visible only to the browser that sent it**, identified by an
  opaque cookie. Not an account: it names a scratch space, and it is everything
  this store ever knows about a visitor;
- **it stops existing within the hour**, whether or not anybody comes back;
- **there is a ceiling on what one visitor may park here**, because "temporary"
  is not by itself a defence against being used as a file host.

Expiry is enforced twice: nothing past its time is ever served, and every write
sweeps what has expired. A background sweeper would be the obvious alternative
and the wrong one — a demo scales to zero, so there is no process to run it.
"""

import base64
import hashlib
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import DemoAsset
from app.services.assets import ASSET_RE, AssetError, MAX_ASSET_SIZE

#: How long an upload survives. Long enough to build a form and print it;
#: short enough that nothing anybody leaves here is still there tomorrow.
TTL = timedelta(hours=1)

#: What one visitor may hold at once. A demo is a shop window, not storage.
MAX_FILES_PER_OWNER = 10
MAX_BYTES_PER_OWNER = 20 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def sweep(session: AsyncSession) -> int:
    """Delete everything past its expiry. Returns how many rows went."""
    result = await session.execute(delete(DemoAsset).where(DemoAsset.expires_at <= _now()))
    await session.commit()
    return result.rowcount or 0


async def store(
    session: AsyncSession, owner: str, filename: str, mime_type: str, data: bytes
) -> DemoAsset:
    if not data:
        raise AssetError("Empty file")
    if len(data) > MAX_ASSET_SIZE:
        raise AssetError(f"Asset exceeds {MAX_ASSET_SIZE // (1024 * 1024)} MB limit")

    await sweep(session)
    sha = hashlib.sha256(data).hexdigest()

    existing = (
        await session.execute(
            select(DemoAsset).where(DemoAsset.sha256 == sha, DemoAsset.owner == owner)
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Same file again: push its expiry out rather than refuse it — the
        # visitor is plainly still working with it.
        existing.expires_at = _now() + TTL
        await session.commit()
        return existing

    held = (
        await session.execute(
            select(func.count(), func.coalesce(func.sum(DemoAsset.size), 0)).where(
                DemoAsset.owner == owner
            )
        )
    ).one()
    if held[0] >= MAX_FILES_PER_OWNER or held[1] + len(data) > MAX_BYTES_PER_OWNER:
        raise AssetError(
            f"A demo holds at most {MAX_FILES_PER_OWNER} files and "
            f"{MAX_BYTES_PER_OWNER // (1024 * 1024)} MB per visitor. "
            "Uploads here are cleared within the hour; run your own instance to keep them."
        )

    asset = DemoAsset(
        sha256=sha,
        owner=owner,
        filename=filename,
        mime_type=mime_type,
        size=len(data),
        data=data,
        expires_at=_now() + TTL,
    )
    session.add(asset)
    try:
        await session.commit()
        return asset
    except IntegrityError:
        # The same visitor uploading the same bytes twice at once.
        await session.rollback()
        return (
            await session.execute(
                select(DemoAsset).where(DemoAsset.sha256 == sha, DemoAsset.owner == owner)
            )
        ).scalar_one()


async def get(session: AsyncSession, owner: str, sha256: str) -> DemoAsset | None:
    """One visitor's file, and only while it is still alive.

    Both conditions are load-bearing. Without the owner, knowing a hash would be
    enough to read somebody else's upload; without the expiry, a row the sweep
    has not reached yet would still be served.
    """
    return (
        await session.execute(
            select(DemoAsset).where(
                DemoAsset.sha256 == sha256,
                DemoAsset.owner == owner,
                DemoAsset.expires_at > _now(),
            )
        )
    ).scalar_one_or_none()


async def list_for(session: AsyncSession, owner: str):
    """This visitor's live uploads, newest first. The blob is not selected."""
    rows = (
        await session.execute(
            select(
                DemoAsset.sha256,
                DemoAsset.filename,
                DemoAsset.mime_type,
                DemoAsset.size,
                DemoAsset.created_at,
            )
            .where(DemoAsset.owner == owner, DemoAsset.expires_at > _now())
            .order_by(DemoAsset.created_at.desc())
        )
    ).all()
    return rows, len(rows)


async def inline(session: AsyncSession, owner: str, html: str) -> str:
    """Resolve `asset://` references against this visitor's uploads.

    Deliberately not cached. The shared asset cache is keyed by content hash,
    which is safe when a hash means the same bytes to everyone; here it would
    mean serving one visitor's upload to another, which is the single thing this
    module exists to prevent.
    """
    hashes = set(ASSET_RE.findall(html))
    if not hashes:
        return html
    mapping: dict[str, str] = {}
    for sha in hashes:
        asset = await get(session, owner, sha)
        if asset is None:
            raise AssetError(
                f"Unknown asset referenced by template: asset://{sha}. "
                "Uploads on the demo belong to one browser and are cleared within the hour."
            )
        mapping[sha] = f"data:{asset.mime_type};base64,{base64.b64encode(asset.data).decode()}"
    return re.sub(ASSET_RE, lambda m: mapping[m.group(1)], html)
