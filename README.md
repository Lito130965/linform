# Linform

**Versioned print forms — HTML in, PDF out.**

Self-hosted service for generating print documents (invoices, certificates,
reports) from HTML templates. Analysts create and version templates in a web
editor; your application gets a PDF with a single API call, passing JSON data.

> Status: early development, usable. Render core, immutable versions with
> publish/rollback and pinning, web editor (code + visual), assets, `.docx`
> import, barcodes, and an optional AI assistant.

## Quick start

```bash
docker compose up -d   # app on :8100 + PostgreSQL (not exposed)
```

Create a template, publish a version, render a PDF:

```bash
# 1. Template with a stable code your app will render by
curl -X POST localhost:8100/api/templates \
  -H "Content-Type: application/json" \
  -d '{"code": "invoice", "name": "Invoice"}'

# 2. First version (always created as a draft)
curl -X PUT localhost:8100/api/templates/invoice \
  -H "Content-Type: application/json" \
  -d '{"html_content": "<h1>Invoice #{{ number }}</h1>", "comment": "initial"}'

# 3. Publish it
curl -X POST localhost:8100/api/templates/invoice/publish/1

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
| PUT | `/api/templates/{code}` | Add a new **draft** version (never overwrites) |
| POST | `/api/templates/{code}/publish/{v}` | Publish a version (publishing an older one = rollback) |
| GET | `/api/templates/{code}/versions/{v}` | Full version content |
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

Versioning model: versions are **immutable**; exactly one version per template
is published (enforced by the database, safe with any number of replicas);
the consumer either renders "whatever is published" or pins an explicit
version — deciding *which* documents pin *which* version is the consumer's
business rule, kept out of this service on purpose.

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
- **Partial CSS grid.** Flexbox works, including nested row/column layouts;
  grid support is incomplete. Print forms are tables, blocks and absolute
  positioning, which is what the engine is good at — complex web layouts will
  not survive the trip.
- **No deployment role split yet.** All endpoints — render *and* template
  management — are mounted in every instance. Until that is separated, put the
  editor behind your internal network and hand consuming applications a
  render-only token (see below), which already prevents a leaked service token
  from changing templates.
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
  content across a break: a block that straddles a boundary is drawn whole, with
  the line through it, while the renderer moves it entirely to the next page.
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

Ad-hoc renders share a single `<ad-hoc>` label instead of minting a series per
request.

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

Accessibility is checked with axe-core on the journal, the settings page and
the editor shell. The canvas iframe is excluded deliberately: it contains the
user's own template, and failing the build over the contrast of somebody's
letterhead would be both wrong and unfixable from here. `npm run lint` in
`frontend/` covers the same ground statically (`eslint-plugin-jsx-a11y`).

## Configuration

| Env variable | Default | Meaning |
|---|---|---|
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
- [ ] Deployment role split (`editor` / `render`) so render nodes carry no management API
- [ ] Verified multi-replica run (`--scale`)

## License

MIT
