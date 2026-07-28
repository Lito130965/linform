"""Built-in showcase examples served to the editor's gallery.

The example files under examples/ are the single source of truth: the same
HTML + data pairs the README hands out over curl are what the gallery opens.
They are read from disk (bundled into the image), never from the templates
database — examples are read-only illustrations, never saved.
"""

import json
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings

# app/services/examples.py -> parents[2] is the repo root locally and
# /srv/linform in the image (Dockerfile copies examples/ there).
_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "examples"


class ExampleError(Exception):
    """A requested example does not exist or is misconfigured."""


def _dir() -> Path:
    configured = get_settings().examples_dir
    return Path(configured) if configured else _DEFAULT_DIR


@lru_cache
def _manifest_for(dir_str: str) -> list[dict]:
    path = Path(dir_str) / "manifest.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("examples", [])


def _manifest() -> list[dict]:
    return _manifest_for(str(_dir()))


def list_examples() -> list[dict]:
    """Ordered metadata only (no bodies) for the gallery cards."""
    return [
        {"id": e["id"], "title": e["title"], "description": e["description"], "tags": e.get("tags", [])}
        for e in _manifest()
    ]


def get_example(example_id: str) -> dict:
    """Full example: metadata plus the HTML template and its sample data."""
    meta = next((e for e in _manifest() if e["id"] == example_id), None)
    if meta is None:
        raise ExampleError(f"No example named {example_id!r}")
    base = _dir()
    html_path = base / f"{example_id}.html"
    data_path = base / f"{example_id}.data.json"
    if not html_path.is_file():
        raise ExampleError(f"Example {example_id!r} has no HTML file")
    data = json.loads(data_path.read_text(encoding="utf-8")) if data_path.is_file() else {}
    return {
        "id": meta["id"],
        "title": meta["title"],
        "description": meta["description"],
        "tags": meta.get("tags", []),
        "html": html_path.read_text(encoding="utf-8"),
        "data": data,
    }
