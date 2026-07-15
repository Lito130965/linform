# Linform

**Versioned print forms — HTML in, PDF out.**

Self-hosted service for generating print documents (invoices, certificates,
reports) from HTML templates. Analysts create and version templates in a web
editor; your application gets a PDF with a single API call, passing JSON data.

> Status: early development. Done: render core, stored templates with
> immutable versions, publish/rollback, version pinning.

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

## Configuration

| Env variable | Default | Meaning |
|---|---|---|
| `LINFORM_API_TOKEN` | *(empty — auth off)* | Bearer token for the API |
| `LINFORM_RENDER_TIMEOUT_SECONDS` | `30` | Hard render timeout |
| `LINFORM_RENDER_MAX_WORKERS` | `2` | Render worker processes |
| `LINFORM_STRICT_PLACEHOLDERS` | `true` | Fail on missing placeholder values |
| `LINFORM_ALLOW_EXTERNAL_URLS` | `false` | Allow http(s) resources in templates |
| `LINFORM_ALLOWED_URL_HOSTS` | `[]` | Host allowlist when external URLs are on |
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
- [ ] WYSIWYG mode

## License

MIT
