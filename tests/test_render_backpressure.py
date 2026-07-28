"""Rendering is synchronous with a hard ceiling: past the in-flight limit the
service sheds load with 429 rather than queueing without bound. (Imports the
renderer module, not weasyprint — the engine is only imported inside a worker,
so these run on a bare box.)"""

import asyncio

import pytest

from app.services.renderer import (
    ConcurrencyLimiter,
    RenderBusy,
    WeasyPrintRenderer,
)

RENDER_BODY = {"html": "<p>{{ x }}</p>", "data": {"x": 1}, "strict": False}


def test_limiter_admits_up_to_the_limit_then_refuses():
    lim = ConcurrencyLimiter(2)
    assert lim.try_acquire() is True
    assert lim.try_acquire() is True
    assert lim.try_acquire() is False  # full
    lim.release()
    assert lim.try_acquire() is True  # a freed slot admits again


def test_concurrency_defaults_to_twice_the_worker_count():
    r = WeasyPrintRenderer(
        max_workers=3,
        timeout_seconds=5,
        allow_external_urls=False,
        allowed_url_hosts=[],
        max_concurrency=0,
    )
    try:
        assert r._limiter.limit == 6
    finally:
        r.shutdown()


def test_explicit_concurrency_wins():
    r = WeasyPrintRenderer(
        max_workers=2,
        timeout_seconds=5,
        allow_external_urls=False,
        allowed_url_hosts=[],
        max_concurrency=1,
    )
    try:
        assert r._limiter.limit == 1
    finally:
        r.shutdown()


def test_renderer_sheds_load_when_full_without_touching_the_engine():
    r = WeasyPrintRenderer(
        max_workers=1,
        timeout_seconds=5,
        allow_external_urls=False,
        allowed_url_hosts=[],
        max_concurrency=1,
    )
    try:
        r._limiter.inflight = 1  # pretend one render already holds the slot
        with pytest.raises(RenderBusy):
            asyncio.run(r.render_pdf("<p>x</p>"))
        # The refusal did not leak the caller's slot accounting.
        assert r._limiter.inflight == 1
    finally:
        r.shutdown()


def test_busy_maps_to_429_with_retry_after(db_client, monkeypatch):
    async def busy(_html: str):
        raise RenderBusy("Server is at capacity")

    monkeypatch.setattr(db_client.stub_renderer, "render_pdf", busy)
    resp = db_client.post("/api/render", json=RENDER_BODY)
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "2"
    assert "capacity" in resp.json()["detail"]
