"""Shared helpers for the golden PDF tests and the regeneration script.

Rendering here goes through the same path the API uses (Jinja render, then
WeasyPrint) minus the process pool, which buys nothing in a test and only makes
failures harder to read.
"""

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_DIR = REPO_ROOT / "examples"
GOLDEN_DIR = Path(__file__).resolve().parent / "golden"

# Every showcase example, in manifest order.
EXAMPLE_IDS = ["certificate", "invoice", "govform", "report", "colormatrix", "shipping_label"]


def load_example(example_id: str) -> tuple[str, dict]:
    html = (EXAMPLES_DIR / f"{example_id}.html").read_text(encoding="utf-8")
    data_path = EXAMPLES_DIR / f"{example_id}.data.json"
    data = json.loads(data_path.read_text(encoding="utf-8")) if data_path.is_file() else {}
    return html, data


def render_example_pdf(example_id: str) -> bytes:
    """Template + sample data -> PDF bytes, via the service's own render path."""
    import weasyprint

    from app.services.template_engine import render_html

    html, data = load_example(example_id)
    rendered = render_html(html, data, strict=False)
    # The examples are self-contained on purpose (no asset:// references), so
    # data: URIs are all the fetcher ever needs to resolve.
    return weasyprint.HTML(string=rendered).write_pdf()


def normalize_text(text: str) -> str:
    """Collapse whitespace so a golden file compares meaning, not layout noise.

    Extracted PDF text carries the line and word spacing the layout happened to
    produce; a font update can shift that without changing what the page says.
    Line structure is kept (it reflects real line breaks), horizontal runs are
    collapsed.
    """
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def pdf_page_texts(pdf_bytes: bytes) -> list[str]:
    import io

    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return [normalize_text(page.extract_text() or "") for page in reader.pages]


def golden_path(example_id: str) -> Path:
    return GOLDEN_DIR / f"{example_id}.txt"


# Pages are separated by a marker no template text can contain.
PAGE_SEPARATOR = "\n\n========== PAGE BREAK ==========\n\n"


def format_golden(page_texts: list[str]) -> str:
    return PAGE_SEPARATOR.join(page_texts) + "\n"


def parse_golden(content: str) -> list[str]:
    return [p.strip("\n") for p in content.rstrip("\n").split(PAGE_SEPARATOR)]
