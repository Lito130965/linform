"""Concurrency invariants, against PostgreSQL.

The database is where these rules live on purpose — a UniqueConstraint on the
version number and a partial unique index for "one published version per
template" — precisely so correctness does not depend on there being one pod.
Until now that was only ever exercised sequentially, which proves nothing about
the race it was written for.

PostgreSQL specifically, not SQLite: partial-index semantics and locking differ,
and the deployment target is PostgreSQL. Skipped unless LINFORM_TEST_PG_URL
points at a database the test may create and drop tables in — CI and the test
server set it; a bare checkout skips.
"""

import asyncio
import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.models.database import Base, Template, TemplateVersion, VersionStatus
from app.services import versioning
from app.services.versioning import ConflictError

PG_URL = os.environ.get("LINFORM_TEST_PG_URL", "")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="set LINFORM_TEST_PG_URL to run the PostgreSQL concurrency tests"
)


@pytest.fixture()
def pg():
    """A fresh schema per test, and a session factory over it."""

    async def setup():
        # NullPool: every task gets its own connection, which is the point —
        # pooled reuse would serialize the very contention under test.
        engine = create_async_engine(PG_URL, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        return engine

    engine = asyncio.run(setup())
    yield async_sessionmaker(engine, expire_on_commit=False)

    async def teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(teardown())


def _run(coro):
    return asyncio.run(coro)


async def _seed_template(factory, code: str = "inv") -> None:
    async with factory() as session:
        await versioning.create_template(session, code, "Invoice")


async def _gather_outcomes(coros) -> tuple[list, list]:
    """Run everything at once; return (successes, exceptions)."""
    results = await asyncio.gather(*coros, return_exceptions=True)
    ok = [r for r in results if not isinstance(r, BaseException)]
    failed = [r for r in results if isinstance(r, BaseException)]
    return ok, failed


def test_parallel_version_creation_never_reuses_a_number(pg):
    """Two sessions computing "the next version number" will compute the same
    one. The unique constraint decides and the loser retries — that retry is
    what this checks, from separate connections."""

    async def scenario():
        await _seed_template(pg)

        async def create(n: int):
            async with pg() as session:
                return await versioning.create_version(
                    session, "inv", f"<p>v{n}</p>", comment=f"writer {n}"
                )

        ok, failed = await _gather_outcomes([create(i) for i in range(5)])
        # Every writer either got a number or was told to retry; none crashed.
        assert all(isinstance(e, ConflictError) for e in failed), failed

        async with pg() as session:
            versions = await versioning.get_versions(session, "inv")
        numbers = sorted(v.version for v in versions)
        assert len(numbers) == len(ok)
        assert numbers == sorted(set(numbers)), f"duplicate version numbers: {numbers}"
        assert numbers == list(range(1, len(numbers) + 1)), f"gaps in numbering: {numbers}"

    _run(scenario())


def test_parallel_publish_leaves_exactly_one_published_version(pg):
    """The partial unique index is the whole reason 'one published version' is
    safe with any number of replicas. Two publishes at once must not produce
    two published rows — nor leave the template with none."""

    async def scenario():
        await _seed_template(pg)
        async with pg() as session:
            for n in range(1, 4):
                await versioning.create_version(session, "inv", f"<p>v{n}</p>")

        async def publish(version: int):
            async with pg() as session:
                return await versioning.publish_version(session, "inv", version)

        ok, failed = await _gather_outcomes([publish(v) for v in (1, 2, 3)])
        assert all(isinstance(e, ConflictError) for e in failed), failed
        assert ok, "every concurrent publish failed; at least one must win"

        async with pg() as session:
            versions = await versioning.get_versions(session, "inv")
        published = [v.version for v in versions if v.status == VersionStatus.published]
        assert len(published) == 1, f"expected exactly one published version, got {published}"

    _run(scenario())


def test_publishing_the_same_version_twice_at_once_is_harmless(pg):
    """The idempotent case: two callers publish the same version. Neither may
    end up demoting it to leave nothing published."""

    async def scenario():
        await _seed_template(pg)
        async with pg() as session:
            await versioning.create_version(session, "inv", "<p>v1</p>")

        async def publish():
            async with pg() as session:
                return await versioning.publish_version(session, "inv", 1)

        await _gather_outcomes([publish() for _ in range(4)])

        async with pg() as session:
            row = await versioning.get_published_version(session, "inv")
        assert row.version == 1

    _run(scenario())


def test_parallel_upload_of_identical_asset_bytes_stores_one_row(pg):
    """Assets are content-addressed, so the same bytes twice must converge on
    one row rather than racing to a duplicate or an unhandled integrity error."""

    async def scenario():
        from app.services import assets as assets_service

        payload = b"\x89PNG\r\n\x1a\n" + b"same bytes" * 100

        async def upload(n: int):
            async with pg() as session:
                return await assets_service.store_asset(
                    session, filename=f"logo{n}.png", mime_type="image/png", data=payload
                )

        ok, failed = await _gather_outcomes([upload(i) for i in range(4)])
        assert not failed, failed
        digests = {a.sha256 for a in ok}
        assert len(digests) == 1, "identical bytes produced different digests"

        async with pg() as session:
            stored = await assets_service.list_assets(session)
        assert len(stored) == 1, f"expected deduplication, found {len(stored)} rows"

    _run(scenario())


def test_a_template_code_is_unique_under_contention(pg):
    async def scenario():
        async def create():
            async with pg() as session:
                return await versioning.create_template(session, "dup", "Duplicate")

        ok, failed = await _gather_outcomes([create() for _ in range(4)])
        assert len(ok) == 1, f"expected one winner, got {len(ok)}"
        assert all(isinstance(e, ConflictError) for e in failed), failed

    _run(scenario())
