"""Regenerate the golden PDF text files.

    python -m tests.regenerate_golden            # all examples
    python -m tests.regenerate_golden invoice    # one

Run this only when a change to a template, a preset or the renderer is MEANT to
change the output, and commit the result on its own, with the diff visible in
review. Folding a golden update into a feature commit is how a layout
regression gets blessed without anyone reading it.

Needs WeasyPrint's native libraries, so run it in the Docker image or on Linux
CI — not on a bare Windows checkout.
"""

import sys

from tests.golden_support import (
    EXAMPLE_IDS,
    GOLDEN_DIR,
    format_golden,
    golden_path,
    parse_golden,
    pdf_page_texts,
    render_example_pdf,
)


def regenerate(example_ids: list[str]) -> int:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    changed = 0
    for example_id in example_ids:
        pages = pdf_page_texts(render_example_pdf(example_id))
        content = format_golden(pages)
        path = golden_path(example_id)
        before = path.read_text(encoding="utf-8") if path.is_file() else None
        if before == content:
            print(f"  {example_id}: unchanged ({len(pages)} pages)")
            continue
        path.write_text(content, encoding="utf-8")
        changed += 1
        if before is None:
            print(f"+ {example_id}: created ({len(pages)} pages)")
        else:
            was = len(parse_golden(before))
            note = f"{was} -> {len(pages)} pages" if was != len(pages) else f"{len(pages)} pages"
            print(f"* {example_id}: updated ({note})")
    return changed


def main() -> int:
    requested = sys.argv[1:] or EXAMPLE_IDS
    unknown = [name for name in requested if name not in EXAMPLE_IDS]
    if unknown:
        print(f"unknown example(s): {unknown}\nknown: {EXAMPLE_IDS}", file=sys.stderr)
        return 2
    changed = regenerate(requested)
    print(f"\n{changed} file(s) changed. Commit them separately, with the diff reviewed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
