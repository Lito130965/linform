# Testing

How this repository checks itself. Running the suites is in
[CONTRIBUTING.md](../CONTRIBUTING.md); what is checked by hand, and why it
cannot be automated, is in [MANUAL-CHECKS.md](MANUAL-CHECKS.md).

## Golden PDF tests

`tests/test_golden_pdfs.py` renders every example in `examples/` and checks the
**PDF**, not just that one came back: exact page count, page-by-page text against
`tests/golden/<id>.txt`, page geometry, and that QR/barcode symbols reach the
page as vector drawings. A WeasyPrint upgrade, a font change in the base image
or an edit to a CSS preset moves layout across every template at once — this is
what notices.

Pixel comparison is deliberately not done: it breaks on a font patch release and
reports "17 000 pixels differ", which names nothing. Text plus geometry catches
the same regressions and says what moved.

When a change is *meant* to change the output:

```bash
python -m tests.regenerate_golden          # or: ... regenerate_golden invoice
```

Commit the regenerated files **on their own**, with the diff read in review.
Folding a golden update into a feature commit is how a layout regression gets
blessed without anyone looking at it. The script needs WeasyPrint's native
libraries, so run it in the Docker image or on Linux.

## Browser tests

`e2e/` drives a real Chromium against the **built image**, so what is exercised
is the bundle, the Python service and the CSP headers that actually ship — not
a dev server. Two instances are started: one in dev mode (auth off) for the
editor tests, one with accounts enabled for the login tests, since the two
states cannot coexist in one process.

```bash
cd e2e && ./run.sh              # build the image, start, test, stop
cd e2e && ./run.sh --no-build   # reuse the image already tagged linform:latest
```

No Node on the host is required: without `E2E_IN_CONTAINER=1` the script drives
the browsers from the official Playwright image. That image tag and
`@playwright/test` in `e2e/package.json` are pinned to the same version and must
move together — the browsers live in the image, so a mismatch fails with
"Executable doesn't exist".

The round-trip test compares through the API rather than by reading
CodeMirror's DOM: CodeMirror virtualizes long documents, so what is on screen
is not the document. It opens a stored template in the visual canvas, leaves,
saves, and asserts the stored bytes are unchanged — the promise the whole
editor rests on.

Accessibility is checked with axe-core (WCAG 2.0/2.1 A and AA) on the journal,
the settings page and the editor shell, and `npm run lint` covers the same
ground statically. Both are blocking.

Two exclusions, both deliberate: the canvas iframe, because it contains the
user's own template and failing a build over the contrast of somebody's
letterhead would be wrong and unfixable from here; and CodeMirror's scroll
container, which is reported as a scrollable region with no keyboard access
when the region it scrolls is the contenteditable the caret lives in.


## The suites, and what each one is for

| Suite | Where | What only it can catch |
|---|---|---|
| Backend unit and API | `tests/` | Request handling, the version invariants, auth, caching, limits |
| Golden PDF | `tests/test_golden_pdfs.py` | Layout moving under an engine, font or preset change |
| Engine capabilities | `tests/test_engine_capabilities.py` | A claim in the documentation going stale under an upgrade |
| Frontend unit | `frontend/src/**/*.test.ts` | Editor logic, the Jinja bridge, sanitisation |
| Browser | `e2e/` | The built image: bundle, CSP, the canvas in a real engine |

