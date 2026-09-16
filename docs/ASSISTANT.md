# The AI assistant

Off by default, and off entirely without `LINFORM_AI_API_KEY`. This is the one
part of Linform that talks to a third party, so it is documented separately
from the features that do not.


With a key configured, the editor gains an assistant that drafts a template
from a description or a scan and makes targeted corrections. What it returns is
applied to the open document as it arrives — in the visual editor, where you can
see it — and one press takes it back exactly. **It never writes to the
database** — saving and publishing stay human actions, so immutability is
untouched.

## Operations, not markup

For anything the editor already does — the page, a header or footer, a block,
a preset, a field — the assistant asks for **that operation** rather than
writing markup, and you see it as a list of sentences before it runs. What
lands is then what the panels produce: a footer the header switch maintains, a
page number built on counters, both still editable afterwards. Its vocabulary
is exactly the editor's, checked against the editor's own source in CI. When it
does write a whole template, anything that would put the document out of the
visual editor's reach is said beside the Apply button rather than discovered
later.

## Your key

Bring your own key. It stays on the backend and is never sent to the browser.
Without `LINFORM_AI_API_KEY` the feature is off and hidden in the UI.

## What leaves your machine

So you can decide whether that is acceptable for your documents:

- the current template HTML and its placeholder *names*;
- the prose of the current chat session (kept in the browser, replayed with
  each turn — the endpoint itself stores nothing, so any replica can serve
  any turn);
- screenshots or scans you attach, downscaled in the browser first;
- your test data **only** if you set `LINFORM_AI_SEND_TEST_DATA=true`, which
  is off by default because test data often contains real personal data.

This is the one place where Linform talks to a third party. Everything else —
rendering, barcodes, the editor — runs entirely inside your deployment and
needs no internet access at all.
