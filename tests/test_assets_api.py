"""Assets: upload/dedup/serve and asset:// inlining into the render."""

import hashlib

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63fcffff3f030005fe02fea75081750000000049454e44ae426082"
)


def _upload(client, content=PNG_1PX, name="logo.png"):
    return client.post("/api/assets", files={"file": (name, content, "image/png")})


def test_upload_and_serve(db_client):
    resp = _upload(db_client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    sha = hashlib.sha256(PNG_1PX).hexdigest()
    assert body["url"] == f"asset://{sha}"
    assert body["mime_type"] == "image/png"

    served = db_client.get(f"/api/assets/{sha}")
    assert served.status_code == 200
    assert served.content == PNG_1PX


def test_upload_is_deduplicated_by_content(db_client):
    first = _upload(db_client, name="logo.png").json()
    second = _upload(db_client, name="same-bytes-other-name.png").json()
    assert first["sha256"] == second["sha256"]
    assert len(db_client.get("/api/assets").json()) == 1


def test_render_inlines_asset_reference(db_client):
    url = _upload(db_client).json()["url"]
    resp = db_client.post(
        "/api/render",
        json={"html": f"<img src='{url}'><p>ok</p>", "data": {}, "strict": False},
    )
    assert resp.status_code == 200
    html = db_client.stub_renderer.last_html
    assert "asset://" not in html
    assert "data:image/png;base64," in html


def test_render_unknown_asset_is_422(db_client):
    resp = db_client.post(
        "/api/render",
        json={"html": f"<img src='asset://{'0' * 64}'>", "data": {}, "strict": False},
    )
    assert resp.status_code == 422
    assert "Unknown asset" in resp.json()["detail"]


def test_empty_upload_rejected(db_client):
    resp = _upload(db_client, content=b"")
    assert resp.status_code == 422
