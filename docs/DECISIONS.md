# Decisions

The reasoning behind Linform's design, in the form of the choice that was made,
what it bought, and what it cost. Every entry here had a plausible alternative;
the cost column is the honest part.

Ordered roughly by how much of the rest of the system each one determines.

---

## 1. WeasyPrint, not Chromium

**Context.** The service turns HTML into PDF. The obvious choice is headless
Chromium (Puppeteer/Playwright): it renders anything a browser renders.

**Decision.** WeasyPrint — a Python library that implements CSS Paged Media —
running in a process pool.

**Why.** Printed forms are a paged-media problem, not a web-page problem. The
things this product lives on — `@page` margin boxes, running headers and
footers, `counter(page)`, page-break control, physical units — are what
WeasyPrint is *for*, and are precisely where Chromium's print path is thin
(margin boxes and running elements are not supported at all). It also renders
deterministically from the same input: no JavaScript, no network, no timing.
And it is one `pip install` in the same process tree as the service, instead of
a browser to supervise, sandbox and keep patched.

**Cost, paid knowingly.**
- **No JavaScript in templates.** A template that computes something in JS
  cannot be ported here — computation belongs to the caller.
- **Incomplete CSS grid.** Flexbox works; grid does not, fully. Print forms are
  tables, blocks and absolute positioning, which the engine is good at, but a
  design copied from a web page may not survive.
- **The engine is the ceiling.** When WeasyPrint cannot lay something out,
  there is no second engine to fall back to. This is why a failure of the
  engine is reported as `422` with the message attached, not `500` — it is
  nearly always a template the author can fix.

---

## 2. A purpose-built visual editor, not GrapesJS

**Context.** The editor needs a visual mode. GrapesJS is the standard
open-source answer and was in the project first.

**Decision.** GrapesJS was removed and replaced with an editor whose document
model *is* the DOM inside an iframe. Export is `body.innerHTML` minus exactly
the affordances the editor added.

**Why.** GrapesJS parses markup into its own component model and re-serializes
on the way out. For a page builder that is fine. For this product it is fatal:
the round trip reordered CSS rules, dropped `@page` blocks, rewrote attributes,
and mangled the Jinja constructs that make a template a template. A form that
renders correctly must still render correctly after someone opens it to change
one word — and with a model in the middle, "opening it" is an edit.

**The invariant this buys.** A visual visit changes nothing but what the user
changed. It is enforced at three levels: string-level unit tests, a spike gate
that round-trips every example through a real parser and allows only a small,
*named* set of benign normalizations, and a browser test that opens a template
in a real Chromium, leaves, saves, and compares the stored bytes. A second
visit must change nothing at all.

**Cost.**
- Everything a page builder gives away had to be written: selection, the
  element toolbar, table operations, undo, drag-to-reorder, page geometry.
- The editor is bound to one engine's DOM behaviour, and is tested against one
  browser.
- Some constructs (macros, `{% set %}`, comments) cannot be represented
  visually. They are preserved byte-for-byte as inert chips rather than
  silently dropped, and templates that go further stay code-only.

**Related.** The canvas approximates pagination: it draws page boundaries where
pages truly end, including the margins each page spends, but it does not reflow
content across a break. The PDF preview is the stated source of truth. See
"Limits" in the README.

---

## 3. Versions are immutable; assets are content-addressed

**Context.** A form that was filed in March must be reproducible in November,
including the logo it was filed with.

**Decision.** A template version is never edited. Saving creates a new one.
Assets are stored under the SHA-256 of their bytes and referenced as
`asset://<hash>`; replacing a logo means uploading a new file.

**Why.** Reproducibility cannot be a policy, it has to be a property. If a
version could be edited, "render version 4" would mean different things on
different days, and no amount of process discipline would fix that. Content
addressing extends the same guarantee to the images: an old version keeps
rendering the exact bytes it was published with, because its reference *is* the
bytes.

**Cost.** Storage grows monotonically — every save is a row, every distinct
image is a blob. Deduplication by hash softens it, and templates are kilobytes,
but nothing here ever shrinks. There is also no `DELETE` for templates yet; a
mistyped code lives forever (archiving is on the roadmap, and it will archive,
not delete, for the same reason).

---

## 4. "One published version" is a database constraint, not application logic

**Context.** Exactly one version of a template may be live. The obvious
implementation is a transaction in the publish handler.

**Decision.** A partial unique index (`WHERE status = 'published'`), plus a
unique constraint on the version number per template with insert-and-retry for
allocation.

**Why.** Application logic is only correct while there is one instance of the
application. The moment a deployment runs two pods — which this project claims
to support — two publishes can interleave and both read "nothing is published
yet". The database is the only place where the rule can be stated once and hold
for every replica. It also means the invariant survives a bug in the handler.

**Cost.** The behaviour depends on the database supporting partial indexes, and
its semantics differ between SQLite and PostgreSQL — which is why the
concurrency tests run against PostgreSQL specifically. Callers must be prepared
for a `409` on a lost race, and the retry loop that resolves version numbering
is genuinely subtle: an early version of it reused an ORM object across a
rollback and broke on the very race it existed for.

---

## 5. Rendering is synchronous, with a ceiling and a 429

**Context.** Rendering is expensive and unbounded demand is possible. The
conventional answer is a job queue: accept, return `202`, poll or call back.

**Decision.** One request, one PDF, a hard timeout, and a hard in-flight
ceiling. Past the ceiling the service answers `429` with `Retry-After`
immediately.

**Why.** A queue would make Linform responsible for state it deliberately does
not keep: job identity, results storage, retention, retries, dead letters,
delivery. The consuming application already has all of that, because it already
has a database and a job runner. Keeping the service synchronous keeps it an
idempotent building block — the same input gives the same PDF, and there is
nothing to reconcile after a crash.

Refusing fast rather than queueing is the same reasoning at a smaller scale: a
queue inside the process turns a load spike into rising latency for everyone,
including the caller who would rather have been told "not now" and come back.

**Cost.** Bulk generation is the caller's job, and a naive client that fires
sixteen parallel requests will see most of them refused (measured: 36 of 40).
That is documented behaviour, not a defect, but it does put a requirement on
the client: honour `Retry-After`.

---

## 6. No business data is stored

**Context.** The payload rendered into a form is, by definition, somebody's
personal or financial data.

**Decision.** Payloads are rendered and forgotten. They are not persisted, not
cached, and never written to a log — the request-logging middleware records
method, path, status, duration and the *name* of the principal, and nothing
else.

**Why.** Data that is not stored cannot leak, cannot be requested under a
retention policy, and does not need an erasure procedure. For a service used in
regulated domains this removes an entire category of obligation rather than
managing it.

**Cost.** Linform cannot re-render a document whose data you did not keep. The
consumer must store the payload (or the resulting PDF) and the version number
alongside it — the version pinning API exists precisely to make that workable.
It also means no server-side "render history" to debug from: when a form comes
out wrong, reproduction needs the payload from the caller.

---

## 7. A template is untrusted code

**Context.** Templates are written by users, imported from Word, and generated
by an AI assistant. They are then executed.

**Decision.** Jinja runs in a sandboxed environment. External URL fetching is
off by default (data URIs only), with an explicit host allowlist when enabled.
Markup is stripped of executable content before it reaches the editor canvas,
and a Content-Security-Policy stands behind that. Uploaded assets outside a
safe MIME allowlist are served as attachments.

**Why.** Every one of those inputs is a path from a user to code execution. The
sandbox stops SSTI and attribute traversal; the URL policy stops a template
from making the *server* fetch internal addresses; sanitization and CSP stop a
`<script>` from running in the editor's origin, where it would sit next to the
session token — a risk invisible in the PDF, because the renderer ignores
scripts entirely, and therefore easy to miss.

**Cost.** Templates cannot reach the network for images or fonts unless an
operator opts in per host; everything else must be embedded as a data URI or
uploaded as an asset. Inline CSS must be allowed by the CSP (a print form *is*
styling), so that directive is deliberately weaker than the script one. And
sanitization is applied at the canvas, not to stored bytes: rewriting a whole
document through a parser would normalize the author's markup, which decision 2
forbids — so what the user gets for a stored template is a warning, not an
edit.
