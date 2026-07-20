"""API tests that produce real PDFs — require WeasyPrint's native libraries
(Pango). They run in the Docker image / Linux CI and are skipped where the
libraries are unavailable (e.g. bare Windows)."""

import pytest

try:
    import weasyprint  # noqa: F401

    HAS_WEASYPRINT = True
except OSError:
    HAS_WEASYPRINT = False

pytestmark = pytest.mark.skipif(not HAS_WEASYPRINT, reason="WeasyPrint native libs unavailable")


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_render_returns_pdf(client):
    resp = client.post(
        "/api/render",
        json={"html": "<h1>Hello {{ name }}</h1>", "data": {"name": "world"}},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF-")


def test_render_multipage(client):
    src = (
        "<style>@page { size: A4; } .item { page-break-inside: avoid; }</style>"
        "{% for i in items %}<p class='item'>Row {{ i }}</p>{% endfor %}"
    )
    resp = client.post("/api/render", json={"html": src, "data": {"items": list(range(200))}})
    assert resp.status_code == 200

    from io import BytesIO

    from pypdf import PdfReader

    assert len(PdfReader(BytesIO(resp.content)).pages) > 1


def test_render_missing_placeholder_is_422(client):
    resp = client.post("/api/render", json={"html": "<p>{{ absent }}</p>", "data": {}})
    assert resp.status_code == 422
    assert "absent" in resp.json()["detail"] or "Missing" in resp.json()["detail"]


def test_ssti_attempt_is_422(client):
    resp = client.post(
        "/api/render",
        json={"html": "{{ cycler.__init__.__globals__ }}", "data": {}},
    )
    assert resp.status_code == 422


def test_external_url_blocked_render_still_succeeds(client):
    # Policy blocks the fetch; WeasyPrint logs it and renders without the image.
    resp = client.post(
        "/api/render",
        json={"html": "<img src='http://169.254.169.254/meta'><p>ok</p>", "data": {}},
    )
    assert resp.status_code == 200
    assert resp.content.startswith(b"%PDF-")


def test_placeholders_endpoint(client):
    resp = client.post(
        "/api/placeholders",
        json={"html": "{{ a }} {% for x in rows %}{{ x }}{% endfor %}", "data": {}},
    )
    assert resp.json() == {"placeholders": ["a", "rows"]}


def test_engine_crash_is_a_template_error_not_a_500(client):
    """WeasyPrint raises an internal AttributeError on calc() inside
    background-position. A caller must get an actionable 422 about their
    template, not "Internal Server Error" — the editor's fix-it flow has
    nothing to work with otherwise."""
    html = (
        "<html><head><style>@page{size:A4;"
        "background-image:linear-gradient(black,black);"
        "background-size:5mm 5mm;"
        "background-position:calc(100% - 5mm) 5mm}"
        "</style></head><body><p>x</p></body></html>"
    )
    resp = client.post("/api/render", json={"html": html, "data": {}, "strict": False})
    assert resp.status_code == 422
    assert "could not handle this template" in resp.json()["detail"]


def test_plain_background_position_still_renders(client):
    html = (
        "<html><head><style>@page{size:A4;"
        "background-image:linear-gradient(black,black);"
        "background-size:5mm 5mm;background-position:95% 5mm}"
        "</style></head><body><p>x</p></body></html>"
    )
    resp = client.post("/api/render", json={"html": html, "data": {}, "strict": False})
    assert resp.status_code == 200
