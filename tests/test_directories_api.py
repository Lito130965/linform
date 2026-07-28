"""Template directories: flat buckets that organize templates for the editor
without touching how the render API addresses them (always by code)."""


def _mk_template(client, code, name="T", directory_id=None):
    body = {"code": code, "name": name}
    if directory_id is not None:
        body["directory_id"] = directory_id
    return client.post("/api/templates", json=body)


def test_create_list_and_count(db_client):
    d = db_client.post("/api/directories", json={"name": "billing"}).json()
    assert d["name"] == "billing" and d["template_count"] == 0
    _mk_template(db_client, "inv", directory_id=d["id"])
    _mk_template(db_client, "receipt", directory_id=d["id"])
    listed = db_client.get("/api/directories").json()
    assert [(x["name"], x["template_count"]) for x in listed] == [("billing", 2)]


def test_duplicate_directory_name_conflicts(db_client):
    assert db_client.post("/api/directories", json={"name": "ops"}).status_code == 201
    assert db_client.post("/api/directories", json={"name": "ops"}).status_code == 409


def test_template_carries_its_directory(db_client):
    d = db_client.post("/api/directories", json={"name": "hr"}).json()
    _mk_template(db_client, "form", directory_id=d["id"])
    detail = db_client.get("/api/templates/form").json()
    assert detail["directory_id"] == d["id"]
    # And the list view exposes it too, for the journal to group by.
    row = next(t for t in db_client.get("/api/templates").json() if t["code"] == "form")
    assert row["directory_id"] == d["id"]


def test_create_into_missing_directory_is_404(db_client):
    assert _mk_template(db_client, "x", directory_id=999).status_code == 404


def test_move_template_between_and_out_of_directories(db_client):
    a = db_client.post("/api/directories", json={"name": "a"}).json()
    b = db_client.post("/api/directories", json={"name": "b"}).json()
    _mk_template(db_client, "doc", directory_id=a["id"])

    moved = db_client.put("/api/templates/doc/directory", json={"directory_id": b["id"]})
    assert moved.status_code == 200 and moved.json()["directory_id"] == b["id"]

    # null sends it to General (uncategorized).
    out = db_client.put("/api/templates/doc/directory", json={"directory_id": None})
    assert out.status_code == 200 and out.json()["directory_id"] is None


def test_move_to_missing_directory_is_404(db_client):
    _mk_template(db_client, "doc")
    assert db_client.put("/api/templates/doc/directory", json={"directory_id": 42}).status_code == 404


def test_deleting_a_directory_unfiles_its_templates_not_deletes_them(db_client):
    d = db_client.post("/api/directories", json={"name": "temp"}).json()
    _mk_template(db_client, "keep", directory_id=d["id"])
    assert db_client.delete(f"/api/directories/{d['id']}").status_code == 204
    # The template survives, now uncategorized.
    detail = db_client.get("/api/templates/keep")
    assert detail.status_code == 200 and detail.json()["directory_id"] is None


def test_rename_directory(db_client):
    d = db_client.post("/api/directories", json={"name": "old"}).json()
    renamed = db_client.put(f"/api/directories/{d['id']}", json={"name": "new"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "new"
