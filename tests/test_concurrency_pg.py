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


async def _seed_drafts(factory, code: str, count: int) -> list[int]:
    ids = []
    async with factory() as session:
        for n in range(count):
            draft = await versioning.create_draft(session, code, f"<p>v{n}</p>")
            ids.append(draft.id)
    return ids


async def _gather_outcomes(coros) -> tuple[list, list]:
    """Run everything at once; return (successes, exceptions)."""
    results = await asyncio.gather(*coros, return_exceptions=True)
    ok = [r for r in results if not isinstance(r, BaseException)]
    failed = [r for r in results if isinstance(r, BaseException)]
    return ok, failed


def test_parallel_publication_never_reuses_a_number(pg):
    """Numbers are minted at publication, so this is where two writers can
    compute the same "next number". The unique constraint decides and the loser
    retries — that retry is what this checks, from separate connections."""

    async def scenario():
        await _seed_template(pg)
        draft_ids = await _seed_drafts(pg, "inv", 5)

        async def publish(draft_id: int):
            async with pg() as session:
                return await versioning.publish_draft(session, "inv", draft_id)

        ok, failed = await _gather_outcomes([publish(i) for i in draft_ids])
        # Every writer either got a number or was told to retry; none crashed.
        assert all(isinstance(e, ConflictError) for e in failed), failed
        assert ok, "at least one publication must win"

        async with pg() as session:
            versions = await versioning.list_versions(session, "inv")
        numbers = sorted(v.version for v in versions)
        assert len(numbers) == len(ok)
        assert numbers == sorted(set(numbers)), f"duplicate version numbers: {numbers}"
        assert numbers == list(range(1, len(numbers) + 1)), f"gaps in numbering: {numbers}"

        # Whatever happened, exactly one of them is what consumers get.
        published = [v for v in versions if v.status == VersionStatus.published]
        assert len(published) == 1, f"expected one current version, got {published}"

    _run(scenario())


def test_parallel_publication_leaves_exactly_one_current_version(pg):
    """The partial unique index is the whole reason "one current version" is
    safe with any number of replicas. Concurrent publications must not produce
    two live rows — nor leave the template with none."""

    async def scenario():
        await _seed_template(pg)
        draft_ids = await _seed_drafts(pg, "inv", 3)

        async def publish(draft_id: int):
            async with pg() as session:
                return await versioning.publish_draft(session, "inv", draft_id)

        ok, failed = await _gather_outcomes([publish(i) for i in draft_ids])
        assert all(isinstance(e, ConflictError) for e in failed), failed
        assert ok, "every concurrent publication failed; at least one must win"

        async with pg() as session:
            current = await versioning.get_current_version(session, "inv")
        assert current.status == VersionStatus.published

        async with pg() as session:
            versions = await versioning.list_versions(session, "inv")
        published = [v.version for v in versions if v.status == VersionStatus.published]
        assert len(published) == 1, f"expected exactly one current version, got {published}"

    _run(scenario())


def test_parallel_rollback_to_different_versions_settles_on_one(pg):
    """Two operators rolling back to different versions at the same moment: the
    outcome may be either one, but it must be exactly one."""

    async def scenario():
        await _seed_template(pg)
        draft_ids = await _seed_drafts(pg, "inv", 3)
        async with pg() as session:
            for draft_id in draft_ids:
                await versioning.publish_draft(session, "inv", draft_id)

        async def make_current(version: int):
            async with pg() as session:
                return await versioning.set_current_version(session, "inv", version)

        ok, failed = await _gather_outcomes([make_current(v) for v in (1, 2, 3)])
        assert all(isinstance(e, ConflictError) for e in failed), failed

        async with pg() as session:
            versions = await versioning.list_versions(session, "inv")
        published = [v.version for v in versions if v.status == VersionStatus.published]
        assert len(published) == 1, f"expected exactly one current version, got {published}"

    _run(scenario())


def test_rolling_back_to_the_same_version_concurrently_is_harmless(pg):
    """The idempotent case: several callers point at the same version. None of
    them may end up demoting it and leaving nothing current."""

    async def scenario():
        await _seed_template(pg)
        draft_ids = await _seed_drafts(pg, "inv", 2)
        async with pg() as session:
            for draft_id in draft_ids:
                await versioning.publish_draft(session, "inv", draft_id)

        async def make_current():
            async with pg() as session:
                return await versioning.set_current_version(session, "inv", 1)

        await _gather_outcomes([make_current() for _ in range(4)])

        async with pg() as session:
            row = await versioning.get_current_version(session, "inv")
        assert row.version == 1

    _run(scenario())


def test_parallel_upload_of_identical_asset_bytes_stores_one_row(pg):
    """Assets are content-addressed, so the same bytes twice must converge on
    one row rather than racing to a duplicate or an unhandled integrity error."""

    async def scenario():
        from app.services import assets as assets_service

        # A PNG signature, written without escapes so the source cannot be
        # mangled by a tool that interprets them.
        payload = bytes.fromhex("89504e470d0a1a0a") + b"same bytes" * 100

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
            stored, total = await assets_service.list_assets(session)
        assert total == 1, f"expected deduplication, found {total} rows"
        assert len(stored) == 1

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
