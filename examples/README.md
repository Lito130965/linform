# Example templates

Templates that double as documentation of what the engine can do. Each has a
matching `*.data.json` with a sample payload, and `manifest.json` lists them in
gallery order. These same files power the **Examples gallery** in the editor
(`GET /api/examples`), where you can open, edit and render any of them without
saving. Everything here is synthetic — no real forms.

The furniture and code snippets are byte-identical to what the editor's presets
and blocks insert, so an example is a faithful preview of clicking the tool.

| Template | Shows |
|---|---|
| [certificate.html](certificate.html) | fixed one-page layout, `@page` + absolute positioning, `{% if %}`, character cells |
| [invoice.html](invoice.html) | `{% for %}` table flowing across pages, repeating `<thead>`, a conditional discount row, page numbers via CSS counters, consumer-computed totals |
| [govform.html](govform.html) | character-cell combs, rows padded to a fixed count, checkbox glyphs from booleans |
| [report.html](report.html) | full-bleed page background, repeating header/footer, page numbers, `qr` + `barcode` |
| [colormatrix.html](colormatrix.html) | per-cell background and text colours from data — a status grid |
| [shipping_label.html](shipping_label.html) | `qr` and `barcode('code128')` filters — vector symbols sized in mm |

## Try one without saving anything

```bash
python -c "import json;print(json.dumps({'html':open('examples/invoice.html').read(),'data':json.load(open('examples/invoice.data.json'))}))" \
  | curl -s -X POST localhost:8100/api/render -H 'Content-Type: application/json' -d @- \
  --output invoice.pdf
```

## Load as a stored template

```bash
curl -X POST localhost:8100/api/templates \
  -H "Content-Type: application/json" \
  -d '{"code": "invoice", "name": "Invoice"}'

python -c "import json;print(json.dumps({'html_content':open('examples/invoice.html').read(),'comment':'from examples'}))" \
  | curl -X PUT localhost:8100/api/templates/invoice -H 'Content-Type: application/json' -d @-

curl -X POST localhost:8100/api/templates/invoice/publish/1

curl -X POST localhost:8100/api/render/invoice \
  -H "Content-Type: application/json" \
  -d @examples/invoice.data.json --output invoice.pdf
```

Rules of thumb the examples follow (the hard-won ones):

- Page furniture — margins, footers, backgrounds — lives on `@page`, so it
  appears on every page the content flows onto.
- A container that grows with data gets **no** fixed height and **no**
  `overflow: hidden`: clipped rows disappear silently, with no error.
- `tr { page-break-inside: avoid }` keeps rows whole at page boundaries.
- A row of character cells gets `white-space: nowrap` — inline blocks wrap
  like words, and 12 cells silently become 8 + 4 on two lines.
- Money and totals arrive pre-formatted from the consumer: the service does
  no business math on purpose.
