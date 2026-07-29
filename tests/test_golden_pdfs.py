"""Golden tests over the PDF the service actually produces.

Everything else in this suite proves a PDF came back; nothing proved what was
in it. A WeasyPrint upgrade, a font change in the base image or an edit to a
CSS preset can move layout across every template at once, and until now CI
would have stayed green through all of it.

What is checked, in order of how much regression it catches per line of test:

1. **Page count**, exactly. Most layout regressions push or pull a page.
2. **Text, page by page**, whitespace-normalized, against tests/golden/<id>.txt.
   Catches lost content and content landing on the wrong page.
3. **Page geometry** — the media box, i.e. size and orientation.
4. **Embedded images** for the templates that draw a QR or a barcode: proves
   the symbol was drawn rather than degraded into alt text.

Pixel comparison is deliberately NOT done: it breaks on a font patch release
and reports "17,000 pixels differ", which tells you nothing about what moved.
Text plus geometry catches the same regressions and names them.

Regenerating a golden file is a deliberate act — see tests/regenerate_golden.py
and CONTRIBUTING. Update it in its own commit, with the diff visible: folding a
golden update into a feature commit is exactly how a regression gets blessed.
"""

import pytest

from tests.golden_support import (
    EXAMPLE_IDS,
    format_golden,
    golden_path,
    parse_golden,
    pdf_page_texts,
    render_example_pdf,
)

try:
    import weasyprint  # noqa: F401

    import pypdf  # noqa: F401

    HAS_DEPS = True
except (ImportError, OSError):
    HAS_DEPS = False

pytestmark = pytest.mark.skipif(
    not HAS_DEPS, reason="WeasyPrint and pypdf required (Linux CI / Docker image)"
)

# A4 portrait at 72dpi, the PDF unit. Templates declare their own size; these
# are the two the examples use.
A4_PORTRAIT = (595, 842)
A4_LANDSCAPE = (842, 595)

EXPECTED_GEOMETRY = {
    "certificate": A4_LANDSCAPE,  # @page size: A4 landscape
    "invoice": A4_PORTRAIT,
    "govform": A4_PORTRAIT,
    "report": A4_PORTRAIT,
    "colormatrix": A4_PORTRAIT,
}

# Templates whose whole point is a server-drawn symbol.
EXAMPLES_WITH_IMAGES = ["report", "shipping_label"]


@pytest.fixture(scope="module")
def rendered() -> dict[str, bytes]:
    """Render every example once; the tests below all read from this."""
    return {example_id: render_example_pdf(example_id) for example_id in EXAMPLE_IDS}


def _golden_or_skip(example_id: str) -> list[str]:
    path = golden_path(example_id)
    if not path.is_file():
        pytest.skip(f"no golden for {example_id}; run tests/regenerate_golden.py")
    return parse_golden(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("example_id", EXAMPLE_IDS)
def test_page_count_is_exact(rendered, example_id):
    expected = _golden_or_skip(example_id)
    actual = pdf_page_texts(rendered[example_id])
    assert len(actual) == len(expected), (
        f"{example_id}: {len(actual)} pages, golden has {len(expected)}. "
        "Layout moved across a page boundary."
    )


@pytest.mark.parametrize("example_id", EXAMPLE_IDS)
def test_text_matches_the_golden_page_by_page(rendered, example_id):
    expected = _golden_or_skip(example_id)
    actual = pdf_page_texts(rendered[example_id])
    for page, (got, want) in enumerate(zip(actual, expected), start=1):
        assert got == want, (
            f"{example_id}: page {page} text differs from the golden. "
            "If this change is intended, regenerate the golden in its own commit."
        )


@pytest.mark.parametrize("example_id", sorted(EXPECTED_GEOMETRY))
def test_page_geometry_matches_the_declared_size(rendered, example_id):
    import io

    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(rendered[example_id]))
    want_w, want_h = EXPECTED_GEOMETRY[example_id]
    for page_no, page in enumerate(reader.pages, start=1):
        box = page.mediabox
        assert round(float(box.width)) == pytest.approx(want_w, abs=2), (
            f"{example_id} page {page_no}: width {float(box.width):.0f}pt, expected ~{want_w}pt"
        )
        assert round(float(box.height)) == pytest.approx(want_h, abs=2), (
            f"{example_id} page {page_no}: height {float(box.height):.0f}pt, expected ~{want_h}pt"
        )


def _form_xobjects(pdf_bytes: bytes) -> int:
    """Count vector form XObjects across the document.

    The codes are SVG (segno and python-barcode both emit it, which is the point
    — a vector symbol survives print scaling), so WeasyPrint draws them as form
    XObjects, NOT as embedded raster images. `page.images` is empty for these
    templates even when the symbol is perfectly drawn.
    """
    import io

    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    total = 0
    for page in reader.pages:
        xobjects = (page.get("/Resources", {}) or {}).get("/XObject", {}) or {}
        for key in xobjects:
            try:
                if xobjects[key].get_object().get("/Subtype") == "/Form":
                    total += 1
            except Exception:  # a malformed entry is not a drawn symbol
                continue
    return total


@pytest.mark.parametrize("example_id", EXAMPLES_WITH_IMAGES)
def test_codes_reach_the_pdf_as_vector_drawings(rendered, example_id):
    """A QR or barcode that fails to generate leaves an empty box and still
    produces a perfectly valid PDF, so its absence has to be asserted directly."""
    assert _form_xobjects(rendered[example_id]) >= 1, (
        f"{example_id} draws a QR and a barcode, but the PDF contains no vector "
        "form — the symbol did not reach the page"
    )


@pytest.mark.parametrize("example_id", ["invoice", "colormatrix"])
def test_templates_without_codes_have_no_vector_forms(rendered, example_id):
    """Pins the check above to something that actually discriminates: if every
    template produced a form XObject, the assertion would pass no matter what
    happened to the codes."""
    assert _form_xobjects(rendered[example_id]) == 0


def test_every_example_has_a_golden_file():
    """A new example without a golden silently tests nothing; the skip in
    _golden_or_skip keeps a local run useful, this makes the gap visible."""
    missing = [i for i in EXAMPLE_IDS if not golden_path(i).is_file()]
    assert not missing, f"missing golden files: {missing} (run tests/regenerate_golden.py)"


def test_golden_format_round_trips():
    pages = ["page one\nline two", "page two"]
    assert parse_golden(format_golden(pages)) == pages
