"""What the rendering engine can actually do, measured rather than remembered.

The README tells a reader what will not survive the trip to PDF, and that list
is one of the most load-bearing things in it: somebody decides whether to adopt
this service based on it. A limitation that was true of an older WeasyPrint and
has since been fixed is worse than no list at all — it turns honesty into
folklore.

So each claim about the engine gets a test that renders something and reads back
where it landed. When an upgrade changes an answer, CI says so, and the README
is corrected the same day rather than whenever somebody happens to doubt it.

**How position is measured, and why not by coordinates.** The first version of
this file read the text matrix of each drawn run and compared x and y. That was
wrong twice: the text matrix is relative to the transformation in force, so the
numbers were not page coordinates at all, and adjacent runs on one line arrive
merged, so "LEFT" was never found — the page contained "LEFT RIGHT".

Extracted *lines* answer the question directly and survive font changes: two
things are laid out side by side exactly when they come back on the same line.
Each layout test carries a control — the same markup with the layout CSS removed
— because "these two words are on one line" only means something if they are on
two lines without it.
"""

import io

import pytest

try:
    import weasyprint  # noqa: F401

    import pypdf  # noqa: F401

    HAS_DEPS = True
except (ImportError, OSError):
    HAS_DEPS = False

pytestmark = pytest.mark.skipif(
    not HAS_DEPS, reason="WeasyPrint or pypdf unavailable (native libraries)"
)

PAGE = "@page { size: A4; margin: 10mm }"


def lines(html: str) -> list[str]:
    """The document's text, one entry per rendered line."""
    pdf = weasyprint.HTML(string=html).write_pdf()
    out: list[str] = []
    for page in pypdf.PdfReader(io.BytesIO(pdf)).pages:
        out += [line.strip() for line in (page.extract_text() or "").splitlines() if line.strip()]
    return out


def line_with(rendered: list[str], word: str) -> int:
    for index, line in enumerate(rendered):
        if word in line:
            return index
    raise AssertionError(f"{word!r} never reached the page; got {rendered}")


BOXES = "<div>LEFT</div>\n<div>RIGHT</div>\n<div>UNDER</div>"


def test_plain_blocks_stack_which_is_what_makes_the_others_mean_something():
    rendered = lines(f"<style>{PAGE}</style>{BOXES}")
    assert line_with(rendered, "LEFT") != line_with(rendered, "RIGHT")


def test_css_grid_places_items_in_columns_and_rows():
    """Explicit two-column grid: the first two items share a row, the third
    wraps onto the next one. The README called grid support incomplete; this is
    the claim being checked against the pinned engine."""
    rendered = lines(
        f"<style>{PAGE} .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 5mm }}</style>"
        f'<div class="grid">{BOXES}</div>'
    )
    assert line_with(rendered, "LEFT") == line_with(rendered, "RIGHT"), (
        f"the two columns did not share a row: {rendered}"
    )
    assert line_with(rendered, "UNDER") > line_with(rendered, "LEFT"), (
        f"the third item did not wrap onto the next row: {rendered}"
    )


def test_flexbox_places_items_in_a_row():
    """The claim the README makes next to the grid one, checked with the same
    instrument rather than assumed."""
    rendered = lines(
        f"<style>{PAGE} .row {{ display: flex; gap: 5mm }} .row > div {{ flex: 1 }}</style>"
        f'<div class="row"><div>LEFT</div><div>RIGHT</div></div>'
    )
    assert line_with(rendered, "LEFT") == line_with(rendered, "RIGHT"), (
        f"flex items were not laid out in a row: {rendered}"
    )


MM = 96 / 25.4  # CSS px per millimetre, which is what the box tree is measured in


def corner_of(html: str, mark: str = "probe") -> tuple[float, float]:
    """Top-left of the marked box, in px from the corner of the SHEET.

    Read from the engine's own anchor table (every id becomes one), so the
    number is where the box was actually laid out rather than where a text
    matrix suggests it was drawn.
    """
    page = weasyprint.HTML(string=html).render().pages[0]
    x, y, *_ = page.anchors[mark]
    return x, y


PROBE_PAGE = "@page { size: A4; margin: 26mm 18mm }"


@pytest.mark.parametrize("position", ["absolute", "fixed"])
def test_positioned_boxes_are_placed_against_the_page_area_not_the_sheet(position):
    """`left: 0` means the corner of the page AREA — inside the @page margins —
    because the body box begins there. The editor's canvas has to agree with
    this or a logo placed in the corner of the canvas prints over the edge of
    the paper; see e2e/tests/canvas-geometry.spec.ts for the other half.
    """
    x, y = corner_of(
        f"<style>{PROBE_PAGE} body {{ margin: 0 }}</style>"
        f'<p>flow</p><div id="probe" style="position:{position}; left:0; top:0; '
        'width:20mm; height:10mm; background:#000"></div>'
    )
    assert x == pytest.approx(18 * MM, abs=0.5), f"left edge landed at {x}px"
    assert y == pytest.approx(26 * MM, abs=0.5), f"top edge landed at {y}px"


def test_a_page_background_reaches_the_sheet_edge_by_going_negative():
    """The other side of the same rule, and the reason the page-background layer
    writes negative offsets: from the page area, minus the margins is the paper.
    """
    x, y = corner_of(
        f"<style>{PROBE_PAGE} body {{ margin: 0 }}</style>"
        '<div id="probe" style="position:fixed; left:-18mm; top:-26mm; '
        'width:210mm; height:297mm; background:#eee"></div>'
    )
    assert (x, y) == pytest.approx((0.0, 0.0), abs=0.5)


def test_javascript_in_a_template_does_not_run():
    """The security model rests on this: the engine draws documents and does not
    execute them. If a WeasyPrint release ever grew a script engine, everything
    written about untrusted templates would need rewriting — starting here."""
    rendered = lines(
        f"<style>{PAGE}</style>"
        "<p id='out'>BEFORE</p>"
        "<script>document.getElementById('out').textContent = 'AFTER'</script>"
    )
    assert line_with(rendered, "BEFORE") >= 0
    assert not any("AFTER" in line for line in rendered), f"a script ran: {rendered}"
