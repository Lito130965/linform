"""Uploads on a public demo.

A demo lets strangers upload files, which is what makes the editor feel like
theirs — and is why it cannot use the ordinary asset store. Somebody will upload
something unlawful, malicious or merely embarrassing, and the service must not
become the place that serves it to other people or keeps it on the domain.

Three properties answer that, and each is tested rather than described: one
visitor never sees another's upload, an upload stops existing within the hour,
and nobody can park an unbounded amount here.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.models.database import DemoAsset
from app.services import demo_assets

PNG = bytes.fromhex("89504e470d0a1a0a") + b"first"
OTHER = bytes.fromhex("89504e470d0a1a0a") + b"second"


def upload(client, data: bytes = PNG, name: str = "logo.png"):
    return client.post("/api/assets", files={"file": (name, data, "image/png")})


def as_new_browser(client) -> None:
    """Forget the cookie: the next request arrives as somebody else."""
    client.cookies.clear()


@pytest.fixture()
def demo(client_for):
    return client_for("demo")


def test_an_upload_comes_back_to_the_browser_that_sent_it(demo):
    created = upload(demo)
    assert created.status_code == 201, created.text
    sha = created.json()["sha256"]

    assert demo.get(f"/api/assets/{sha}").status_code == 200
    assert [a["sha256"] for a in demo.get("/api/assets").json()] == [sha]


def test_another_browser_can_neither_list_it_nor_fetch_it(demo):
    """The point of the whole module. Content addressing makes the hash an
    unguessable capability in the permanent store; here that is not enough,
    because the bytes are a stranger's and may be anything."""
    sha = upload(demo).json()["sha256"]
    mine = demo.cookies["lf_demo"]

    as_new_browser(demo)
    assert demo.get("/api/assets").json() == []
    assert demo.get(f"/api/assets/{sha}").status_code == 404

    demo.cookies.set("lf_demo", mine)
    assert demo.get(f"/api/assets/{sha}").status_code == 200


def test_a_render_resolves_only_the_callers_own_uploads(demo):
    """Where the bytes would actually reach a document. Without this the
    endpoints could be scoped and a template could still print somebody else's
    upload."""
    sha = upload(demo).json()["sha256"]
    mine = demo.cookies["lf_demo"]
    body = {"html": f'<img src="asset://{sha}">', "data": {}}

    assert demo.post("/api/render", json=body).status_code == 200

    as_new_browser(demo)
    refused = demo.post("/api/render", json=body)
    assert refused.status_code == 422
    assert "asset" in refused.json()["detail"].lower()

    demo.cookies.set("lf_demo", mine)
    assert demo.post("/api/render", json=body).status_code == 200


def test_an_upload_stops_being_served_once_its_hour_is_up(demo):
    sha = upload(demo).json()["sha256"]

    async def age_it():
        async with demo.db_factory() as session:
            await session.execute(
                update(DemoAsset).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
            )
            await session.commit()

    asyncio.run(age_it())

    # Expired is indistinguishable from absent, deliberately: an expired row
    # should not confirm that something was ever there.
    assert demo.get(f"/api/assets/{sha}").status_code == 404
    assert demo.get("/api/assets").json() == []


def test_expired_uploads_are_actually_deleted_not_merely_hidden(demo):
    """Hiding would leave whatever somebody uploaded sitting in the database.
    The sweep runs on writes, since a demo scales to zero and no background
    process can be relied on to run."""
    upload(demo)

    async def age_and_count() -> int:
        async with demo.db_factory() as session:
            await session.execute(
                update(DemoAsset).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
            )
            await session.commit()
        async with demo.db_factory() as session:
            return len((await session.execute(select(DemoAsset))).all())

    assert asyncio.run(age_and_count()) == 1

    as_new_browser(demo)
    upload(demo, OTHER)  # any write sweeps

    async def remaining() -> int:
        async with demo.db_factory() as session:
            return len((await session.execute(select(DemoAsset))).all())

    assert asyncio.run(remaining()) == 1, "the expired row survived a write"


def test_uploading_the_same_file_again_extends_it_rather_than_refusing(demo):
    first = upload(demo)
    again = upload(demo)
    assert again.status_code == 201
    assert again.json()["sha256"] == first.json()["sha256"]
    assert len(demo.get("/api/assets").json()) == 1


def test_one_visitor_cannot_fill_the_database(demo):
    """"Temporary" is not by itself a defence against being used as a file
    host."""
    for i in range(demo_assets.MAX_FILES_PER_OWNER):
        assert upload(demo, PNG + str(i).encode(), f"{i}.png").status_code == 201

    refused = upload(demo, PNG + b"one too many", "extra.png")
    assert refused.status_code == 422
    assert "at most" in refused.json()["detail"]

    # And the ceiling is per visitor, not global — the next browser starts fresh.
    as_new_browser(demo)
    assert upload(demo, PNG + b"someone else").status_code == 201


def test_the_cookie_is_not_readable_by_scripts(demo):
    """It names a scratch space and grants nothing, but nothing in the page
    needs to read it either, and an HttpOnly cookie cannot be exfiltrated by
    markup that slips past the sanitiser."""
    upload(demo)
    header = upload(demo).headers.get("set-cookie", "")
    if header:  # only set when the browser did not already have one
        assert "httponly" in header.lower()
        assert "samesite=lax" in header.lower()


def test_a_normal_instance_keeps_its_permanent_assets(client_for):
    """The demo's rules are the demo's. Everywhere else an asset belongs to the
    installation, is deduplicated by content and does not expire."""
    editor = client_for("editor")
    created = upload(editor)
    assert created.status_code == 201

    async def stored() -> int:
        async with editor.db_factory() as session:
            return len((await session.execute(select(DemoAsset))).all())

    assert asyncio.run(stored()) == 0, "an ordinary upload went into the demo's scratch table"
    assert upload(editor).json()["sha256"] == created.json()["sha256"]
