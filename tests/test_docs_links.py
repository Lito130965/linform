"""Every link between the documents in this repository points at something.

The README is the first thing a reader sees and the first thing to rot: a
section moves to `docs/`, three other files keep pointing at where it used to
be, and nobody notices until somebody outside the project clicks. That reader
does not report it — they close the tab.

Anchors are checked as well as files, because a link to a heading that has been
renamed lands silently at the top of the page and looks like it worked. The slug
rule is GitHub's own: lowercase, drop anything that is not a letter, digit,
space or hyphen, then spaces to hyphens. An em dash therefore vanishes and
leaves the two spaces around it as two hyphens, which is why some anchors here
have a double hyphen in them.

External links (http, https, mailto) are not checked: this suite must pass with
no network, and a test that depends on somebody else's uptime fails for reasons
that are not ours.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Markdown files that are part of the published documentation. Anything under a
# build or dependency directory is somebody else's — including the dot
# directories tools leave behind, which is how `.pytest_cache/README.md` turned
# up as a documentation file with its own test.
SKIP_DIRS = {"node_modules", "out", "dist", "build", "__pycache__"}

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$", re.MULTILINE)
FENCE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)


def markdown_files() -> list[Path]:
    found = []
    for path in ROOT.rglob("*.md"):
        parts = path.relative_to(ROOT).parts
        if any(part in SKIP_DIRS or part.startswith(".") for part in parts):
            continue
        # PLAN*.md and AUDIT*.md are gitignored working notes, not documentation.
        if path.parent == ROOT and path.name.startswith(("PLAN", "AUDIT")):
            continue
        found.append(path)
    return sorted(found)


def slug(heading: str) -> str:
    """GitHub's anchor for a heading, near enough for our own headings."""
    text = re.sub(r"`|\*|_", "", heading)
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.strip().lower().replace(" ", "-")


def anchors_of(path: Path) -> set[str]:
    body = FENCE.sub("", path.read_text(encoding="utf-8"))
    return {slug(m.group(2)) for m in HEADING.finditer(body)}


def links_of(path: Path) -> list[str]:
    body = FENCE.sub("", path.read_text(encoding="utf-8"))
    return [m.group(1) for m in LINK.finditer(body)]


@pytest.mark.parametrize("doc", markdown_files(), ids=lambda p: str(p.relative_to(ROOT)))
def test_every_relative_link_resolves(doc: Path) -> None:
    broken = []
    for target in links_of(doc):
        if target.startswith(("http://", "https://", "mailto:", "#")):
            if target.startswith("#") and target[1:] not in anchors_of(doc):
                broken.append(f"{target} (no such heading in this file)")
            continue
        file_part, _, anchor = target.partition("#")
        dest = (doc.parent / file_part).resolve()
        if not dest.exists():
            broken.append(f"{target} (no such file)")
        elif anchor and dest.suffix == ".md" and anchor not in anchors_of(dest):
            broken.append(f"{target} (no such heading)")
    assert not broken, f"{doc.relative_to(ROOT)} points at nothing: " + ", ".join(broken)


def test_the_readme_stays_a_front_page() -> None:
    """A soft ceiling, and the reason the documents above exist.

    Not a style rule: the README grew to 736 lines by everything true being
    added to it, and every one of those additions was individually reasonable.
    A number that fails out loud is the only thing that has ever stopped that.
    """
    lines = (ROOT / "README.md").read_text(encoding="utf-8").splitlines()
    assert len(lines) < 300, (
        f"README.md is {len(lines)} lines. Something in it belongs in docs/ — "
        "see the table at the bottom of the README for where things live."
    )
