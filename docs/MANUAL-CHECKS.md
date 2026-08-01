# Manual checks

Two things live here, and they are different in kind.

The **release smoke** is a short, fixed list run against a built image before a
tag. It is short on purpose: a list nobody finishes is a list nobody runs.

The **charters** are exploratory. They name an area, the risk being hunted and a
time box, not a sequence of steps — because the value of these checks is
noticing what nobody thought to write down.

> **This file is supposed to shrink.** Every item that becomes an automated test
> is struck out here with a link to the test that replaced it. A checklist that
> only grows is a checklist that stops being read. The log at the bottom records
> what has left and why.

---

## Release smoke

Run against the image being released — `docker compose up --build`, or the
tagged image pulled from the registry — not against a dev server. Record the
result in the release notes: *"smoke passed on v0.2.0, Chromium 141, Linux"*.

### Service

1. `docker compose up` on a clean volume reaches healthy; `/health` returns ok
   and `/ready` reports database and renderer ok.
2. Stop the database container: `/ready` turns `503`, `/health` stays `200`,
   and the container is **not** restarted by Docker.
3. `docker compose exec linform id` shows a non-root user.
4. Migrations ran on first boot (`alembic upgrade head` in the log), and the
   version table matches the newest revision.

### Rendering

5. `POST /api/render` with the invoice example returns a PDF that opens in a
   viewer and has the expected page count.
6. Render by code, then pin an older version explicitly — the pinned render
   still returns the older document (`X-Linform-Version` proves which).
7. A template with a deliberate CSS error returns `422` with a message naming
   the problem, not `500`.
8. QR and barcode render as crisp vector at print size (zoom to 400% in a
   viewer: edges stay sharp, not pixelated).

### Editor

9. Open a stored template in Visual, change nothing, switch back to Code, save:
   the diff is empty or only the documented benign normalizations.
10. Edit a table cell, add a row and a column inside a `{% for %}` table, save,
    render — the loop still works.
11. Drag a block to reorder it; the preview updates and the export reflects the
    new order.
12. Insert one preset from each group; each renders.
13. Upload an asset, place it, render — the image is in the PDF.
14. The AI assistant, if configured: ask for a change, see the diff, apply it,
    render.

### Access and appearance

15. With accounts enabled: sign in, sign out, and confirm an editor user sees no
    account management.
16. Switch the theme (system / light / dark); reload — the choice survives and
    does not flash the other theme on load.
17. Tab through the journal and the settings page: focus is visible on every
    stop, and nothing is reachable only by mouse.
18. Narrow the window below 1280px: the "built for a wide screen" notice
    appears and can be dismissed.

---

## Charters

Session-based: pick one, set the timer, keep notes, record the date. A charter
with `Last run: —` has never been executed — that is a statement about this
project's current state, not a formatting placeholder.

### M-01 — Print fidelity on paper

Explore the six example PDFs **printed on physical paper** (laser, A4, 100%
scale, no "fit to page") targeting the risk that a document correct on screen is
wrong in the tray. Look for: margins clipped by the printer's non-printable
area, comb-field borders too thin to survive, hairline table rules disappearing,
grey backgrounds turning muddy, text too small to read at actual size.
**60 min. Last run: —**

### M-02 — Codes scanned off paper

Explore printed QR and barcodes with a real scanner and a phone camera,
targeting the claim in the README that vector symbols survive print. Vary:
angle, poor light, a photocopy of the printout, the smallest size a template
allows, coloured symbols on a coloured background. **45 min. Last run: —**

### M-03 — Cyrillic and font coverage

Explore Cyrillic-heavy forms, targeting the risk that the image ships only
DejaVu and Liberation. Look for: missing glyphs (ё, й, ‑, «», —), wrong
fallback weights, long organisation names in fixed-width cells, non-breaking
spaces behaving as breaks. **45 min. Last run: —**

### M-04 — Overflow with realistic data

Explore the examples with data at the length production actually produces — a
200-character line item, a 40-row table, an empty optional block — targeting
silent clipping. A container with a fixed height and `overflow: hidden` drops
content with no error, which is the failure this project has already been bitten
by. **45 min. Last run: —**

### M-05 — PDF readers disagree

Explore one rendered form across Acrobat, Foxit, Chrome's built-in viewer and
the Windows viewer, targeting differences in scaling and font substitution, and
print from each. **30 min. Last run: —**

### M-06 — Keyboard and screen reader

Explore the journal, settings, the login screen and the code editor with the
keyboard only, then with NVDA, targeting names that read wrong rather than names
that are missing (axe catches missing ones). The visual canvas is known to be
mouse-driven; the charter is about everything around it. **60 min. Last run: —**

### M-07 — How the editor feels on a real template

Explore a large real template (200+ elements): drag blocks, resize table
columns, zoom, undo repeatedly. Targeting the failure that no assertion catches
— formally works, unpleasant to use. Note anything that lags, jumps, or loses
the selection. **45 min. Last run: —**

---

## Retirement log

What has left this file, and what replaced it. This is the interesting column.

| Retired | Replaced by |
|---|---|
| "The PDF has the right number of pages" | `tests/test_golden_pdfs.py` — exact page count and page-by-page text for all six examples |
| "Visual round trip does not rewrite the template" | `e2e/tests/roundtrip.spec.ts` — in a real browser, compared through the API; plus the spike gate in `frontend/src/editor/spike.test.ts` |
| "Publishing twice at once leaves one published version" | `tests/test_concurrency_pg.py` — against PostgreSQL, from separate connections |
| "Buttons have accessible names; focus is visible" | `e2e/tests/a11y.spec.ts` (axe on three screens) and `npm run lint` |
| "Login rejects a wrong password and locks after repeats" | `tests/test_login_throttle.py` and `e2e/tests/auth.spec.ts` |

Items 9–12 of the smoke list are the next candidates: the browser suite already
covers the round trip and table edits, and once it covers presets and asset
placement they should be struck out here rather than kept "just in case".
