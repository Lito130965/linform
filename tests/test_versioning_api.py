"""Template lifecycle: create -> draft versions -> publish -> render by code
-> rollback by publishing an older version -> pin an explicit version."""

INVOICE_V1 = "<h1>Invoice {{ number }}</h1>"
INVOICE_V2 = "<h1>Invoice {{ number }}</h1><p>VAT: {{ vat }}</p>"


def _create_invoice(client):
    resp = client.post("/api/templates", json={"code": "invoice", "name": "Счёт-фактура"})
    assert resp.status_code == 201, resp.text
    return resp


def test_create_template_and_duplicate_conflict(db_client):
    _create_invoice(db_client)
    resp = db_client.post("/api/templates", json={"code": "invoice", "name": "Другой"})
    assert resp.status_code == 409


def test_template_code_validation(db_client):
    resp = db_client.post("/api/templates", json={"code": "Bad Code!", "name": "x"})
    assert resp.status_code == 422


def test_new_version_is_draft_with_incremented_number(db_client):
    _create_invoice(db_client)
    v1 = db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1, "comment": "первая"})
    assert v1.status_code == 201
    assert v1.json()["version"] == 1
    assert v1.json()["status"] == "draft"

    v2 = db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V2, "comment": "добавил НДС"})
    assert v2.json()["version"] == 2


def test_broken_template_rejected_on_create(db_client):
    _create_invoice(db_client)
    resp = db_client.put("/api/templates/invoice", json={"html_content": "{% for %}"})
    assert resp.status_code == 422


def test_render_requires_published_version(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1})
    # Draft exists but nothing is published — the consumer must not see drafts.
    resp = db_client.post("/api/render/invoice", json={"number": 1})
    assert resp.status_code == 404


def test_publish_and_render_by_code(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1})
    assert db_client.post("/api/templates/invoice/publish/1").status_code == 200

    resp = db_client.post("/api/render/invoice", json={"number": 7})
    assert resp.status_code == 200
    assert resp.headers["X-Linform-Version"] == "1"
    assert "Invoice 7" in db_client.stub_renderer.last_html


def test_publish_switches_active_version_atomically(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1})
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V2})
    db_client.post("/api/templates/invoice/publish/1")
    db_client.post("/api/templates/invoice/publish/2")

    detail = db_client.get("/api/templates/invoice").json()
    statuses = {v["version"]: v["status"] for v in detail["versions"]}
    assert statuses == {1: "archived", 2: "published"}

    resp = db_client.post("/api/render/invoice", json={"number": 1, "vat": "12%"})
    assert resp.headers["X-Linform-Version"] == "2"


def test_rollback_is_publishing_an_older_version(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1})
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V2})
    db_client.post("/api/templates/invoice/publish/2")
    db_client.post("/api/templates/invoice/publish/1")  # rollback

    resp = db_client.post("/api/render/invoice", json={"number": 5})
    assert resp.headers["X-Linform-Version"] == "1"
    assert "VAT" not in db_client.stub_renderer.last_html


def test_version_pinning_renders_exactly_that_version(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V1})
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V2})
    db_client.post("/api/templates/invoice/publish/2")

    # Consumer pins version 1 although version 2 is published.
    resp = db_client.post("/api/render/invoice/versions/1", json={"number": 3})
    assert resp.status_code == 200
    assert resp.headers["X-Linform-Version"] == "1"
    assert "VAT" not in db_client.stub_renderer.last_html

    assert db_client.post("/api/render/invoice/versions/99", json={}).status_code == 404


def test_placeholders_contract(db_client):
    _create_invoice(db_client)
    db_client.put("/api/templates/invoice", json={"html_content": INVOICE_V2})
    db_client.post("/api/templates/invoice/publish/1")

    resp = db_client.get("/api/templates/invoice/placeholders")
    assert resp.json() == {"placeholders": ["number", "vat"]}


def test_versions_listed_with_metadata(db_client):
    _create_invoice(db_client)
    db_client.put(
        "/api/templates/invoice",
        json={"html_content": INVOICE_V1, "comment": "первая версия", "created_by": "analyst"},
    )
    detail = db_client.get("/api/templates/invoice").json()
    v = detail["versions"][0]
    assert v["comment"] == "первая версия"
    assert v["created_by"] == "analyst"
    assert "html_content" not in v  # list view is light

    full = db_client.get("/api/templates/invoice/versions/1").json()
    assert full["html_content"] == INVOICE_V1


def test_adhoc_render_strict_override(db_client):
    # Lenient preview: missing placeholders render as blanks instead of 422.
    resp = db_client.post(
        "/api/render", json={"html": "<p>{{ absent }}</p>", "data": {}, "strict": False}
    )
    assert resp.status_code == 200

    resp = db_client.post(
        "/api/render", json={"html": "<p>{{ absent }}</p>", "data": {}, "strict": True}
    )
    assert resp.status_code == 422


def test_unknown_template_404s_everywhere(db_client):
    assert db_client.get("/api/templates/ghost").status_code == 404
    assert db_client.put("/api/templates/ghost", json={"html_content": "x"}).status_code == 404
    assert db_client.post("/api/render/ghost", json={}).status_code == 404
