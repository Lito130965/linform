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


class StubRenderer:
    """Pretends to be WeasyPrint; records the HTML it was asked to render."""

    def __init__(self, **kwargs):
        self.last_html: str | None = None

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
        yield client

    app.dependency_overrides.clear()
