"""Drafts, publication, history and archiving.

The rule these tests exist to pin down: **a draft is not a version.** It has no
number, it is mutable, and no consuming application can reach it — not by
template code, and not by pinning, which is the path that used to leak.
"""

INVOICE_V1 = "<h1>Invoice {{ number }}</h1><p>VAT: {{ vat }}</p>"
INVOICE_V2 = "<h1>Invoice {{ number }}</h1><p>VAT: {{ vat }}</p><p>Thank you</p>"
# Strict placeholders are on by default, so a render needs the real payload —
# an empty body would fail as a template error and say nothing about versions.
DATA = {"number": "42", "vat": "20"}


def _template(client, code="invoice", name="Invoice"):
    resp = client.post("/api/templates", json={"code": code, "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _draft(client, code, html=INVOICE_V1, comment=""):
    resp = client.post(f"/api/templates/{code}/drafts", json={"html_content": html, "comment": comment})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _publish(client, code, draft_id):
    resp = client.post(f"/api/templates/{code}/drafts/{draft_id}/publish")
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- drafts are not versions -----------------------------------------------

def test_a_draft_has_no_version_number(db_client):
    _template(db_client)
    draft = _draft(db_client, "invoice")
    assert "version" not in draft
    assert draft["id"] > 0

    detail = db_client.get("/api/templates/invoice").json()
    assert detail["versions"] == []
    assert len(detail["drafts"]) == 1
    assert detail["current_version"] is None


def test_a_consuming_application_cannot_render_a_draft(db_client):
    """The whole point. Rendering by code has nothing to serve, and there is no
    number to pin — previously a draft was renderable through the pinning
    endpoint by anyone who guessed 1."""
    _template(db_client)
    _draft(db_client, "invoice")

    by_code = db_client.post("/api/render/invoice", json=DATA)
    assert by_code.status_code == 404
    assert "publish" in by_code.json()["detail"].lower()

    for guess in (1, 2, 3):
        pinned = db_client.post(f"/api/render/invoice/versions/{guess}", json=DATA)
        assert pinned.status_code == 404, f"version {guess} should not exist yet"


def test_several_drafts_can_coexist_and_be_deleted(db_client):
    _template(db_client)
    first = _draft(db_client, "invoice", comment="one idea")
    second = _draft(db_client, "invoice", html=INVOICE_V2, comment="another")

    drafts = db_client.get("/api/templates/invoice/drafts").json()
    assert {d["id"] for d in drafts} == {first["id"], second["id"]}

    assert db_client.delete(f"/api/templates/invoice/drafts/{first['id']}").status_code == 204
    remaining = db_client.get("/api/templates/invoice/drafts").json()
    assert [d["id"] for d in remaining] == [second["id"]]


def test_a_draft_is_editable_in_place(db_client):
    _template(db_client)
    draft = _draft(db_client, "invoice", comment="first thought")
    updated = db_client.put(
        f"/api/templates/invoice/drafts/{draft['id']}",
        json={"html_content": INVOICE_V2, "comment": "second thought"},
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == draft["id"], "editing must not mint a new draft"
    assert "Thank you" in updated.json()["html_content"]
    assert updated.json()["comment"] == "second thought"
    # Still exactly one draft.
    assert len(db_client.get("/api/templates/invoice/drafts").json()) == 1


def test_a_draft_that_does_not_compile_is_refused(db_client):
    _template(db_client)
    resp = db_client.post(
        "/api/templates/invoice/drafts", json={"html_content": "{% for x in %}", "comment": ""}
    )
    assert resp.status_code == 422


# --- publication -----------------------------------------------------------

def test_publishing_mints_the_number_and_makes_it_current(db_client):
    _template(db_client)
    draft = _draft(db_client, "invoice")
    published = _publish(db_client, "invoice", draft["id"])
    assert published["version"] == 1
    assert published["status"] == "published"

    detail = db_client.get("/api/templates/invoice").json()
    assert detail["current_version"] == 1
    assert detail["drafts"] == [], "publishing consumes the draft"

    rendered = db_client.post("/api/render/invoice", json=DATA)
    assert rendered.status_code == 200
    assert rendered.headers["X-Linform-Version"] == "1"


def test_numbers_count_publications_not_saves(db_client):
    """Three drafts, one published: the first version is 1, not 3. A version
    number always refers to something that really shipped."""
    _template(db_client)
    _draft(db_client, "invoice")
    _draft(db_client, "invoice")
    third = _draft(db_client, "invoice", html=INVOICE_V2)

    assert _publish(db_client, "invoice", third["id"])["version"] == 1


def test_publishing_a_second_draft_supersedes_the_first(db_client):
    _template(db_client)
    v1 = _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    v2 = _publish(db_client, "invoice", _draft(db_client, "invoice", html=INVOICE_V2)["id"])
    assert (v1["version"], v2["version"]) == (1, 2)

    versions = db_client.get("/api/templates/invoice/versions").json()
    assert [(v["version"], v["status"]) for v in versions] == [
        (2, "published"),
        (1, "archived"),
    ]
    assert db_client.post("/api/render/invoice", json=DATA).headers["X-Linform-Version"] == "2"


def test_choosing_an_older_version_is_the_rollback(db_client):
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    _publish(db_client, "invoice", _draft(db_client, "invoice", html=INVOICE_V2)["id"])

    back = db_client.post("/api/templates/invoice/versions/1/current")
    assert back.status_code == 200 and back.json()["version"] == 1
    assert db_client.post("/api/render/invoice", json=DATA).headers["X-Linform-Version"] == "1"

    # No new number was minted, and nothing was deleted.
    versions = db_client.get("/api/templates/invoice/versions").json()
    assert [v["version"] for v in versions] == [2, 1]
    assert sum(1 for v in versions if v["status"] == "published") == 1


def test_setting_the_current_version_twice_is_harmless(db_client):
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    assert db_client.post("/api/templates/invoice/versions/1/current").status_code == 200
    assert db_client.post("/api/templates/invoice/versions/1/current").status_code == 200
    assert db_client.post("/api/render/invoice", json=DATA).status_code == 200


def test_published_versions_are_immutable(db_client):
    """There is no endpoint that edits one — the only way to change what
    consumers get is to publish something new or point at an older version."""
    _template(db_client)
    published = _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    # A published version's id is not a draft id, so the draft routes refuse it.
    detail = db_client.get(f"/api/templates/invoice/versions/{published['version']}").json()
    assert detail["html_content"] == INVOICE_V1
    assert db_client.put(
        "/api/templates/invoice/drafts/999", json={"html_content": "<p>x</p>"}
    ).status_code == 404


def test_pinned_versions_keep_rendering_after_a_newer_one_is_published(db_client):
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    _publish(db_client, "invoice", _draft(db_client, "invoice", html=INVOICE_V2)["id"])

    pinned = db_client.post("/api/render/invoice/versions/1", json=DATA)
    assert pinned.status_code == 200
    assert pinned.headers["X-Linform-Version"] == "1"


# --- archiving -------------------------------------------------------------

def test_archiving_stops_rendering_by_code_but_not_by_pin(db_client):
    """Reproducibility outranks tidiness: a document filed against version 1
    must still be reproducible after the template is retired."""
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])

    assert db_client.delete("/api/templates/invoice").status_code == 200

    by_code = db_client.post("/api/render/invoice", json=DATA)
    assert by_code.status_code == 410
    assert "archived" in by_code.json()["detail"].lower()

    pinned = db_client.post("/api/render/invoice/versions/1", json=DATA)
    assert pinned.status_code == 200


def test_archived_templates_are_hidden_from_the_list_but_findable(db_client):
    _template(db_client, code="keep")
    _template(db_client, code="retire")
    db_client.delete("/api/templates/retire")

    listed = [t["code"] for t in db_client.get("/api/templates").json()]
    assert listed == ["keep"]

    with_archived = db_client.get("/api/templates?include_archived=true").json()
    assert {t["code"] for t in with_archived} == {"keep", "retire"}
    retired = next(t for t in with_archived if t["code"] == "retire")
    assert retired["archived_at"] is not None


def test_restoring_brings_a_template_back(db_client):
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    db_client.delete("/api/templates/invoice")
    assert db_client.post("/api/templates/invoice/restore").status_code == 200
    assert db_client.post("/api/render/invoice", json=DATA).status_code == 200


# --- listing ---------------------------------------------------------------

def test_template_list_pages_and_reports_the_total(db_client):
    for i in range(7):
        _template(db_client, code=f"t{i}", name=f"T{i}")

    page = db_client.get("/api/templates?limit=3&offset=0")
    assert [t["code"] for t in page.json()] == ["t0", "t1", "t2"]
    assert page.headers["X-Total-Count"] == "7"

    second = db_client.get("/api/templates?limit=3&offset=3")
    assert [t["code"] for t in second.json()] == ["t3", "t4", "t5"]

    tail = db_client.get("/api/templates?limit=3&offset=6")
    assert [t["code"] for t in tail.json()] == ["t6"]


def test_history_carries_metadata_and_hides_html(db_client):
    _template(db_client)
    draft = _draft(db_client, "invoice", comment="первая версия")
    _publish(db_client, "invoice", draft["id"])

    versions = db_client.get("/api/templates/invoice/versions").json()
    assert versions[0]["comment"] == "первая версия"
    # Authorship comes from the principal; auth is off in tests, so it is "dev".
    assert versions[0]["created_by"] == "dev"
    assert "html_content" not in versions[0]  # the list view stays light

    full = db_client.get("/api/templates/invoice/versions/1").json()
    assert full["html_content"] == INVOICE_V1


def test_placeholders_describe_the_current_version(db_client):
    _template(db_client)
    _publish(db_client, "invoice", _draft(db_client, "invoice")["id"])
    assert db_client.get("/api/templates/invoice/placeholders").json() == {
        "placeholders": ["number", "vat"]
    }


def test_unknown_template_404s_everywhere(db_client):
    assert db_client.get("/api/templates/ghost").status_code == 404
    assert db_client.get("/api/templates/ghost/drafts").status_code == 404
    assert db_client.post("/api/templates/ghost/drafts", json={"html_content": "<p>x</p>"}).status_code == 404
    assert db_client.post("/api/render/ghost", json=DATA).status_code == 404
    assert db_client.post("/api/render/ghost/versions/1", json=DATA).status_code == 404


def test_duplicate_code_conflicts(db_client):
    _template(db_client)
    assert db_client.post(
        "/api/templates", json={"code": "invoice", "name": "Another"}
    ).status_code == 409
