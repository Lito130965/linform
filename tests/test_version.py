"""One version number, and a changelog entry to go with it.

The number lived in `pyproject.toml` and again as a literal in `app/main.py`,
which is how `/openapi.json` came to advertise 0.2.0 from a build that was a
hundred commits past it. A consumer generating a client reads that number to
know which release they are talking to; there is no point in it at all if it is
allowed to lie.

The second test is the one with teeth: a release is a tag, an image and a
paragraph explaining what changed, and the paragraph is the part that gets
forgotten — it is the only one of the three nobody's tooling demands.
"""

from __future__ import annotations

import re
import tomllib
from importlib.metadata import version as package_version
from pathlib import Path

from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent
RELEASE_HEADING = re.compile(r"^## \[(\d+\.\d+\.\d+)\]", re.MULTILINE)


def declared_version() -> str:
    """What this working tree says the version is, installed or not."""
    with (ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["version"]


def test_the_api_advertises_the_version_it_was_installed_as() -> None:
    installed = package_version("linform")
    assert create_app().version == installed
    assert installed == declared_version(), (
        f"pyproject.toml says {declared_version()} but the installed package is "
        f"{installed} — run `pip install -e \".[dev]\" -c constraints.txt` again. "
        "An editable install keeps the version it was made with."
    )


def test_the_changelog_names_this_version() -> None:
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    released = RELEASE_HEADING.findall(changelog)
    assert released, "CHANGELOG.md has no released sections at all"
    assert released[0] == declared_version(), (
        f"the version is {declared_version()} and the newest section in "
        f"CHANGELOG.md is {released[0]}. A version bump needs the paragraph "
        "that says what is in it."
    )
