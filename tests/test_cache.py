"""The render path's caches.

Two questions are worth testing and they are different questions. First, does
the cache primitive hold its bounds — because an unbounded cache is a memory
leak that only shows up in production. Second, does caching change any answer
the service gives — because a cache that serves the previous version after a
rollback has broken the one operation people reach for when something is wrong.
"""

import time

import pytest
from sqlalchemy import event, text

from app.services import cache


@pytest.fixture()
def counted(db_client):
    """Count SQL statements issued while inside the `with` block."""
    from contextlib import contextmanager

    @contextmanager
    def counter():
        seen = []

        def before(conn, cursor, statement, *args):
            seen.append(statement)

        event.listen(db_client.db_engine.sync_engine, "before_cursor_execute", before)
        try:
            yield seen
        finally:
            event.remove(db_client.db_engine.sync_engine, "before_cursor_execute", before)

    return counter


# --- the primitive ---------------------------------------------------------


def test_the_least_recently_used_entry_is_the_one_evicted():
    c = cache.Cache("test-lru", max_entries=2)
    c.put("hot", "a", size=1)
    c.put("cold", "b", size=1)
    c.get("hot")  # touching it must matter
    c.put("new", "c", size=1)

    assert c.get("hot") == "a", "the entry in use was evicted; that is FIFO, not LRU"
    assert c.get("cold") is None


def test_the_byte_budget_is_what_bounds_memory_not_the_entry_count():
    # The bug this replaces: 64 entries sounds bounded, and at 10 MB an asset
    # it is 640 MB — per replica.
    c = cache.Cache("test-bytes", max_bytes=2 * 1024 * 1024)
    for i in range(3):
        c.put(f"asset-{i}", "x", size=1024 * 1024)

    assert c.nbytes <= 2 * 1024 * 1024
    assert len(c) == 2


def test_a_value_larger_than_the_whole_budget_is_skipped_not_swapped_in():
    c = cache.Cache("test-huge", max_bytes=1000)
    c.put("small", "a", size=100)
    c.put("enormous", "b", size=5000)

    assert c.get("enormous") is None
    assert c.get("small") == "a", "one oversized value emptied the cache on its way to not fitting"


def test_an_entry_older_than_the_ttl_is_a_miss():
    c = cache.Cache("test-ttl", max_entries=8, ttl_seconds=0.05)
    c.put("k", "v", size=1)
    assert c.get("k") == "v"

    time.sleep(0.1)
    assert c.get("k") is None


def test_a_zero_ttl_means_off_rather_than_expires_very_quickly():
    # The distinction is not pedantic: the monotonic clock ticks in whole
    # milliseconds on some platforms, so "expires immediately" would still serve
    # stale answers for as long as the clock has not moved.
    c = cache.Cache("test-off", max_entries=8, ttl_seconds=0)
    c.put("k", "v", size=1)

    assert c.disabled
    assert c.get("k") is None
    assert len(c) == 0


def test_an_unbounded_cache_is_refused_at_construction():
    with pytest.raises(ValueError):
        cache.Cache("test-unbounded")


def test_the_caches_report_themselves_to_prometheus():
    c = cache.Cache("test-metrics", max_bytes=1024)
    c.put("k", "v", size=10)
    c.get("k")
    c.get("absent")

    from app.core.metrics import render_output

    payload = render_output()[0].decode()
    assert 'linform_cache_hits_total{cache="test-metrics"} 1.0' in payload
    assert 'linform_cache_misses_total{cache="test-metrics"} 1.0' in payload
    assert 'linform_cache_bytes{cache="test-metrics"} 10.0' in payload


# --- what the service answers ----------------------------------------------


def _publish(client, code, html, name="Cached"):
    client.post("/api/templates", json={"code": code, "name": name})
    draft = client.post(
        f"/api/templates/{code}/drafts", json={"html_content": html, "comment": "seed"}
    ).json()
    resp = client.post(f"/api/templates/{code}/drafts/{draft['id']}/publish")
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def test_a_second_render_of_the_same_code_reaches_no_database(db_client, counted):
    _publish(db_client, "cached", "<p>{{ who }}</p>")

    with counted() as first:
        assert db_client.post("/api/render/cached", json={"who": "world"}).status_code == 200
    assert first, "the first render should have resolved the code against the database"

    with counted() as second:
        assert db_client.post("/api/render/cached", json={"who": "world"}).status_code == 200
    assert second == [], f"a cache hit still issued {len(second)} statements: {second}"


def test_publishing_takes_effect_at_once_on_the_replica_that_published(db_client):
    _publish(db_client, "moves", "<p>one</p>")
    db_client.post("/api/render/moves", json={})
    assert "one" in db_client.stub_renderer.last_html

    draft = db_client.post(
        "/api/templates/moves/drafts", json={"html_content": "<p>two</p>", "comment": "next"}
    ).json()
    db_client.post(f"/api/templates/moves/drafts/{draft['id']}/publish")

    db_client.post("/api/render/moves", json={})
    assert "two" in db_client.stub_renderer.last_html, "publishing was hidden by the cache"


def test_rollback_takes_effect_at_once(db_client):
    """The one that matters most: rolling back is what people do when something
    is already wrong, and a cache that delays it makes an incident longer."""
    _publish(db_client, "roll", "<p>v1</p>")
    draft = db_client.post(
        "/api/templates/roll/drafts", json={"html_content": "<p>v2</p>", "comment": "next"}
    ).json()
    db_client.post(f"/api/templates/roll/drafts/{draft['id']}/publish")

    db_client.post("/api/render/roll", json={})
    assert "v2" in db_client.stub_renderer.last_html

    db_client.post("/api/templates/roll/versions/1/current")

    resp = db_client.post("/api/render/roll", json={})
    assert resp.headers["x-linform-version"] == "1"
    assert "v1" in db_client.stub_renderer.last_html, "the rollback was hidden by the cache"


def test_archiving_takes_effect_at_once(db_client):
    _publish(db_client, "filed", "<p>x</p>")
    assert db_client.post("/api/render/filed", json={}).status_code == 200

    db_client.delete("/api/templates/filed")
    assert db_client.post("/api/render/filed", json={}).status_code == 410

    db_client.post("/api/templates/filed/restore")
    assert db_client.post("/api/render/filed", json={}).status_code == 200


def test_a_pinned_version_survives_archiving_and_is_still_cached(db_client, counted):
    _publish(db_client, "pinned", "<p>frozen</p>")
    db_client.post("/api/render/pinned/versions/1", json={})
    db_client.delete("/api/templates/pinned")

    with counted() as statements:
        resp = db_client.post("/api/render/pinned/versions/1", json={})
    assert resp.status_code == 200, "archiving must not touch a version somebody pinned"
    assert statements == []


def test_a_code_that_was_never_published_is_not_answered_from_a_stale_404(db_client):
    # Remembering the 404 keeps a misconfigured consumer from spending two
    # queries per request forever; publishing has to clear it immediately.
    assert db_client.post("/api/render/later", json={}).status_code == 404
    _publish(db_client, "later", "<p>now</p>")
    assert db_client.post("/api/render/later", json={}).status_code == 200


def test_a_template_with_assets_renders_from_memory_after_the_first_time(db_client, counted):
    """Assets are the reason a cache is worth having at all: the logo is a blob
    in the database, and without this every render of every replica pulls it
    again."""
    upload = db_client.post(
        "/api/assets",
        files={"file": ("logo.png", bytes.fromhex("89504e470d0a1a0a"), "image/png")},
    )
    assert upload.status_code in (200, 201), upload.text
    sha = upload.json()["sha256"]
    _publish(db_client, "withlogo", f'<p><img src="asset://{sha}"></p>')

    db_client.post("/api/render/withlogo", json={})
    with counted() as statements:
        db_client.post("/api/render/withlogo", json={})

    assert statements == [], f"the asset was fetched again: {statements}"
    assert "data:image/png;base64," in db_client.stub_renderer.last_html


def test_a_change_made_by_another_replica_is_picked_up_within_the_ttl(db_client, monkeypatch):
    """Local invalidation covers the replica that made the change. Everyone else
    follows when the entry ages out, and this is that bound — written by editing
    the database behind the cache's back, which is exactly what another replica
    looks like from here."""
    _publish(db_client, "elsewhere", "<p>before</p>")
    db_client.post("/api/render/elsewhere", json={})

    async def edit_directly():
        async with db_client.db_factory() as session:
            await session.execute(
                text("UPDATE template_versions SET html_content = '<p>after</p>'")
            )
            await session.commit()

    import asyncio

    asyncio.run(edit_directly())
    monkeypatch.setattr(cache.TARGETS, "ttl_seconds", 0.05)

    db_client.post("/api/render/elsewhere", json={})
    assert "before" in db_client.stub_renderer.last_html, "expected the cached answer"

    time.sleep(0.1)
    db_client.post("/api/render/elsewhere", json={})
    assert "after" in db_client.stub_renderer.last_html, "the entry never aged out"


def test_with_caching_switched_off_every_render_resolves_against_the_database(
    db_client, counted, monkeypatch
):
    _publish(db_client, "nocache", "<p>x</p>")
    monkeypatch.setattr(cache.TARGETS, "disabled", True)
    db_client.post("/api/render/nocache", json={})

    with counted() as statements:
        db_client.post("/api/render/nocache", json={})
    assert statements, "caching is off, so this render had to ask the database"
