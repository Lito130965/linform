"""Write or check the committed OpenAPI snapshot.

    python -m scripts.openapi_snapshot --write    # regenerate after a change
    python -m scripts.openapi_snapshot --check    # what CI runs

The point is not the file, it is the diff. An API change made in passing —
a renamed field, a status code, a route that quietly disappeared — is invisible
in a pull request that touches a router; the snapshot puts it in the diff where
a reviewer sees it and has to agree with it.

Committed regenerations belong in the same commit as the change that caused
them, so the two are read together.

The schema is FastAPI's output, so the installed FastAPI is part of what this
compares: 0.141 spells a binary upload body "contentMediaType" where 0.129 wrote
"format": "binary". That is a real change for a consumer generating a client, so
it should be seen — but it should arrive with the version bump that caused it,
not on an unrelated pull request. Hence constraints.txt; install with it.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"


def current() -> str:
    from app.main import app

    # sort_keys so an unrelated reordering by FastAPI never shows up as a diff.
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()

    schema = current()
    if args.write:
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(schema, encoding="utf-8")
        print(f"wrote {SNAPSHOT}")
        return 0

    if not SNAPSHOT.is_file():
        print(f"{SNAPSHOT} is missing; run --write", file=sys.stderr)
        return 1
    committed = SNAPSHOT.read_text(encoding="utf-8")
    if committed == schema:
        print("OpenAPI schema matches the committed snapshot")
        return 0

    print("The API differs from the committed snapshot.\n", file=sys.stderr)
    # A readable diff beats "files differ": the reviewer needs to see WHAT moved.
    import difflib

    for line in list(
        difflib.unified_diff(
            committed.splitlines(),
            schema.splitlines(),
            fromfile="docs/openapi.json (committed)",
            tofile="app.openapi() (current)",
            lineterm="",
        )
    )[:200]:
        print(line, file=sys.stderr)
    print(
        "\nIf the change is intended, run: python -m scripts.openapi_snapshot --write",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
