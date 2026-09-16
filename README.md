# Linform

[![CI](https://github.com/Lito130965/linform/actions/workflows/ci.yml/badge.svg)](https://github.com/Lito130965/linform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](pyproject.toml)

**Versioned print forms — HTML in, PDF out.**

Self-hosted service for print documents: invoices, certificates, government
forms. Whoever owns the form edits it in a web editor — code or visual — and
publishes a numbered version. Your application posts JSON to one stable code and
gets a PDF. That version is frozen, so the same call renders the same document
years later.

**[Try the editor →](https://linform.linitapp.com/)** — the examples gallery on a
live instance. Open any template, edit it, watch the PDF change. Nothing is
saved there and uploads are cleared within the hour; it is the same image this
repository publishes, run with `LINFORM_ROLE=demo`.

## Is this for you?

**Yes, if** the printed page has to be exact and stay exact for years; the
person who owns the form should be able to change it without a deploy; your
data must not leave your network.

**No, if** your templates are Word documents and their authors will not give
that up; you need JavaScript or a layout that leans on CSS grid; you want a
queue, retries and stored results; you need per-team isolation inside one
instance.

The long version, against Carbone, Gotenberg, PDFMonkey and the report
designers: [docs/COMPARISON.md](docs/COMPARISON.md).

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
docker run -p 8100:8000 ghcr.io/lito130965/linform:latest
```

Images are published on each tagged release; `latest` follows the newest, and a
release tag pins the image the way a template version pins a document. Building
it yourself is `docker build -t linform . && docker run -p 8100:8000 linform`.

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

Ready-made templates to start from live in [examples/](examples/), each with
sample data and curl commands.

## How it works

```
HTML template with {{ placeholders }}  →  Jinja2 (sandboxed)  →
final HTML  →  WeasyPrint  →  PDF
```

Jinja2 runs sandboxed, because a template is untrusted input. WeasyPrint lays
the document out with CSS Paged Media — `@page`, running headers and footers,
page counters, explicit break control — which is what makes a page repeatable
rather than approximately right. External URLs are blocked by default, so a
template cannot make the server fetch an internal address.

Writing one, including barcodes and QR codes drawn from payload data:
[docs/TEMPLATES.md](docs/TEMPLATES.md). What the visual editor does beyond
typing — snapping, page-break marking, the keyboard:
[docs/EDITOR.md](docs/EDITOR.md).

**Archival and tagged output.** `LINFORM_PDF_VARIANT=pdf/a-3b` writes PDF/A,
the standard an archive or a public-sector filing is usually required to be in;
`pdf/ua-1` writes a tagged document a screen reader can navigate. PDF/A the
engine handles by itself — fonts and colour profiles are its business. PDF/UA
is a flag *and* a requirement on the template, because a tagged file is only
navigable if there is something in the markup to tag; that trade is spelled out
in [docs/CONFIGURATION.md](docs/CONFIGURATION.md#pdfa-and-pdfua).

## Versions

**A draft is not a version.** A draft is a working copy: no number, editable,
deletable, and unreachable by any consuming application. A version exists only
once something is **published** — it is numbered then, which means a version
number always refers to something a consumer could legitimately have rendered.

Published versions are immutable, and exactly one is *current* (enforced by the
database, so it holds with any number of replicas). Pointing that at an older
version is the rollback; it mints no new number. A consumer either renders
"whatever is current" or pins an explicit version, and deciding *which*
documents pin *which* version is the consumer's business rule, kept out of this
service on purpose.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/render/{code}` | **Main endpoint**: render the current version |
| POST | `/api/render/{code}/versions/{v}` | Pin an exact version (reproducible forever) |
| POST | `/api/render` | Ad-hoc render: raw HTML + data, nothing stored |
| GET | `/api/templates/{code}/placeholders` | Fields the template expects — the integration contract |
| POST | `/api/templates/{code}/drafts` | Start a working copy |
| POST | `/api/templates/{code}/drafts/{id}/publish` | Publish it: numbered, frozen, live |
| POST | `/api/templates/{code}/versions/{v}/current` | Point consumers at a version (the rollback) |
| GET | `/health` · `/ready` | Liveness · readiness |

Templates, directories, assets, accounts and the admin endpoints:
[docs/API.md](docs/API.md), or `/docs` on a running instance.

## AI assistant (optional, off by default)

With a key configured, the editor gains an assistant that drafts a template from
a description or a scan and makes targeted corrections. **It never writes to the
database** — saving and publishing stay human actions, so immutability is
untouched.

For anything the editor already does — the page, a header or footer, a block, a
preset, a field — it asks for **that operation** rather than writing markup, and
you see it as a list of sentences. What lands is then what the panels produce: a
footer the header switch maintains, a page number built on counters, both still
editable afterwards. Its vocabulary is exactly the editor's, checked against the
editor's own source in CI. Changes apply in the visual editor as they arrive,
and one press takes them back.

Bring your own key: it stays on the backend and is never sent to the browser.
What leaves your machine when you use it — the template, placeholder *names*,
the prose of the chat, attached screenshots, and your test data only if you opt
in — is listed in [docs/ASSISTANT.md](docs/ASSISTANT.md). This is the one place
where Linform talks to a third party; everything else runs entirely inside your
deployment and needs no internet access at all.

## Limits — what this does not do

Better to know before you build on it:

- **No JavaScript in templates.** WeasyPrint renders documents, not web pages.
- **Print CSS, not browser CSS.** Flexbox lays out, and so does explicit CSS
  grid — both checked against the pinned engine by rendering a page and reading
  back where things landed (`tests/test_engine_capabilities.py`), so the claim
  stays honest across upgrades. The further corners of grid — auto-placement,
  named areas, subgrid — are untested, and a layout copied from a web page may
  still not survive the trip.
- **Rendering is synchronous.** One request, one PDF, with a hard timeout and a
  hard in-flight ceiling — past it the service replies `429 Retry-After` instead
  of queueing without bound. Bulk generation and retries are the calling
  application's job; Linform gives it an idempotent building block.
- **No business data is stored.** Payloads are rendered and forgotten. It
  follows that Linform cannot re-render a document you did not keep the data
  for — store the version number alongside your document and pin it.
- **One instance mounts everything, unless you split it.** `LINFORM_ROLE=render`
  leaves the management API out of the process entirely; either way, keep the
  editor on an internal network.
- **The visual canvas approximates pagination; the preview is the truth.** It
  draws each page boundary where the page really ends and marks what a break
  will do to the element it crosses, but it does not reflow content across the
  break, and it is a different layout engine from the renderer. Author in the
  canvas, confirm in the PDF beside it; where they disagree, the PDF is right.
  The full difference is in [docs/EDITOR.md](docs/EDITOR.md).

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

## What's next

- **A PDF variant per template version.** The archival standard is an instance
  setting today, which sits awkwardly beside "a version renders the same
  document forever" — changing it changes what an old version produces.
- **Accessibility hints in the editor** — an image with no alternative text, a
  table with no header row, a heading that is only a large paragraph.
- **Keyboard parity in the canvas** — column widths, row heights and free
  positioning are still mouse-only gestures (`good first issue`).
- **An asset storage interface**, so a deployment with page-sized backgrounds
  can put them somewhere other than the database.
- **Interface localisation** — one locale today (`help wanted`).

<details>
<summary>What is already done</summary>

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

</details>

## About this project

I work in QA on tax software for the public sector, where a printed form must
render years later exactly as it did when it was filed. Linform is my answer to
that problem. Architecture, scope, technical decisions, the test strategy and
review are mine; implementation was AI-assisted — see the `Co-Authored-By`
trailers in the history. The reasoning behind the design is in
[docs/DECISIONS.md](docs/DECISIONS.md).

## Documentation

| | |
|---|---|
| [DECISIONS.md](docs/DECISIONS.md) | Why it is built this way, and what was rejected |
| [TEMPLATES.md](docs/TEMPLATES.md) | Writing a template: Jinja, paged CSS, barcodes, assets |
| [EDITOR.md](docs/EDITOR.md) | The visual canvas: keyboard, snapping, page breaks |
| [API.md](docs/API.md) | Every endpoint, accounts and roles, the version model |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable |
| [OPERATIONS.md](docs/OPERATIONS.md) | Observability, performance, deployment roles, backup |
| [TESTING.md](docs/TESTING.md) | Golden PDFs, browser tests, accessibility |
| [TEST-STRATEGY.md](docs/TEST-STRATEGY.md) | What is tested, what is not, and the risks behind both |
| [MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) | What is checked by hand, and why |
| [SECURITY.md](SECURITY.md) | Threat model and reporting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Running and testing it locally |
| [CHANGELOG.md](CHANGELOG.md) | What changed, release by release |

## License

MIT
