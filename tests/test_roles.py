"""Deployment roles.

A split deployment runs editor nodes for people and render nodes for consuming
applications. The claim being tested is not "the render node refuses management
calls" but something stronger and simpler to reason about: it has no management
API at all. A route that does not exist cannot be misconfigured, and no
credential — leaked, stolen or merely over-scoped — reaches it.
"""

import pytest

MANAGEMENT = [
    ("get", "/api/templates"),
    ("post", "/api/templates"),
    ("get", "/api/assets"),
    ("get", "/api/directories"),
    ("get", "/api/examples"),
    ("get", "/api/admin/users"),
    ("get", "/api/auth/me"),
]


def _seed(client, code="roles", html="<p>{{ who }}</p>"):
    """Publish a template through the API of a node that has one."""
    client.post("/api/templates", json={"code": code, "name": code})
    draft = client.post(
        f"/api/templates/{code}/drafts", json={"html_content": html, "comment": "seed"}
    ).json()
    assert client.post(f"/api/templates/{code}/drafts/{draft['id']}/publish").status_code == 200


@pytest.mark.parametrize("method,path", MANAGEMENT)
def test_a_render_node_has_no_management_api(client_for, method, path):
    render_node = client_for("render")
    assert getattr(render_node, method)(path).status_code == 404, (
        f"{method.upper()} {path} answered on a render node"
    )


@pytest.mark.parametrize("method,path", MANAGEMENT)
def test_an_editor_node_keeps_the_management_api(client_for, method, path):
    editor = client_for("editor")
    assert getattr(editor, method)(path).status_code != 404


def test_a_render_node_serves_the_integration_endpoint(client_for):
    render_node = client_for("render")
    # Seeded directly, since this node has no API to publish through — which is
    # the point of the role.
    import asyncio

    from app.models.database import Template, TemplateVersion, VersionStatus

    async def seed():
        async with render_node.db_factory() as session:
            template = Template(code="direct", name="direct")
            session.add(template)
            await session.flush()
            session.add(
                TemplateVersion(
                    template_id=template.id,
                    version=1,
                    status=VersionStatus.published,
                    html_content="<p>{{ who }}</p>",
                )
            )
            await session.commit()

    asyncio.run(seed())

    rendered = render_node.post("/api/render/direct", json={"who": "world"})
    assert rendered.status_code == 200, rendered.text
    assert rendered.headers["x-linform-version"] == "1"
    assert render_node.post("/api/render/direct/versions/1", json={"who": "w"}).status_code == 200


def test_an_editor_node_does_not_serve_consuming_applications(client_for):
    """The other half of the split. An editor node is for people; pointing a
    consuming application at it works today and would quietly make the one node
    nobody scales part of the render path."""
    editor = client_for("editor")
    _seed(editor)

    assert editor.post("/api/render/roles", json={"who": "x"}).status_code == 404
    assert editor.post("/api/render/roles/versions/1", json={"who": "x"}).status_code == 404


def test_every_role_can_render_markup_it_was_handed(client_for):
    """The preview path, and the way to use the service without storing
    anything. Both kinds of node keep it."""
    for role in ("all", "editor", "render"):
        client = client_for(role)
        resp = client.post(
            "/api/render", json={"html": "<p>{{ who }}</p>", "data": {"who": "x"}}
        )
        assert resp.status_code == 200, f"{role}: {resp.text}"


def test_every_role_answers_the_probes_an_orchestrator_uses(client_for):
    """An orchestrator should not have to know what a container is for to
    decide whether it is alive."""
    for role in ("all", "editor", "render"):
        client = client_for(role)
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code in (200, 503)


def test_a_render_node_serves_no_editor_bundle(client_for):
    """The SPA is only useful next to the API it calls, and a node exposed to
    consuming applications should not be handing out a login page."""
    render_node = client_for("render")
    assert render_node.get("/").status_code == 404


def test_an_editor_serving_the_bundle_still_answers_404_under_api(tmp_path, monkeypatch):
    """With the SPA mounted, an unmatched /api request used to fall through to
    the static file server, which knows only GET and HEAD — so a consuming
    application pointed at an editor node got 405, a reply about the file server
    rather than about the service. Locally app/static does not exist, so this
    only appeared in the container."""
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app
    from tests.conftest import StubRenderer

    monkeypatch.setattr("app.main.WeasyPrintRenderer", StubRenderer)
    (tmp_path / "index.html").write_text("<html>editor</html>", encoding="utf-8")
    service = create_app(Settings(role="editor"), static_dir=tmp_path)

    with TestClient(service) as client:
        assert client.get("/").status_code == 200, "the bundle should still be served"
        assert client.post("/api/render/anything", json={}).status_code == 404
        assert client.post("/api/no/such/endpoint", json={}).status_code == 404


def test_an_unknown_role_stops_the_process_instead_of_serving_everything(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(role="rendr")
