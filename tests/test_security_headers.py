"""Security headers. The editor loads user-authored HTML into a same-origin
iframe, so CSP is the backstop behind input sanitization: even markup that slips
past the sanitizer must not execute."""

import io

import pytest

from app.core.headers import CSP


def test_headers_are_present_on_api_responses(db_client):
    resp = db_client.get("/api/templates")
    assert resp.headers["content-security-policy"] == CSP
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["referrer-policy"] == "same-origin"
    assert resp.headers["x-frame-options"] == "DENY"


def test_headers_are_present_on_errors_too(db_client):
    resp = db_client.get("/api/templates/does-not-exist")
    assert resp.status_code == 404
    assert "content-security-policy" in resp.headers


def test_csp_forbids_scripts_from_anywhere_but_self():
    assert "script-src 'self'" in CSP
    assert "object-src 'none'" in CSP
    assert "frame-ancestors 'none'" in CSP
    # No 'unsafe-inline' / 'unsafe-eval' anywhere near scripts.
    script_directive = next(p for p in CSP.split("; ") if p.startswith("script-src"))
    assert "unsafe" not in script_directive


def test_csp_still_allows_what_the_product_needs():
    # Inline CSS is the product: a print form is styling.
    assert "style-src 'self' 'unsafe-inline'" in CSP
    # QR codes and barcodes arrive as data URIs.
    assert "img-src 'self' data:" in CSP
    # The live preview shows the PDF from a Blob URL (PreviewPane renders
    # <iframe src={blob:...}>); without blob: the preview pane goes blank.
    assert "frame-src 'self' blob:" in CSP


@pytest.mark.parametrize(
    "mime,filename,expect_attachment",
    [
        ("image/png", "logo.png", False),
        ("image/svg+xml", "logo.svg", True),  # SVG can carry <script>
        ("text/html", "page.html", True),
        ("application/octet-stream", "blob.bin", True),
    ],
)
def test_risky_asset_types_are_served_as_attachments(db_client, mime, filename, expect_attachment):
    payload = b"<svg xmlns='http://www.w3.org/2000/svg'></svg>" if "svg" in mime else b"\x89PNG\r\n"
    up = db_client.post(
        "/api/assets", files={"file": (filename, io.BytesIO(payload), mime)}
    )
    assert up.status_code == 201, up.text
    resp = db_client.get(f"/api/assets/{up.json()['sha256']}")
    assert resp.status_code == 200
    if expect_attachment:
        assert resp.headers.get("content-disposition") == "attachment"
    else:
        assert "content-disposition" not in resp.headers
