# Linform

[![CI](https://github.com/Lito130965/linform/actions/workflows/ci.yml/badge.svg)](https://github.com/Lito130965/linform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](pyproject.toml)

**Versioned print forms — HTML in, PDF out.**

**[Try the editor →](https://linform.linitapp.com/)** — the examples gallery on a
live instance. Open any template, edit it, watch the PDF change. Nothing is
saved there and uploads are cleared within the hour; it is the same image this
repository publishes, run with `LINFORM_ROLE=demo`.

Self-hosted service for generating print documents (invoices, certificates,
reports) from HTML templates. Analysts create and version templates in a web
editor; your application gets a PDF with a single API call, passing JSON data.

> Docs: [DECISIONS.md](docs/DECISIONS.md) — why it is built this way ·
> [SECURITY.md](SECURITY.md) — threat model ·
> [CONTRIBUTING.md](CONTRIBUTING.md) — running and testing it ·
> [MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) — what is checked by hand, and why
>
> Status: early development, usable. Render core, immutable versions with
> publish/rollback and pinning, web editor (code + visual), assets, `.docx`
> import, barcodes, and an optional AI assistant.

## Quick start

```bash
git clone https://github.com/Lito130965/linform && cd linform
docker compose up -d --build   # app on :8100 + PostgreSQL (not exposed)
```

That gives a working service with authentication **off** — enough to open the
editor and render something. Before exposing it to anyone, copy `.env.example`
to `.env` and set an authentication section.

One container and no database to configure, if you prefer — SQLite in a file
next to the app, from the published image:

```bash
docker run -p 8100:8000 ghcr.io/lito130965/linform:0.2.0
```

Images are published on each tagged release, `0.2.0` upwards; `latest` follows
the newest. Building it yourself is `docker build -t linform . && docker run -p
8100:8000 linform`.

Create a template, publish a version, render a PDF:

```bash
# 1. Template with a stable code your app will render by
curl -X POST localhost:8100/api/templates \
  -H "Content-Type: application/json" \
  -d '{"code": "invoice", "name": "Invoice"}'

# 2. A draft — a working copy with no version number yet
#    → {"id": 1, "status": "draft", ...}
curl -X POST localhost:8100/api/templates/invoice/drafts \
  -H "Content-Type: application/json" \
  -d '{"html_content": "<h1>Invoice #{{ number }}</h1>", "comment": "initial"}'

# 3. Publish that draft by its id — this is where version 1 is minted
curl -X POST localhost:8100/api/templates/invoice/drafts/1/publish

# 4. Render: JSON in, PDF out
curl -X POST localhost:8100/api/render/invoice \
  -H "Content-Type: application/json" \
  -d '{"number": 42}' --output invoice.pdf
```

Ready-made templates to start from — an invoice with a flowing table, a
shipping label with QR/barcode, a fixed-layout certificate — live in
[examples/](examples/), each with sample data and curl commands.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/render/{code}` | **Main endpoint**: render the published version |
| POST | `/api/render/{code}/versions/{v}` | Pin an exact version (reproducible forever) |
| POST | `/api/render` | Ad-hoc render: raw HTML + data (no storage) |
| GET | `/api/templates` | List templates |
| POST | `/api/templates` | Create a template |
| GET | `/api/templates/{code}` | Template + version history |
| POST | `/api/templates/{code}/drafts` | Start a working copy (no version number) |
| PUT | `/api/templates/{code}/drafts/{id}` | Edit a draft in place |
| DELETE | `/api/templates/{code}/drafts/{id}` | Discard a draft |
| POST | `/api/templates/{code}/drafts/{id}/publish` | Publish it: numbered, frozen, live |
| POST | `/api/templates/{code}/versions/{v}/current` | Point consumers at a version (the rollback) |
| GET | `/api/templates/{code}/versions/{v}` | Full version content |
| DELETE | `/api/templates/{code}` | Archive (pinned versions keep rendering) |
| GET | `/api/templates/{code}/placeholders` | Fields the template expects — the integration contract |
| PUT | `/api/templates/{code}/directory` | File a template under a directory (or `null` for General) |
| GET / POST | `/api/directories` | List / create organizational buckets (editor-side only) |
| POST | `/api/assets` | Upload an asset (logo, background); returns an immutable `asset://<sha256>` URL |
| GET | `/api/assets` | List uploaded assets |
| GET | `/api/assets/{sha256}` | Raw asset bytes |
| GET | `/api/examples` | Built-in showcase examples (drives the editor gallery) |
| GET | `/health` | Liveness — process is up; touches nothing external |
| GET | `/ready` | Readiness — database and render pool reachable, `503` when not |
| POST | `/api/auth/login` | Password login → opaque session token |
| GET | `/api/auth/me` | Who the current credential is (drives the UI) |
| POST | `/api/admin/users` | **Superuser**: create an editor/superuser account |
| POST | `/api/admin/keys` | **Superuser**: mint a render API key (shown once) |

**Accounts and roles.** Set `LINFORM_SUPERUSER` / `LINFORM_SUPERUSER_PASSWORD`
to enable accounts. The superuser signs in and creates **editor** users (design
templates, preview, render — but not manage accounts) and **render API keys**
for consuming applications (render only, revocable one at a time). The static
`LINFORM_RENDER_TOKEN` / `LINFORM_ADMIN_TOKEN` still work unchanged for
machine-to-machine use; with nothing configured at all, auth stays off for local
dev.

**A draft is not a version.** A draft is a working copy: no number, editable,
deletable, and unreachable by any consuming application — not by template code,
and not by pinning. A template can hold several at once.

A version exists only once something is **published**. It is numbered then,
which means a version number always refers to something a consumer could
legitimately have rendered — there are no gaps for work that never shipped.
Published versions are immutable, and exactly one is *current* (enforced by the
database, so it holds with any number of replicas). Pointing that at an older
version is the rollback; it mints no new number.

A consumer either renders "whatever is current" or pins an explicit version.
Deciding *which* documents pin *which* version is the consumer's business rule,
kept out of this service on purpose. Archiving a template stops rendering by
code (`410`) while pinned versions keep working, because that promise was made
when the version was published.

Assets follow the same philosophy: they are content-addressed
(`asset://<sha256>`) and immutable — replacing a logo means uploading a new
file and referencing it from a new template version, so old versions keep
rendering pixel-for-pixel what they were published with.

## How it works

```
HTML template with {{ placeholders }}  →  Jinja2 (sandboxed)  →
final HTML  →  WeasyPrint  →  PDF
```

- **Jinja2** placeholders, conditions and loops in templates — always executed
  in a sandbox (templates are untrusted input).
- **WeasyPrint** rendering with CSS Paged Media: `@page`, headers/footers,
  page numbers, `page-break-*` control.
- External URLs in templates are blocked by default (SSRF protection).
  Embed images as `data:` URIs or allow hosts explicitly via
  `LINFORM_ALLOW_EXTERNAL_URLS` / `LINFORM_ALLOWED_URL_HOSTS`.

### Barcodes and QR codes

Your application sends the value; the symbol is drawn here. Both filters
return an SVG `data:` URI, so it goes straight into an `img` and the CSS
width decides the printed size:

```html
<img src="{{ order_id | qr }}" style="width: 25mm">
<img src="{{ tracking | barcode('code128', text=True) }}" style="width: 60mm">
```

`qr(error='m', border=2)` — correction level `l`/`m`/`q`/`h`, quiet zone in
modules. Always a full QR, never a Micro QR, which most scanners refuse.

`barcode(symbology='code128', text=False, module_height=12.0, quiet_zone=2.0)`
— `code128`, `code39`, `ean13`, `ean8`, `upca`, `isbn13`, `issn`, `itf`,
`pzn`, `gs1_128`; millimetres. Fixed-length symbologies reject payloads of
the wrong length or checksum, so prefer `code128` unless the form demands
otherwise.

SVG rather than PNG on purpose: a barcode is line art that has to survive
being scanned off paper, and a raster symbol rendered at the wrong DPI is the
classic reason a scanner will not read it.

## AI assistant (optional, off by default)

With a key configured, the editor gains an assistant that drafts a template
from a description or a scan and makes targeted corrections. It proposes; you
review the diff and apply it yourself. **It never writes to the database** —
saving a version stays a human action, so immutability is untouched.

Bring your own key. It stays on the backend and is never sent to the browser.
Without `LINFORM_AI_API_KEY` the feature is off and hidden in the UI.

**What leaves your machine when you use it**, so you can decide whether that
is acceptable for your documents:

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

## Limits — what this does not do

Better to know before you build on it:

- **No JavaScript in templates.** WeasyPrint renders documents, not web pages.
- **Print CSS, not browser CSS.** Flexbox lays out, and so does explicit CSS
  grid — this entry used to say grid support was incomplete, which was true of
  an older engine and is no longer what the pinned one does. Both are checked by
  rendering a page and reading back where things landed
  (`tests/test_engine_capabilities.py`), each against a control, so the claim
  stays honest across upgrades. What is *not* covered: the further corners of
  grid (auto-placement, named areas, subgrid) are untested here, and a layout
  copied from a web page may still not survive the trip. Print forms are tables,
  blocks and absolute positioning, which is what the engine is best at.
- **One instance mounts everything, unless you split it.** The default
  (`LINFORM_ROLE=all`) carries the render API and the management API together. A
  render-only token already prevents a leaked service token from changing
  templates; `LINFORM_ROLE=render` goes further and leaves the management API
  out of the process entirely (see [Deployment roles](#deployment-roles)). Either
  way, keep the editor on an internal network.
- **Rendering is synchronous.** One request, one PDF, with a hard timeout and a
  hard in-flight ceiling — past it the service replies `429 Retry-After` instead
  of queueing without bound. Bulk generation ("10 000 invoices") and any retry
  or async orchestration are the calling application's job; Linform gives it an
  idempotent building block.
- **No business data is stored.** Payloads are rendered and forgotten. That is
  deliberate, and it means Linform cannot re-render a document you did not keep
  the data for — store the version number alongside your document and pin it.
- **The visual canvas approximates pagination; the preview is the truth.** The
  canvas draws each page boundary where the page really ends — the sheet minus
  the `@page` margins every page spends — so the line lands on the right row.
  But it lays the document out as one continuous strip and does **not** reflow
  content across a break: a block that straddles a boundary is drawn whole with
  the line through it, while the renderer either splits it — which is what
  happens to ordinary text — or moves it to the next page entire, which is what
  happens to a table row, an image, or anything carrying `break-inside: avoid`.
  The canvas marks whichever of the two it will be, on the element itself, so
  the difference is predictable rather than discovered in the PDF.
  Two further differences are inherent rather than unfinished: the browser and
  WeasyPrint are different layout engines with different font metrics, and rules
  like `page-break-inside: avoid`, widows and orphans are applied by the
  renderer only. Use the canvas to author and the PDF preview beside it to
  confirm; where they disagree, the PDF is right.

## Observability

Every response carries an `X-Request-ID` — the one the caller sent, or a fresh
one — and every log line written while serving that request carries the same id,
so a report of "it was slow at 14:00" can be traced to the request that was
slow. With `LINFORM_JSON_LOGS=true` each line is one JSON object: `ts`, `level`,
`request_id`, `method`, `path`, `status`, `duration_ms`, and `principal` — who
made the call, **by name, never the credential they presented**.

The request body is never logged, by any path. Payloads are the consuming
application's business data; this service renders them and forgets them, and a
log file is the easiest place to break that promise by accident.

`LINFORM_METRICS_ENABLED=true` serves Prometheus metrics at `/metrics`, behind
the render role (a 404 when disabled — an endpoint that is off should not
advertise itself). It is off by default because the series are labelled by
template code, so scraping reveals which forms a deployment runs.

| Metric | Type | Notes |
|---|---|---|
| `linform_render_duration_seconds` | histogram | labels `template_code`, `outcome` (`ok`/`rejected`/`timeout`/`error`) |
| `linform_render_inflight` | gauge | renders in flight on this instance |
| `linform_render_concurrency_limit` | gauge | the ceiling, so the gauge above reads as utilisation |
| `linform_render_rejected_total` | counter | shed at the ceiling — the 429s |
| `linform_render_timeout_total` | counter | abandoned at the hard timeout — the 504s |
| `linform_login_failed_total` | counter | label `reason`; the reason is a metric, never part of the 401 |
| `linform_cache_hits_total` / `_misses_total` | counter | label `cache`; a TTL expiry counts as a miss, so the ratio is honest |
| `linform_cache_bytes` / `_entries` | gauge | label `cache`; what the caches are holding right now |
| `linform_cache_evictions_total` | counter | label `cache`; climbing steadily means the budget is smaller than the working set |

Ad-hoc renders share a single `<ad-hoc>` label instead of minting a series per
request.

## Performance

Absolute numbers from someone else's hardware are not a specification, so read
this as a **method and a shape**, and measure your own box with the script that
produced it:

```bash
python scripts/loadtest.py http://localhost:8100 <template-code> --data @payload.json
```

What holds regardless of hardware, because it follows from the design:

- **Rendering is CPU-bound and single-threaded per document.** Throughput is
  roughly `render workers / cost of one render`; latency tracks single-core
  speed, throughput tracks core count.
- **Throughput saturates at the worker count.** More concurrent clients past
  that point add no PDFs per second, only queueing — visible as latency.
- **Past the in-flight ceiling the service refuses immediately** with `429` and
  `Retry-After` rather than building a queue.

The runs below are one container on an AMD Ryzen 5 4600H (6 cores / 12 threads),
rendering the `invoice` example — two A4 pages with a 25-row table. **One render
costs about 235 ms** and that figure does not move with the worker count: it is
one document on one core, and it is the number to re-measure on your hardware
and your templates, both of which change it.

What the worker count buys, at the point where each setting stops gaining:

| Render workers | Sustained PDF/s | at clients | p50 | p95 |
|---:|---:|---:|---:|---:|
| 2 *(default)* | 7.9 | 4 | 527 ms | 547 ms |
| 4 | 14.7 | 8 | 529 ms | 627 ms |
| 6 | 18.1 | 8 | 401 ms | 528 ms |

Doubling the workers from 2 to 4 gives **1.87×** — 93% of linear, which is what
"throughput tracks core count" means in practice. From 4 to 6 it is 1.23× rather
than 1.5×: those six workers now share six physical cores with the application
process and the database. **The default of 2 is a floor, not a ceiling** — it
exists so the service behaves on a small box, and one environment variable moves
it.

Past the ceiling, the same runs at 16 concurrent clients:

| Render workers | Served | Refused | Median time to refuse |
|---:|---:|---:|---:|
| 2 | 4 | 90% | 24 ms |
| 4 | 8 | 80% | 19 ms |
| 6 | 12 | 70% | 10 ms |

The number served is exactly the in-flight ceiling — workers × 2 — in all three
runs, and everything over it comes back in milliseconds with `429` and
`Retry-After` rather than joining a queue. That is the backpressure design
end to end, and it is the row that will look the same on any machine.

Throughput and refusals are reported separately on purpose. Once the ceiling
starts shedding load the run is over in half a second, so "documents ÷ wall
clock" stops describing a sustained rate — it describes a handful of renders
divided by an interval too short to mean anything. The load script marks those
rows with a `*` for the same reason.

Scaling levers, in the order worth reaching for: raise
`LINFORM_RENDER_MAX_WORKERS` towards the core count, raise
`LINFORM_RENDER_MAX_CONCURRENCY` only if your callers genuinely tolerate
queueing, and run more replicas — the database invariants are built for that
(see the concurrency tests). A client rendering in bulk should honour
`Retry-After`; retry and batching are its job, by design.

### Caching

Caching does not make a render faster — the PDF engine is the cost, and it is
unchanged. What it removes is the database work around the render, which is what
stops the shared database becoming the ceiling once replicas multiply.

Statements issued per render, counted by the suite rather than estimated:

| | first render | every render after |
|---|---:|---:|
| template with no assets | 2 | **0** |
| template with one asset | 3 | **0** |

A warm render touches no database at all, so it does not take a connection from
the pool either. The arithmetic that follows: twenty replicas serving 1000
renders a second used to put ~3000 queries a second on one database, a third of
them pulling the same logo blob out again. Now the steady-state cost is one
lookup per template per replica per TTL — ten a second at the default — and it
no longer grows with traffic.

What is cached, and for how long, follows from how the key is formed
(`app/services/cache.py`):

- **Assets and compiled templates never expire.** They are addressed by the
  hash of their content, so a hit cannot be wrong.
- **"Which version does this code serve"** is a pointer, and pointers move, so
  it expires after `LINFORM_TEMPLATE_CACHE_TTL_SECONDS` (default 2). The process
  that publishes or rolls back drops its own entry immediately, so with one
  process — which is what the shipped container runs — the cache is never stale
  at all. Add processes, whether replicas or `uvicorn --workers`, and the TTL
  becomes the bound on how long a rollback takes to reach all of them.

Set `LINFORM_TEMPLATE_CACHE_TTL_SECONDS=0` to switch it off and resolve every
render against the database. `linform_cache_hits_total` and
`linform_cache_misses_total` report whether any of this is earning its memory.

## Deployment roles

One container does everything, and that is the right shape until traffic or a
security review says otherwise. `LINFORM_ROLE` splits it in two: **editor**
nodes for people, **render** nodes for consuming applications. Which routes
exist is decided at startup — a render node does not *refuse* the management
API, it does not have one, so there is nothing to misconfigure and nothing for a
stolen credential to reach.

| | `all` (default) | `editor` | `render` | `demo` |
|---|:---:|:---:|:---:|:---:|
| `POST /api/render` (markup you send) | ✓ | ✓ | ✓ | ✓ |
| `POST /api/render/{code}` and version pinning | ✓ | — | ✓ | — |
| Templates, directories, assistant | ✓ | ✓ | — | — |
| Asset uploads | ✓ | ✓ | — | scratch |
| Accounts and sign-in | ✓ | ✓ | — | — |
| Examples gallery | ✓ | ✓ | — | ✓ |
| Editor UI | ✓ | ✓ | — | gallery only |
| `/health`, `/ready`, `/metrics`, `/api/capabilities` | ✓ | ✓ | ✓ | ✓ |

The editor loses the consumer render endpoints deliberately: pointing a
consuming application at the editor node works by accident, and quietly makes
the one node nobody scales part of the render path.

**`demo` is the public shop window** — the examples gallery and the editor
behind it, rendering whatever markup it is handed, with nothing to sign in as
and nothing kept. It is safe to leave on the open internet because
nothing on it survives.

Uploads are the exception that proves the rule: a demo does accept them —
dropping in a logo is what makes the editor feel like yours — but they go to a
store of their own, keyed to an opaque cookie, **visible only to the browser
that sent them and deleted within the hour**, with a ceiling on how much one
visitor may hold. Somebody will eventually upload something unlawful or
malicious, and a public instance must be neither the place that serves it to
others nor the place it sits. The shell asks `/api/capabilities` what
this instance offers and draws only that, so a demo shows one tab and no
sign-in card rather than a login screen in front of a service with no accounts.

```bash
docker run -p 8100:8000 -e LINFORM_ROLE=demo ghcr.io/lito130965/linform:latest
```

That is exactly what runs at [linform.linitapp.com](https://linform.linitapp.com/).

On a serverless host that assigns a port — Cloud Run and its kind — the
entrypoint follows `$PORT`, so nothing else needs configuring. Set
`LINFORM_RENDER_MAX_WORKERS=1` and cap the instances: rendering is the only
expensive thing on it, and the ceiling already sheds what it cannot take.

```bash
docker compose -f docker-compose.roles.yml up -d --build --scale render=3
scripts/verify-scale.sh 3
```

That script is the multi-replica check, and it runs in CI: several containers
migrating one database at the same time (serialised by a PostgreSQL advisory
lock, since every container runs `alembic upgrade head` on startup), a render
node with no management API, every replica serving the same current version, and
publish and rollback on the editor reaching all of them within the cache TTL.

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

**The canvas from the keyboard.** The canvas is contenteditable, so the plain
arrows, Enter and Backspace belong to writing the document and cannot be taken
away from it. Selecting *structure* therefore lives behind Alt:

| Keys | What it does |
|---|---|
| `Alt` + `↓` / `↑` | select the next / previous element at this level |
| `Alt` + `→` | select the first element inside this one |
| `Alt` + `←` | select the element around this one |
| `Alt` + `Enter` | edit the selected element — its Jinja expression, or its text |
| `Alt` + `Delete` | remove the selected element |
| `Esc` | step out to the element around this one; clear at the top |

Movement is by tree rather than by document order: `Alt`+`↓` in the last cell of
a row stops there instead of surfacing into the next paragraph. The list is also
in the canvas itself, under "Keyboard", because a shortcut nobody can discover
is a shortcut nobody has.

**The modifier keys mean one thing each.** `Shift` keeps the proportion when
resizing and the axis when moving; `Alt` ignores snapping for as long as it is
held; `Ctrl` (or `Cmd`) drags a copy instead of the element itself. People bring
these habits from other tools, and matching them is worth more than any
convention this editor could invent. The one departure is `Alt`, which elsewhere
often means "resize from the centre": in a document made of margins and
alignments, an escape from snapping is needed far more often than centring is.

**A page break says what it will do.** The canvas draws the document as one
strip and marks where each printed page ends; where that line crosses something,
the element is outlined and labelled — *moves to the next page whole* for a table
row, an image or anything carrying `break-inside: avoid`, and *splits across the
break* for ordinary text, which is what the renderer does to it and usually what
its author wants. The gap between the strip and the printed pages cannot be
closed without laying the document out twice; this makes it predictable, which
is most of what "it looked right in the editor" is really asking for.

**One gesture, one undo.** A drag is a single action however many changes it
makes on the way, so history is held open for its duration and commits once when
the hand lets go — an undo that lands halfway through a resize reads as a broken
program rather than a precise one. And `Esc` **cancels a drag in progress**: the
document goes back to where the gesture found it, without letting go of the
mouse first and without leaving a step behind to undo.

**What a click will take is shown before the click.** Hovering outlines the
element a click would select and names its kind, and the selected element's path
— `Table › Row › Cell › Block` — sits in the properties bar with every level
clickable. Structural selection takes the nearest meaningful node under the
pointer, which is a fine rule and an invisible one; these make it visible
instead of something you press to find out.

**Dragging is measured, and it snaps.** While an edge is being dragged it falls
onto the things a printed form aligns to: the page margins, the page breaks, and
the edges and centres of what is already on the page — with the millimetre grid
as a fallback when nothing else is near. A page line always beats a round
number, because "flush with the margin" is what the author meant and "5 mm" is
only what the ruler happened to say. The line it landed on is drawn while it
holds it, the figure beside the cursor reads in millimetres and names what
stopped it, and **`Alt` turns snapping off** for the length of a gesture.

**Size and spacing.** The selected element's box is edited as a box: margins
around it, padding inside it, width and height in the middle, each number on the
side it changes. Values are **millimetres by default** — type `12`, get `12mm` —
and any named unit is kept as written. A value set on the element is shown
solid; an empty box shows what the template's stylesheet decided, greyed, and
clearing a box returns the property to the stylesheet rather than writing a
zero. Changes apply on Enter or when the box loses focus, so the layout does not
jump while a number is being typed. A number can also be **dragged sideways** or
stepped with `↑`/`↓` (`Shift` for tens) — nobody knows a gap wants 6.5 mm, they
know it when they see it. **Grid** in the toolbar lays a millimetre
ruler over the sheet — 5 mm, heavier every 25 mm — and it appears on its own
whenever geometry is being changed: while anything is dragged, and from the
moment one of these boxes takes the focus.

What remains mouse-only: the drag handles for column widths and row heights, and
free positioning of images. Both make the same change the labelled properties
bar makes, so nothing is only reachable by pointer — but the direct gesture is
not there, and that is a real gap rather than an oversight.

**Theme.** Light and dark, following the system preference, with an override in
Settings — a dark editor around a white sheet is uncomfortable for exactly the
work this tool is for.

## Backup and restore

**One database holds everything** — templates, every version, uploaded assets,
users and API keys. There is no second store and no file volume to coordinate,
which is the whole backup story:

```bash
# Back up (compose deployment)
docker compose exec -T db pg_dump -U linform linform | gzip > linform-$(date +%F).sql.gz

# Restore into an empty database
gunzip -c linform-2026-07-29.sql.gz | docker compose exec -T db psql -U linform linform
```

Assets live in the database as rows, so a dump captures them; on the other hand
a deployment with large page backgrounds will produce large dumps, and that is
the trade behind that decision.

**Verify the restore, not just the backup.** A dump nobody has restored is a
belief, not a backup. The check that matters here is end to end, because it
exercises the promise the product makes:

1. Restore the dump into a scratch database.
2. Point an instance at it (`LINFORM_DATABASE_URL`).
3. Render a template **by a pinned version** and compare the PDF's page count
   and text against the original — `tests/golden_support.py` has the helpers.

If a pinned version renders identically, versions, assets and the engine all
came back. If it does not, you have found the problem while it is still cheap.

Nothing else needs backing up: the container is rebuilt from the image, and the
configuration is your `.env`. What is *not* recoverable is business data —
payloads are rendered and forgotten by design, so store the payload or the
resulting PDF on your side, with the version number beside it.

## Security

The short version: **a template is untrusted code, and an editor user is
trusted.** Jinja runs sandboxed, external URL fetching is off by default so a
template cannot make the server fetch internal addresses, markup is stripped of
executable content before it reaches the editor canvas with a CSP behind it,
passwords are slow-hashed and tokens stored as digests, and payloads are never
logged or stored. Anyone who can sign in as an editor, however, can read and
change every template in the deployment — there is no per-template permission
model.

Full threat model, what is deliberately *not* covered, a hardening checklist,
and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## Configuration

| Env variable | Default | Meaning |
|---|---|---|
| `LINFORM_ROLE` | `all` | `all`, `editor` or `render` — which half of the service this process serves (see Deployment roles) |
| `LINFORM_RENDER_TOKEN` | *(empty)* | Bearer token for render endpoints only — give this to consuming applications |
| `LINFORM_ADMIN_TOKEN` | *(empty)* | Bearer token for everything incl. template/asset management — the editor side |
| `LINFORM_API_TOKEN` | *(empty)* | Legacy single token, counts as both roles. No tokens at all = auth disabled (dev) |
| `LINFORM_SUPERUSER` | *(empty)* | Bootstrap admin username. Set with the password below to enable user accounts |
| `LINFORM_SUPERUSER_PASSWORD` | *(empty)* | Bootstrap admin password, re-synced from env on every start (env is the source of truth) |
| `LINFORM_SESSION_TTL_HOURS` | `168` | How long a browser login stays valid |
| `LINFORM_MAX_LOGIN_FAILURES` | `5` | Consecutive failures before an account is locked |
| `LINFORM_LOGIN_LOCKOUT_MINUTES` | `15` | How long that lock lasts |
| `LINFORM_LOGIN_RATE_PER_MINUTE` | `20` | Login attempts per client address per minute (0 disables) |
| `LINFORM_RENDER_TIMEOUT_SECONDS` | `30` | Hard render timeout |
| `LINFORM_RENDER_MAX_WORKERS` | `2` | Render worker processes |
| `LINFORM_RENDER_MAX_CONCURRENCY` | `0` (→ workers × 2) | In-flight ceiling; over it, renders get `429 Retry-After` |
| `LINFORM_STRICT_PLACEHOLDERS` | `true` | Fail on missing placeholder values |
| `LINFORM_TEMPLATE_CACHE_TTL_SECONDS` | `2` | How long another replica may serve the previous current version after a rollback (0 = no caching) |
| `LINFORM_TEMPLATE_CACHE_MB` | `32` | Memory budget for resolved template versions |
| `LINFORM_ASSET_CACHE_MB` | `64` | Memory budget for assets inlined into renders; content-addressed, so never stale |
| `LINFORM_ALLOW_EXTERNAL_URLS` | `false` | Allow http(s) resources in templates |
| `LINFORM_ALLOWED_URL_HOSTS` | `[]` | Host allowlist when external URLs are on |
| `LINFORM_AI_API_KEY` | *(empty — assistant off)* | BYOK key for an OpenAI-compatible API; stays server-side |
| `LINFORM_AI_BASE_URL` | `https://api.openai.com/v1/` | Provider base URL (Gemini compat, OpenRouter, Ollama, …) |
| `LINFORM_AI_MODEL` | `gpt-4o-mini` | Model id |
| `LINFORM_AI_SEND_TEST_DATA` | `false` | Allow the assistant to see test data (may contain personal data) |
| `LINFORM_AI_TIMEOUT_SECONDS` | `60` | Give up on the AI provider after this long |
| `LINFORM_JSON_LOGS` | `false` | One JSON object per log line (for a collector); plain text otherwise |
| `LINFORM_LOG_LEVEL` | `INFO` | Root log level |
| `LINFORM_METRICS_ENABLED` | `false` | Serve Prometheus metrics at `/metrics` (behind the render role) |
| `LINFORM_DATABASE_URL` | local SQLite file | Database; compose sets PostgreSQL |
| `LINFORM_PORT` | `8100` | Host port (compose only) |
| `LINFORM_DB_PASSWORD` | `linform` | PostgreSQL password (compose only) |

## How it compares

The fastest way to decide whether this is the wrong tool for you.

| | Linform | Carbone | PDFMonkey | Gotenberg | wkhtmltopdf |
|---|---|---|---|---|---|
| Hosting | self-hosted | self-hosted or cloud | cloud only | self-hosted | library |
| Template format | HTML + Jinja2 | DOCX/XLSX/ODT | HTML | anything you send it | HTML |
| Template editing | built-in web editor, code **and** visual | your word processor | web editor | none — you bring the file | none |
| Versioning | immutable versions, publish, rollback, pinning | via your VCS | built-in | none | none |
| Engine | WeasyPrint (CSS Paged Media) | LibreOffice | Chromium | Chromium / LibreOffice | old WebKit |
| JavaScript in templates | no | no | yes | yes | limited |
| Async / batch API | no, by design | yes | yes | no | n/a |
| Your data leaves your network | never | only in cloud mode | yes | never | never |

**Where Linform is the better answer.** You need the printed page to be exact
and to stay exact for years — page furniture, running headers, counters, comb
fields — and you need whoever owns the form to be able to change it without a
deploy, while the application keeps calling one stable code. Nothing leaves
your network.

**Where it is the worse answer, plainly:**

- **Your templates are Word documents and their authors will not give that
  up.** Carbone's model is built for that; Linform imports `.docx` once, as a
  starting point, not as a living format.
- **You need JavaScript in templates**, or a layout that leans on CSS grid.
  Gotenberg or PDFMonkey render with a real browser; WeasyPrint does not.
- **You want a queue, retries and stored results out of the box.** Linform is
  deliberately synchronous — that machinery stays in your application (see
  [DECISIONS.md](docs/DECISIONS.md#5-rendering-is-synchronous-with-a-ceiling-and-a-429)).
- **You want zero operations.** PDFMonkey is a hosted product; this is a
  container, a database and your own backups.
- **You need per-team isolation inside one instance.** There is no
  per-template permission model — run separate instances instead.
- **Raw throughput on huge volumes.** A browser-based renderer parallelises
  across more cores more readily; Linform's answer is more workers and more
  replicas.

## Roadmap

- [x] Render core: `POST /api/render` (HTML + JSON → PDF)
- [x] Stored templates with immutable versions (draft → published → archived)
- [x] Render by stable template code + explicit version pinning
- [x] Web editor: HTML mode with live paged preview, placeholder panel
- [x] Content-addressed assets (logos, backgrounds) with `asset://` references
- [x] Version history with diff, publish/rollback from the UI
- [x] Visual (WYSIWYG) editing mode alongside the HTML mode — a purpose-built
  DOM editor whose round trip is byte-exact through the Jinja bridge (no
  third-party WYSIWYG re-serializing the markup)
- [x] Import a starting template from `.docx`
- [x] Barcodes and QR codes from payload data
- [x] Optional AI assistant (bring your own key)
- [x] Deployment role split (`editor` / `render`) so render nodes carry no management API
- [x] Verified multi-replica run (`--scale`), checked in CI

## License

MIT
