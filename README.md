# Linform

**Versioned print forms — HTML in, PDF out.**

Self-hosted service for generating print documents (invoices, certificates,
reports) from HTML templates. Analysts create and version templates in a web
editor; your application gets a PDF with a single API call, passing JSON data.

> Status: early development. Current milestone: render core.

## Quick start

```bash
docker build -t linform .
docker run -p 8000:8000 linform
```

Render a PDF:

```bash
curl -X POST http://localhost:8000/api/render \
  -H "Content-Type: application/json" \
  -d '{
        "html": "<h1>Invoice #{{ number }}</h1><p>Total: {{ total }}</p>",
        "data": {"number": 42, "total": "150 000"}
      }' \
  --output invoice.pdf
```

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

## Roadmap

- [x] Render core: `POST /api/render` (HTML + JSON → PDF)
- [ ] Stored templates with immutable versions (draft → published → archived)
- [ ] Render by stable template code + explicit version pinning
- [ ] Web editor: HTML mode with live paged preview
- [ ] WYSIWYG mode, placeholder panel, version diff

## License

MIT
