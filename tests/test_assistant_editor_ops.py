"""The assistant's idea of the editor, checked against the editor.

The prompt tells the model which blocks, presets and page sizes exist, and the
model then offers them to a user by name. That list lives in Python and the
things themselves live in TypeScript, so it can drift — and the failure is
quiet and expensive: the assistant confidently proposes "insert a signature
block", the editor refuses an operation it has never had, and the user is left
holding a conversation with something that does not know what it is inside.

So the source of truth is read here, from the files that implement it. When the
palette gains an entry, this test fails until the prompt catches up. It parses
rather than imports because the other side is TypeScript; the patterns are
deliberately close to the declarations they read, so a rewrite of those files
fails loudly instead of silently matching nothing (the empty-set guard below).
"""

import re
from pathlib import Path

from app.services.assistant_prompt import (
    EDITOR_BLOCKS,
    EDITOR_PAGE_SIZES,
    EDITOR_PRESETS,
    build_system_prompt,
)

FRONTEND = Path(__file__).resolve().parent.parent / "frontend" / "src"


def _blocks_in_source() -> set[str]:
    text = (FRONTEND / "editor" / "blocks.ts").read_text(encoding="utf-8")
    body = text.split("export const BLOCKS", 1)[1]
    return set(re.findall(r"id:\s*'([^']+)'", body))


def _presets_in_source() -> dict[str, set[str]]:
    text = (FRONTEND / "presets" / "registry.ts").read_text(encoding="utf-8")
    body = text.split("export const PRESETS", 1)[1]
    presets: dict[str, set[str]] = {}
    # Each entry starts at its id and runs to the next one; parameters are the
    # `name:` fields of the params array in between.
    entries = re.split(r"\n\s*id:\s*'", body)[1:]
    for entry in entries:
        name, rest = entry.split("'", 1)
        params = re.findall(r"\{\s*name:\s*'([^']+)'", rest.split("generate:", 1)[0])
        presets[name] = set(params)
    return presets


def _page_sizes_in_source() -> set[str]:
    text = (FRONTEND / "editor" / "page-css.ts").read_text(encoding="utf-8")
    line = re.search(r"export const PAGE_SIZES = \[([^\]]*)\]", text).group(1)
    return set(re.findall(r"'([^']+)'", line))


def test_the_prompt_offers_exactly_the_blocks_the_palette_has():
    found = _blocks_in_source()
    assert found, "no blocks parsed — blocks.ts changed shape, fix this test"
    assert {block for block, _ in EDITOR_BLOCKS} == found


def test_the_prompt_offers_exactly_the_presets_the_registry_has():
    found = _presets_in_source()
    assert found, "no presets parsed — registry.ts changed shape, fix this test"
    assert {preset for preset, _, _ in EDITOR_PRESETS} == set(found)


def test_each_preset_is_offered_with_its_own_parameters():
    # A parameter the preset does not have is refused by the parser in the
    # browser, so the assistant would be proposing something that cannot run.
    found = _presets_in_source()
    for preset, _, params in EDITOR_PRESETS:
        assert set(params) == found[preset], preset


def test_the_prompt_offers_exactly_the_page_sizes_the_editor_writes():
    found = _page_sizes_in_source()
    assert found, "no page sizes parsed — page-css.ts changed shape, fix this test"
    assert set(EDITOR_PAGE_SIZES) == found


def test_the_operations_contract_reaches_the_model():
    prompt = build_system_prompt()
    assert "```linform-ops" in prompt
    # The vocabulary itself, not just its name.
    assert '"op": "furniture"' in prompt
    assert '"op": "page"' in prompt
    assert "columns-3" in prompt
    assert "page-numbers" in prompt
    # And the reason it is preferred, since a rule without one is followed
    # until it is inconvenient.
    assert "select, move and restyle" in prompt
    # What the operations do NOT cover, said plainly: the first real reply
    # claimed to have "used the checkbox operation" while returning a whole
    # template, which reads as a small edit and is not one.
    assert "Never say you used an operation in a reply that carries a template" in prompt


def test_a_whole_template_is_named_as_the_last_resort():
    # The failure that put this rule here: asked to add one column to a table,
    # the assistant returned all sixty lines of the template with three of them
    # different. On a form of several hundred lines that is not merely wasteful
    # — every line retyped is a line that can come back paraphrased.
    prompt = build_system_prompt()
    assert "RETURNING A WHOLE TEMPLATE IS THE LAST RESORT" in prompt
    assert '"op": "edit"' in prompt
    assert "Never reproduce a document in order to change a part of it." in prompt
    # And the rule that keeps an edit honest: one place, or nothing.
    assert "must name exactly" in prompt


def test_a_reply_carries_the_template_and_nothing_after_it():
    # Everything a template reply used to end with — the placeholder list, an
    # example payload — is now either built by a button or scrolled past. The
    # block itself is applied rather than read.
    prompt = build_system_prompt()
    assert "No list of placeholders, no example JSON" in prompt
    # And it is applied on arrival, so the assistant must not talk as though the
    # user still has to press something.
    assert "applied to the open document immediately" in prompt


def test_the_prompt_still_forbids_the_markup_the_editor_cannot_edit():
    prompt = build_system_prompt()
    assert "lf-page-no" in prompt
    assert "position: running(lf-header)" in prompt
    # The measured fact behind the width, which cost a round of bug reports.
    assert "shrink-to-fit" in prompt
