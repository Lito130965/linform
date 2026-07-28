"""Showcase examples: the gallery lists them and opens each with its HTML and
sample data. Also guards that every manifest entry has real, valid files —
a typo in the manifest should fail here, not in the user's browser."""

import json
from pathlib import Path

import pytest

from app.services import examples
from app.services.template_engine import render_html

EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"


def test_list_is_ordered_and_metadata_only(db_client):
    listed = db_client.get("/api/examples").json()
    ids = [e["id"] for e in listed]
    assert ids == ["certificate", "invoice", "govform", "report", "colormatrix", "shipping_label"]
    for e in listed:
        assert e["title"] and e["description"]
        assert "html" not in e  # cards carry no bodies


def test_get_example_returns_html_and_data(db_client):
    detail = db_client.get("/api/examples/invoice").json()
    assert detail["id"] == "invoice"
    assert "{% for item in items %}" in detail["html"]
    assert "{% if discount %}" in detail["html"]  # the conditional row
    assert isinstance(detail["data"], dict) and detail["data"]["items"]


def test_unknown_example_is_404(db_client):
    assert db_client.get("/api/examples/nope").status_code == 404


@pytest.mark.parametrize("meta", examples.list_examples(), ids=lambda m: m["id"])
def test_every_example_renders_through_the_template_engine(meta):
    """Compile + render each example with its own sample data. Catches Jinja
    syntax errors — including the sneaky kind hidden in an HTML comment, since
    Jinja parses comments too — without needing WeasyPrint installed."""
    ex = examples.get_example(meta["id"])
    html = render_html(ex["html"], ex["data"], strict=False)
    assert html  # produced output, did not raise


@pytest.mark.parametrize("meta", examples.list_examples(), ids=lambda m: m["id"])
def test_every_manifest_entry_has_valid_files(meta):
    html = EXAMPLES_DIR / f"{meta['id']}.html"
    data = EXAMPLES_DIR / f"{meta['id']}.data.json"
    assert html.is_file(), f"missing {html.name}"
    assert data.is_file(), f"missing {data.name}"
    # Data must be a JSON object; a broken file would render as an empty payload.
    parsed = json.loads(data.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict)


def test_examples_use_the_exact_preset_and_block_markup():
    """The whole point of the gallery (per the brief): clicking a preset must
    reproduce what the example shows. Assert the shared byte-strings so a drift
    in either the preset output or the example is caught."""
    govform = examples.get_example("govform")["html"]
    # char-cells preset cell style
    assert "display:inline-block;width:5mm;height:6mm;line-height:6mm;" in govform
    assert "{% for ch in account %}" in govform
    # pad-empty-rows preset
    assert "{% for _ in range(items|length, 8) %}" in govform
    # checkbox preset
    assert "{{ '☑' if agree else '☐' }}" in govform

    report = examples.get_example("report")["html"]
    # page-numbers preset content
    assert 'content: "Page " counter(page) " of " counter(pages);' in report
    # code presets
    assert "{{ report_url | qr }}" in report
    assert "barcode('code128', text=True)" in report
