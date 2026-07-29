"""Liveness vs readiness. The distinction matters operationally: a liveness
probe that checks the database would have the orchestrator RESTART containers
during a brief database outage, turning a dependency blip into a restart storm.
Readiness only takes the instance out of the load balancer."""

from app.main import app


def test_health_is_liveness_and_checks_nothing_external(db_client):
    resp = db_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ready_reports_database_and_renderer(db_client):
    resp = db_client.get("/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"] == {"database": "ok", "renderer": "ok"}


def test_ready_is_503_when_the_render_pool_is_broken(db_client):
    renderer = app.state.renderer
    renderer.healthy = False
    try:
        resp = db_client.get("/ready")
        assert resp.status_code == 503
        assert resp.json()["checks"]["renderer"] == "broken"
        # Liveness stays green: the process is fine, restarting it is not the fix
        # the orchestrator should reach for first.
        assert db_client.get("/health").status_code == 200
    finally:
        renderer.healthy = True


def test_ready_is_503_when_the_database_is_unreachable(db_client, monkeypatch):
    import app.main as main

    def broken_factory():
        raise RuntimeError("database is down")

    monkeypatch.setattr(main, "get_session_factory", broken_factory)
    resp = db_client.get("/ready")
    assert resp.status_code == 503
    assert resp.json()["checks"]["database"] == "unavailable"


def test_an_already_broken_pool_is_reported_as_a_render_error_not_a_crash():
    """A BrokenExecutor never recovers, so the instance must stop advertising
    itself as ready instead of accepting renders it cannot serve. The
    already-broken case raises from submit() rather than from the await, which
    is why submission has to sit inside the error handling."""
    import asyncio
    from concurrent.futures import BrokenExecutor

    import pytest

    from app.services.renderer import RenderError, WeasyPrintRenderer

    class DeadPool:
        def submit(self, *_a, **_k):
            raise BrokenExecutor("pool is already dead")

        def shutdown(self, **_k):
            pass

    r = WeasyPrintRenderer(
        max_workers=1, timeout_seconds=5, allow_external_urls=False, allowed_url_hosts=[]
    )
    r.shutdown()
    r._pool = DeadPool()
    assert r.healthy is True
    with pytest.raises(RenderError):
        asyncio.run(r.render_pdf("<p>x</p>"))
    assert r.healthy is False
    # The slot was released, not leaked, despite the failure.
    assert r._limiter.inflight == 0
