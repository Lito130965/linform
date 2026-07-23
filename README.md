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
| POST | `/api/assets` | Upload an asset (logo, background); returns an immutable `asset://<sha256>` URL |
| GET | `/api/assets` | List uploaded assets |
| GET | `/api/assets/{sha256}` | Raw asset bytes |

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
- **Rendering is synchronous.** One request, one PDF, with a hard timeout.
  Bulk generation ("10 000 invoices") is the calling application's job; Linform
  gives it an idempotent building block.
- **No business data is stored.** Payloads are rendered and forgotten. That is
  deliberate, and it means Linform cannot re-render a document you did not keep
  the data for — store the version number alongside your document and pin it.

## Configuration

| Env variable | Default | Meaning |
|---|---|---|
| `LINFORM_RENDER_TOKEN` | *(empty)* | Bearer token for render endpoints only — give this to consuming applications |
| `LINFORM_ADMIN_TOKEN` | *(empty)* | Bearer token for everything incl. template/asset management — the editor side |
| `LINFORM_API_TOKEN` | *(empty)* | Legacy single token, counts as both roles. No tokens at all = auth disabled (dev) |
| `LINFORM_RENDER_TIMEOUT_SECONDS` | `30` | Hard render timeout |
| `LINFORM_RENDER_MAX_WORKERS` | `2` | Render worker processes |
| `LINFORM_STRICT_PLACEHOLDERS` | `true` | Fail on missing placeholder values |
| `LINFORM_ALLOW_EXTERNAL_URLS` | `false` | Allow http(s) resources in templates |
| `LINFORM_ALLOWED_URL_HOSTS` | `[]` | Host allowlist when external URLs are on |
| `LINFORM_AI_API_KEY` | *(empty — assistant off)* | BYOK key for an OpenAI-compatible API; stays server-side |
| `LINFORM_AI_BASE_URL` | `https://api.openai.com/v1/` | Provider base URL (Gemini compat, OpenRouter, Ollama, …) |
| `LINFORM_AI_MODEL` | `gpt-4o-mini` | Model id |
| `LINFORM_AI_SEND_TEST_DATA` | `false` | Allow the assistant to see test data (may contain personal data) |
| `LINFORM_AI_TIMEOUT_SECONDS` | `60` | Give up on the AI provider after this long |
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
