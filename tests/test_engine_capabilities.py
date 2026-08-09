"""What the rendering engine can actually do, measured rather than remembered.

The README tells a reader what will not survive the trip to PDF, and that list
is one of the most load-bearing things in it: somebody decides whether to adopt
this service based on it. A limitation that was true of an older WeasyPrint and
has since been fixed is worse than no list at all — it turns honesty into
folklore.

So each claim about the engine gets a test that renders something and looks at
where it landed. When an upgrade changes an answer, CI says so, and the README
gets corrected the same day rather than whenever somebody happens to doubt it.

Positions come from the text placement in the PDF itself: the transform matrix
of each drawn run, which is where the engine actually put it.
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


def placements(html: str) -> dict[str, tuple[float, float]]:
    """Where each word was drawn, in PDF points from the bottom-left."""
    pdf = weasyprint.HTML(string=html).write_pdf()
    found: dict[str, tuple[float, float]] = {}

    def visit(text, _cm, tm, _font, _size):
        word = text.strip()
        if word:
            found.setdefault(word, (round(tm[4], 1), round(tm[5], 1)))

    for page in pypdf.PdfReader(io.BytesIO(pdf)).pages:
        page.extract_text(visitor_text=visit)
    return found


GRID = """
<style>
  @page { size: A4; margin: 10mm }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm }
</style>
<div class="grid">
  <div>LEFT</div>
  <div>RIGHT</div>
  <div>UNDER</div>
</div>
"""


def test_css_grid_places_items_in_columns_and_rows():
    """Two grid items sit side by side; the third wraps to the next row.

    Without grid support these are three stacked blocks: same x, descending y.
    That is exactly what this distinguishes, so the test says which world we are
    in rather than asserting a hope.
    """
    at = placements(GRID)
    for word in ("LEFT", "RIGHT", "UNDER"):
        assert word in at, f"{word} never reached the page"

    left, right, under = at["LEFT"], at["RIGHT"], at["UNDER"]

    assert right[0] > left[0], "the second column was not placed to the right of the first"
    assert abs(right[1] - left[1]) < 2, "the two columns did not share a row"
    assert under[1] < left[1], "the third item did not wrap onto the next row"
    assert abs(under[0] - left[0]) < 2, "the wrapped item did not start the row again"


FLEX = """
<style>
  @page { size: A4; margin: 10mm }
  .row { display: flex; gap: 5mm }
  .row > div { flex: 1 }
</style>
<div class="row"><div>ONE</div><div>TWO</div></div>
"""


def test_flexbox_places_items_in_a_row():
    """The claim the README makes next to the grid one, so it is checked with
    the same instrument rather than assumed."""
    at = placements(FLEX)
    assert at["TWO"][0] > at["ONE"][0]
    assert abs(at["TWO"][1] - at["ONE"][1]) < 2


def test_javascript_in_a_template_does_not_run():
    """The security model rests on this: the engine draws documents and does not
    execute them. If a WeasyPrint release ever grew a script engine, everything
    written about untrusted templates would need rewriting — starting here."""
    at = placements(
        "<p id='out'>BEFORE</p><script>document.getElementById('out').textContent = 'AFTER'</script>"
    )
    assert "BEFORE" in at
    assert "AFTER" not in at
