"""API tests that produce real PDFs — require WeasyPrint's native libraries
(Pango). They run in the Docker image / Linux CI and are skipped where the
libraries are unavailable (e.g. bare Windows)."""

import pytest

try:
    import weasyprint  # noqa: F401

    HAS_WEASYPRINT = True
except (ImportError, OSError):
    # OSError: the package is installed but its native libraries are not.
    # ImportError: the package is absent entirely (a bare Windows checkout) —
    # without this the module fails to COLLECT rather than skipping, which
    # breaks the whole run instead of one file.
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


def test_ad_hoc_render_says_how_many_pages_it_came_to(client):
    """The editor's preview paginates the document itself, so that typing on
    page three does not throw the reader back to page one. It needs the count,
    and reading it from the bytes in the browser would mean shipping a PDF
    parser to do what the renderer already knows."""
    one = client.post("/api/render", json={"html": "<p>one page</p>", "data": {}})
    assert one.headers["X-Linform-Pages"] == "1"

    src = (
        "<style>@page { size: A4 } .item { page-break-inside: avoid }</style>"
        "{% for i in items %}<p class='item'>Row {{ i }}</p>{% endfor %}"
    )
    many = client.post("/api/render", json={"html": src, "data": {"items": list(range(200))}})
    from io import BytesIO

    from pypdf import PdfReader

    counted = len(PdfReader(BytesIO(many.content)).pages)
    assert counted > 1
    assert many.headers["X-Linform-Pages"] == str(counted)


def test_render_by_code_carries_no_page_count(db_client):
    """Deliberately only on the preview endpoint. What consumers get is a PDF
    and its bytes; counting pages on every production render would be work done
    for a reader who is not there."""
    db_client.post("/api/templates", json={"code": "counted", "name": "Counted"})
    draft = db_client.post(
        "/api/templates/counted/drafts",
        json={"html_content": "<p>{{ who }}</p>", "comment": "seed"},
    ).json()
    db_client.post(f"/api/templates/counted/drafts/{draft['id']}/publish")

    resp = db_client.post("/api/render/counted", json={"who": "world"})
    assert resp.status_code == 200
    assert "X-Linform-Pages" not in resp.headers


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
