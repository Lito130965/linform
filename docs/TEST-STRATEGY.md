# Test strategy

What this project tests, what it deliberately does not, and how the two were
decided. The mechanics — how to run each suite — are in
[TESTING.md](TESTING.md); this is the reasoning behind them.

Counts are from 0.3.0: 237 backend tests, 431 frontend unit tests, 142 browser
tests.

---

## 1. Three promises, and the rule that follows from them

Linform makes three promises that the rest of the design exists to keep:

1. **A published version renders the same document forever.** The same template
   code, the same payload, the same PDF — next week and in four years.
2. **A template is untrusted code.** Nothing in a template may reach the host,
   the network, another deployment's data, or the browser of the person editing
   it.
3. **Business data is not stored.** A payload is rendered and forgotten, and it
   is never written to a log.

**The rule: a defect that breaks any of the three blocks the release.** Not
"raise a ticket", not "fix it in the next one" — these are the sentences a
reader of the README decides on, and a product that breaks one of them is
mis-sold rather than buggy. Everything else is a trade-off to be weighed like
any other.

That rule is what the registry below is ordered by. A risk's severity here is
not "how annoying" — it is "which promise does this break, and would anybody
notice".

---

## 2. Risk registry

Impact is read against the three promises. The last column is the honest one.

| Risk | Likely? | Impact | What catches it | Where | What is still uncovered |
|---|---|---|---|---|---|
| An engine, font or CSS-preset change moves layout across every template at once | **Likely** — it is one `pip install` away | **Severe** (1) | Golden PDFs: exact page count, page-by-page text, page geometry, symbols as vector drawings | `tests/test_golden_pdfs.py`, `tests/golden/` | Only the six examples. A deployment's own templates are its own golden set — this is said in the docs, not solved for them |
| A document claims a PDF standard it does not meet | Moderate | **Severe** (1) — an archive rejects it years later | The variant reaches the engine and the file says what it was asked to say; the name is checked against the engine's own list | `tests/test_pdf_variants.py` | Whether it is *valid*. That is veraPDF's answer, by hand, before a release ([M-08](MANUAL-CHECKS.md)) — and PDF/UA depends on the template, not on us |
| A CSS capability the documentation claims quietly stops working | Moderate | Moderate | A page is rendered and read back: where did the box actually land, against a control | `tests/test_engine_capabilities.py` | The claim list is what somebody thought to write down |
| The visual editor corrupts a template it merely opened | **Likely** — every canvas change is a chance | **Severe** (1), and silent | Byte-exact round trip: open in the canvas, leave, save, compare stored bytes through the API | `e2e/tests/roundtrip.spec.ts`, `frontend/src/jinja-bridge/*.test.ts` | Constructs no example uses; the tolerance tests name the ones that are known |
| A template injects script into the editor of the person opening it | Moderate | **Severe** (2) | Markup is stripped before it reaches the canvas; CSP headers asserted on the built image | `frontend/src/editor/sanitize.test.ts`, `tests/test_security_headers.py` | A browser bug in the CSP implementation itself |
| A template makes the server fetch an internal address (SSRF) | Moderate | **Severe** (2) | External fetching off by default; a blocked URL still renders rather than failing open or hanging | `tests/test_render_api.py::test_external_url_blocked_render_still_succeeds` | The allowlist path is exercised, but an operator who opens it owns what they allowed |
| A template loops or expands until the process dies | Moderate | **Severe** (2) — availability | Sandbox refuses the runaway as a client error; a slow render becomes a `504` rather than a hang | `tests/test_runaway_templates.py` | Pathologies that are slow but not slow enough |
| Two replicas mint the same version number, or two versions are current at once | Moderate | **Severe** (1) | The invariants are database constraints, exercised against PostgreSQL concurrently; four containers race the same migration in CI | `tests/test_concurrency_pg.py`, `scripts/verify-scale.sh` | Failure modes of the database itself (failover mid-transaction) |
| A rollback does not reach every replica | Moderate | Moderate | Publish and rollback on the editor node, then every render node is asked what it serves, within the cache TTL | `scripts/verify-scale.sh`, `tests/test_cache.py` | Clock skew and partitioned networks |
| Credentials brute-forced | **Likely** on a public instance | **Severe** (2) | Lockout after N failures, per-address rate limiting, reason never in the 401 | `tests/test_login_throttle.py`, `tests/test_auth.py` | Distributed attempts across many addresses |
| A role change exposes the management API on a render node | Low | **Severe** (2) | Routes are asserted to be absent, not merely refused, for each role | `tests/test_roles.py` | — |
| A payload reaches a log file | Low | **Severe** (3) | The body is asserted absent from the log for every path, including errors | `tests/test_observability.py` | A dependency logging its own copy |
| The assistant offers something the editor cannot do | **Likely** — two files drift | Moderate | The prompt's vocabulary is parsed out of the editor's own source and compared | `tests/test_assistant_editor_ops.py` | The model's prose, which is not a fixture |
| The shipped image differs from what the tests saw | Moderate | Moderate to severe | Browser tests run against the **built image**, not a dev server | `e2e/`, CI `e2e` job | Anything the browser suite does not reach |
| An accessibility regression in the editor | **Likely** | Moderate | axe-core on the journal, settings and editor shell; `jsx-a11y` lint — both blocking | `e2e/tests/a11y.spec.ts`, `npm run lint` | The canvas iframe and CodeMirror's scroller, excluded deliberately (see TESTING.md) |
| A dependency advisory in something that ships | Moderate | Varies | `npm audit --omit=dev` blocking; `pip-audit` advisory | CI `frontend`, `backend` | Advisories published between runs |
| The documentation stops describing the product | **Likely** | Moderate — it is the first thing a reader trusts | Capability probes, prompt-vs-source, link and anchor resolution, version vs changelog | `tests/test_engine_capabilities.py`, `tests/test_assistant_editor_ops.py`, `tests/test_docs_links.py`, `tests/test_version.py` | Prose that is simply wrong |

**Three gaps worth naming, because nothing above covers them:**

- **How the canvas looks.** Geometry is measured; appearance is not. Every
  visual defect this project has shipped was found by a person looking at a
  screen — see [MANUAL-CHECKS.md](MANUAL-CHECKS.md).
- **Symbols scanned off paper.** A QR code that a scanner refuses is a working
  PDF by every automated measure. M-02 in the manual checks exists for this.
- **Templates that were not written here.** Six examples are not a corpus.

---

## 3. Levels, and why the shape is not a pyramid

| Level | Count | Runs in | What only it can answer |
|---|---:|---|---|
| Frontend unit | 431 | ~seconds | Does the editor's logic hold: the bridge, sanitising, the box model, the operation vocabulary |
| Backend unit and API | 237 | ~a minute | Request handling, the version invariants, auth, caching, the limits |
| Golden PDF | included above | with the backend | Did the *output* change |
| Browser, against the built image | 142 | ~minutes | Does the thing we would actually ship work |

The classic pyramid says most tests at the bottom, few at the top, because the
top is slow and brittle. That holds here for cost, and not for risk: the two
promises most expensive to break — the page still renders the same, and the
editor did not corrupt the template — are only visible at the top two levels.
A unit test cannot tell you a PDF's second page moved, and no amount of them
would have caught a page-count header that returned 1 in the image because a
dependency was declared in the test extras.

So the shape is deliberately top-heavy for a project of this size, and the cost
is paid where it is cheapest: the browser suite runs one engine (Chromium), and
the golden set is six documents rather than sixty.

---

## 4. Golden files: what is compared, and how a change is blessed

**Compared:** page count; the text of each page, in order; page geometry; that
QR and barcode symbols reach the page as vector drawings rather than images.

**Not compared: pixels.** A font patch release changes antialiasing and a pixel
comparison reports "17 000 pixels differ", which names nothing and trains
everybody to regenerate without looking. Text plus geometry catches the same
regressions and says *what moved*.

**When the output is meant to change:**

```bash
python -m tests.regenerate_golden          # or: ... regenerate_golden invoice
```

and the regenerated files are committed **on their own**, so the diff is read in
review. Folding a golden update into the commit that caused it is how a layout
regression gets blessed with nobody looking at it. The script needs WeasyPrint's
native libraries, so it runs in the image or on Linux.

---

## 5. Test data

**Everything is synthetic.** No real form, from any employer or any tax
authority, is in this repository, and no personal data of any real person. The
examples are invented companies with invented addresses, and
[examples/README.md](../examples/README.md) says so at the top so that a
contributor does not helpfully add a real one.

This is a policy, not a preference: a print-form service is exactly the kind of
project where somebody's actual invoice is the most convenient fixture to hand.

Three rules follow it through the product:

- A payload is never logged, by any path, and there is a test that says so.
- A payload is never stored — there is nowhere for it to be stored.
- The assistant is sent test data **only** when `LINFORM_AI_SEND_TEST_DATA=true`,
  off by default, because test data is where real personal data creeps in.

---

## 6. Quality gates

Everything below runs on every pull request. Blocking means the merge does not
happen.

| Gate | Blocking | Why that choice |
|---|:---:|---|
| Backend suite, on PostgreSQL | ✓ | The version invariants are database behaviour; SQLite would not prove them |
| OpenAPI snapshot matches | ✓ | An API change made in passing is invisible in a router diff |
| Concurrent migrations, then a downgrade | ✓ | Four containers racing one database is what a deploy actually does; the rollback path is otherwise only exercised during an incident |
| Frontend unit tests, typecheck, build | ✓ | — |
| `jsx-a11y` lint | ✓ | Cheap here, expensive to notice by hand |
| `npm audit --omit=dev` | ✓ | These packages run in a user's browser |
| Browser suite against the built image | ✓ | The only gate that sees what ships |
| `verify-scale.sh 3` | ✓ | Multi-replica claims are made in the README |
| `pip-audit` | advisory | A new CVE against a pinned dependency should be visible, but it must not fail an unrelated pull request |
| `npm audit` (dev tooling) | advisory | The advisories describe a dev server nothing in a deployment starts |
| Manual checks | by hand, per release | [MANUAL-CHECKS.md](MANUAL-CHECKS.md) |

The two advisory rows are the interesting ones. An audit that goes red for
reasons the author cannot act on today is an audit everybody learns to ignore,
and then it reports nothing at all. Splitting them by *what ends up in front of
a user* keeps the blocking one worth blocking.

---

## 7. What is deliberately not tested

| Not tested | Because |
|---|---|
| Pixel-identical PDFs | See section 4: it breaks on font patches and names nothing |
| Browsers other than Chromium | The editor targets one engine, and says so. Testing three would treble the slowest suite to support a claim that is not made |
| What the model writes | A model is not a fixture. What *is* tested is the vocabulary it may use, that an invented operation is refused, and that an edit naming no unique place changes nothing |
| Performance as a pass/fail threshold | The numbers are hardware. They are measured with `scripts/loadtest.py` and published as a method and a shape; asserting a millisecond figure in CI would fail on a noisy runner and teach nobody anything |
| Load in CI | Same reason, plus it would be the longest job in the workflow |
| PDF conformance validation in CI | veraPDF is a Java application and a large download, to check a property that changes about once a year. The tests assert what the document claims; the validator runs by hand before a release, and automatically for anyone who has it installed |
| Third-party internals | WeasyPrint's own correctness is WeasyPrint's suite. What is checked here is the handful of capabilities the documentation promises |
| The PDF viewer's chrome | The preview asks the viewer to hide its toolbar; Chrome honours it, Firefox does not. Chasing a frame nobody controls is not worth a test that can only report somebody else's choice |

---

## 8. Entering and leaving a release candidate

**Entry** — a candidate exists when, on `main`:

- every blocking gate above is green;
- the `[Unreleased]` section of the changelog has been closed into a version
  section, and `tests/test_version.py` agrees the version and the changelog
  match;
- the manual checks in [MANUAL-CHECKS.md](MANUAL-CHECKS.md) have been run
  against a build of that commit, with the dates filled in.

**Exit** — a candidate becomes a release when:

- the tagged image has been pulled and run **on a machine with no clone of this
  repository**, following the README's Quick start exactly as written;
- the demo role has been opened on a public URL and poked at, because that is
  the configuration strangers will meet first;
- a backup taken from the previous release has been restored into a scratch
  database and a **pinned version rendered from it**, page count and text
  compared. A dump nobody has restored is a belief, not a backup — and this is
  also the end-to-end check of promise 1.

A candidate that fails any exit criterion goes back to `main`; the tag is never
moved.
