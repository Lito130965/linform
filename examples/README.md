# Example templates

Three templates that double as documentation of what the engine can do.
Each has a matching `*.data.json` with sample payload.

| Template | Shows |
|---|---|
| [invoice.html](invoice.html) | `{% for %}` table flowing across pages, repeating `<thead>`, page numbers via CSS counters, consumer-computed totals |
| [shipping_label.html](shipping_label.html) | `qr` and `barcode('code128')` filters — vector symbols sized in mm |
| [certificate.html](certificate.html) | fixed one-page layout, `@page` + absolute positioning, `{% if %}`, character cells |

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
