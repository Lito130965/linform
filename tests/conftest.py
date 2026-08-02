"""Shared fixtures: file-based SQLite and a stub renderer so the full API
lifecycle is testable without Pango/WeasyPrint (e.g. on bare Windows)."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.db import get_session
from app.main import app
from app.models.database import Base
from app.services import cache


@pytest.fixture(autouse=True)
def _empty_caches():
    """Start every test with cold caches.

    Production never needs this: one process talks to one database for its whole
    life, which is the assumption the render caches are built on. The suite
    breaks that assumption on purpose — a fresh database per test, and template
    code `invoice` meaning something different in each — so without this a test
    would be served the previous test's template.
    """
    cache.clear_all()
    yield
    cache.clear_all()


class StubRenderer:
    """Pretends to be WeasyPrint; records the HTML it was asked to render.

    Carries the same surface the real renderer exposes to the rest of the app
    (`healthy`, `inflight`), so a double never hides a call the production
    object would have answered."""

    def __init__(self, **kwargs):
        self.last_html: str | None = None
        self.healthy = True
        self.inflight = 0
        self.concurrency_limit = 0

    async def render_pdf(self, html: str) -> bytes:
        self.last_html = html
        return b"%PDF-stub"

    def shutdown(self) -> None:
        pass


@pytest.fixture()
def db_client(monkeypatch, tmp_path):
    """TestClient over a fresh database, with the PDF engine stubbed out."""
    url = f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
    # NullPool: connections never cross event loops (TestClient runs the app
    # in its own loop, schema setup below runs in another).
    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setattr("app.main.WeasyPrintRenderer", StubRenderer)

    with TestClient(app) as client:
        client.stub_renderer = app.state.renderer
        # Exposed so auth tests can seed users/keys straight into the same DB
        # the app reads (the superuser bootstrap normally runs in lifespan from
        # env vars, which tests do not set).
        client.db_factory = factory
        # The engine, so a test can count the statements a request issues —
        # which is the only way to assert that a cache hit reached no database.
        client.db_engine = engine
        yield client

    app.dependency_overrides.clear()
