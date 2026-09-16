# Writing a template

A template is an HTML document with `{{ placeholders }}`. Nothing else: no
component model, no proprietary format, no designer file. What the browser
shows the person editing it is the markup the renderer will be handed.

Ready-made ones to start from — an invoice with a flowing table, a shipping
label with QR and barcode, a fixed-layout certificate — are in
[examples/](../examples/), each with sample data and curl commands.

## The pipeline

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

## Barcodes and QR codes

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


## Assets

Logos and backgrounds are uploaded once and referenced as
`asset://<sha256>` — content-addressed, so a template version keeps rendering
with exactly the file it was published against. Replacing a logo means
uploading a new one and publishing a new version, which is the point.

## What the page is

Page size, margins and furniture are CSS Paged Media: `@page` for the sheet,
`@top-center` / `@bottom-*` for running headers and footers, `counter(page)`
for numbering, `page-break-*` and `break-inside` for where it may split. The
visual editor writes the same CSS through its panels, so a template is never
locked to the tool that made it.

The engine's limits — what it lays out and what it does not — are in
[Limits](../README.md#limits--what-this-does-not-do), and the claims there are
checked against the pinned engine by `tests/test_engine_capabilities.py`.
