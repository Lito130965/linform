"""QR/barcode filters: the symbol is built here from payload data."""

import base64
import re

import pytest

from app.services import barcodes
from app.services.template_engine import TemplateRenderError, render_html


def _svg(data_uri: str) -> str:
    assert data_uri.startswith("data:image/svg+xml;base64,")
    return base64.b64decode(data_uri.split(",", 1)[1]).decode("utf-8")


def test_qr_renders_a_sizeless_svg_so_css_controls_the_printed_size():
    svg = _svg(barcodes.qr("INV-2026-000123"))
    assert "<svg" in svg
    # A hardcoded width would fight the template's `style="width: 25mm"`.
    assert not re.search(r"<svg[^>]*\swidth=", svg)
    assert "path" in svg or "rect" in svg


def test_qr_error_level_changes_the_symbol():
    low = _svg(barcodes.qr("same payload", error="l"))
    high = _svg(barcodes.qr("same payload", error="h"))
    assert low != high


def test_qr_rejects_an_unknown_error_level():
    with pytest.raises(barcodes.BarcodeError, match="l, m, q, h"):
        barcodes.qr("x", error="z")


def test_barcode_renders_svg_and_honours_the_symbology():
    svg = _svg(barcodes.barcode("ABC-123", "code128"))
    assert "<svg" in svg


def test_barcode_rejects_an_unknown_symbology_with_the_list_of_valid_ones():
    with pytest.raises(barcodes.BarcodeError, match="code128"):
        barcodes.barcode("123", "not-a-symbology")


def test_fixed_length_symbology_rejects_a_bad_payload():
    # EAN-13 wants 12-13 digits; a scanner would never read whatever else.
    with pytest.raises(barcodes.BarcodeError, match="ean13"):
        barcodes.barcode("abc", "ean13")


def test_empty_and_oversized_payloads_are_refused():
    with pytest.raises(barcodes.BarcodeError, match="empty"):
        barcodes.qr("")
    with pytest.raises(barcodes.BarcodeError, match="over the"):
        barcodes.qr("x" * (barcodes.MAX_PAYLOAD_CHARS + 1))


def test_filters_are_available_inside_a_template():
    html = render_html('<img src="{{ code | qr }}">', {"code": "PAY-1"})
    assert 'src="data:image/svg+xml;base64,' in html


def test_barcode_filter_takes_arguments_inside_a_template():
    html = render_html(
        "<img src=\"{{ n | barcode('code39', text=True) }}\">", {"n": "AB12"}
    )
    assert "data:image/svg+xml;base64," in html


def test_a_bad_payload_surfaces_as_a_template_error_not_a_crash():
    with pytest.raises(TemplateRenderError, match="Barcode error"):
        render_html("<img src=\"{{ v | barcode('ean13') }}\">", {"v": "nonsense"})


def test_data_uri_survives_autoescaping_intact():
    """The URI must reach the document unmangled, or the image will not load."""
    html = render_html('<img src="{{ c | qr }}">', {"c": "A&B"})
    uri = re.search(r'src="([^"]+)"', html).group(1)
    assert "&amp;" not in uri.split(",", 1)[1]
    assert _svg(uri).startswith("<svg") or "<svg" in _svg(uri)


def _qr_modules(data_uri: str, border: int = 2) -> int:
    """Module count of the symbol the filter actually produced."""
    svg = _svg(data_uri)
    box = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
    assert box, f"no viewBox in {svg[:120]}"
    assert box.group(1) == box.group(2), "a QR symbol is square"
    return int(box.group(1)) - 2 * border


def test_the_filter_emits_a_full_qr_not_a_micro_qr():
    """segno.make picks the smallest symbol that fits and silently returns a
    Micro QR for short payloads. Micro QR has one finder pattern instead of
    three, and most phone cameras and handheld scanners refuse it — the symbol
    prints beautifully and then cannot be scanned, which is the worst way for a
    paper form to fail. Micro tops out at 17 modules; a full QR starts at 21.
    Asserted through the public filter, so swapping make_qr back for make fails
    here rather than in the field."""
    assert _qr_modules(barcodes.qr("KZ-2026-000123")) >= 21
    # The shortest payloads are exactly where the Micro fallback used to bite.
    assert _qr_modules(barcodes.qr("1")) >= 21
