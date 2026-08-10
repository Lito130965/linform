# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A field list built from the test data**, replacing the panel that could only
  show placeholders the template already used — which meant a fresh template
  offered nothing and the first field of every document had to be typed in Code
  mode. Nested objects become paths, and an array's fields say which repeat
  would put them in reach; inside one, they are offered under that loop's own
  variable name (`items[].price` → `row.price`).
- **Typing `{{` in the canvas** offers the same list at the caret, filters as
  the name is typed, and writes the field on Enter.
- **Test data generated from the template.** Two buttons: build a fresh sample
  payload from every value the template names — loops become arrays of objects
  carrying the fields their bodies use — or keep what is there and fill in only
  what the template has since grown. Sample values are guessed from the field's
  name, so the preview shows a form rather than a page of the word "Sample".
- **A block can be put inside another block, and taken back out.** A drag says
  which it means by where it hovers: near an edge is beside, the middle of
  something that holds blocks is inside it.
- **The blocks are a palette of tiles** instead of a dropdown, in the drawer
  below the canvas, and they work in Code mode too.

- **A structure panel beside the canvas.** Every part of the document as a list,
  from the same notion of "selectable" a click uses — so the cell, its row, the
  table and the block around it can each be taken directly instead of hoping a
  click lands on the right one. Hovering a row outlines it on the page, the
  selection is mirrored both ways, and the eye takes a block out of sight
  without taking it out of the template (`visibility`, so nothing moves and the
  page breaks stay honest). It reserves a column, so below 1600px it starts
  closed and the toolbar toggle brings it back.

- **A demo role.** `LINFORM_ROLE=demo` serves the examples gallery and the
  editor behind it and nothing else: no stored templates, no accounts, no
  sign-in. `GET /api/capabilities` tells the interface what an instance offers,
  so the shell draws one tab rather than a login screen in front of a service
  nobody can sign into — the mapping from role to interface stays where the
  routers are chosen.
- **Scratch asset storage for the demo role.** A public instance accepts
  uploads — dropping in a logo is what makes the editor feel like yours — into a
  store of its own: keyed to an opaque cookie, visible only to the browser that
  sent them, deleted within the hour, and capped per visitor. A separate table
  from `assets`, so the permanent store keeps its guarantee (content-addressed,
  deduplicated, outliving the versions that reference it) while this one can be
  emptied at any moment with nothing lost.
- **A link to the source** in the navigation rail.
- **`$PORT` is honoured** by the container entrypoint, for serverless hosts that
  assign one.

### Changed

- **The structure list and the field list share one column**, as two tabs beside
  the canvas: they answer the same question about the document and read as one
  thing said twice when drawn in opposite corners.
- **Inline content is inserted where the caret is** — a field, an image, a QR
  code, a run of character cells. Everything used to land after the selected
  block, under panels that said "insert at cursor", so a value could never be
  named inside a line of text. Block content still lands beside the selected
  block, since a table dropped into a paragraph is not what anyone meant.

### Fixed

- **Bold, italic or underline across a placeholder duplicated it.** A chip is
  one thing — the attribute carries the expression, the visible text is only a
  label — but a selection ending halfway into one split the element, and export
  reads the attribute of each half. Nothing on screen showed it; the second
  `{{ … }}` appeared in the saved template. Selections now take a chip whole or
  not at all.
- **Anything positioned against the page printed one margin away from where the
  canvas drew it.** A logo dragged into the top-right corner came out 18mm
  further right and 26mm further down, half of it over the edge of the paper.
  In print the `<body>` is the page area — the margins are spent on the page box
  — so an absolute offset, a percentage width and a `right: 0` all resolve
  there; the canvas drew that inset as padding on the body, which left the
  origin for all of them at the corner of the sheet. Content in flow looked
  right either way, so the difference existed only on export.

## [0.2.0] — 2026-08-09

### Added

- **User accounts and roles.** A superuser bootstrapped from the environment
  creates editor users and revocable render API keys. Static tokens keep
  working for machine-to-machine use.
- **Login throttling.** Per-account lockout, checked before the password hash
  is computed — which makes it a CPU-exhaustion guard as well as a brute-force
  one — plus a per-address rate limit.
- **Security headers.** Content-Security-Policy, `nosniff`, referrer and frame
  policy. Uploaded files outside a safe MIME allowlist are served as
  attachments.
- **Input sanitisation** for markup entering the editor canvas.
- **Readiness endpoint.** `/health` is liveness only; `/ready` reports the
  database and the render pool and answers `503` when either is gone.
- **Observability.** `X-Request-ID` correlation, optional JSON logs, and
  Prometheus metrics at `/metrics` (off by default, behind the render role).
- **Golden PDF tests** over all six examples: page count, page-by-page text,
  geometry, and that QR/barcodes reach the page.
- **Browser tests** (Playwright) against the built image, including the visual
  round trip, the publish/rollback cycle and the login gate.
- **Concurrency tests against PostgreSQL** for the version-numbering and
  single-published-version invariants.
- **Accessibility**: accessible names throughout, an accessible modal shell
  (focus trap, Escape, focus restoration), visible focus, `prefers-reduced-motion`,
  and axe-core checks in CI.
- **Light theme**, following the system preference with an override in Settings.
- **Template directories** — flat buckets, with a template journal and a tabbed
  navigation rail.
- **Examples gallery**: six showcase templates, openable in a scratch editor
  that never saves.
- **Page-numbers preset** built on CSS counters.
- **Deployment roles.** `LINFORM_ROLE=render` builds a process with no
  management API and no editor bundle — the routes are absent rather than
  refused; `LINFORM_ROLE=editor` keeps the UI and drops the consumer render
  endpoints. `docker-compose.roles.yml` runs the split topology, and
  `scripts/verify-scale.sh` checks a multi-replica deployment in CI.
- **One meaning per modifier key in the canvas.** `Shift` keeps the proportion
  when resizing and the axis when moving, `Alt` suspends snapping, `Ctrl`/`Cmd`
  drags a copy instead of the element. Listed in the canvas alongside the
  keyboard shortcuts, from the same source the behaviour reads.
- **The canvas says what a page break will do to what it crosses** — the element
  is outlined and labelled *moves to the next page whole* (a table row, an
  image, `break-inside: avoid`) or *splits across the break* (ordinary text).
  It names the innermost unit the break is about, so a table crossing a page
  points at the row rather than the table.
- **One gesture is one undo step in the canvas**, and `Esc` cancels a drag in
  progress — the document returns to where the gesture found it, without
  releasing the mouse and without leaving a step behind. Applies to resizing,
  moving, and scrubbing a value in the spacing boxes.
- **The canvas selection is visible before it happens.** Hovering outlines what
  a click would select and names its kind; the selected element's path
  (`Table › Row › Cell › Block`) is in the properties bar with every level
  clickable; and `Esc` steps out one level at a time, clearing only once there
  is nowhere further to go.
- **Snapping, guides and a live millimetre readout in the canvas.** A dragged
  edge falls onto page margins, page breaks and the edges and centres of other
  elements, with the millimetre grid as a fallback; an explicit alignment always
  beats a round number. The line it landed on is drawn while it holds it, the
  figure beside the cursor reads in millimetres and says what stopped it, and
  `Alt` switches snapping off for the length of a gesture.
- **Size and spacing in the canvas.** The selected element's box — margins,
  padding, width, height — is edited as a box, in millimetres by default, with
  values set on the element shown apart from values the stylesheet decided.
  Clearing a box returns the property to the stylesheet instead of writing a
  zero, and changes apply on Enter rather than per keystroke. Values can be
  dragged sideways or stepped with the arrow keys. A millimetre grid can be
  pinned from the toolbar and appears on its own whenever geometry is being
  changed — while dragging, and from the moment a spacing box has the focus.
- **The visual canvas can be driven from the keyboard.** `Alt`+arrows select
  structure through the document tree, `Alt`+`Enter` opens the selected element
  (its Jinja expression, or its text), `Alt`+`Delete` removes it, `Esc` clears.
  Plain typing is untouched. The shortcuts are listed in the canvas itself, and
  the selection is announced to assistive technology.
- **Template archiving.** `DELETE /api/templates/{code}` stops rendering by code
  with `410` while pinned versions keep working — that promise was made when the
  version was published — and `restore` brings it back.
- **Pagination** on the list endpoints, with the total in `X-Total-Count`.
- **A committed OpenAPI snapshot** (`docs/openapi.json`), checked in CI, so an
  API change arrives in a reviewable diff rather than in a client's incident.
- **Pinned Python dependencies** (`constraints.txt`), applied in CI, in the
  image and in the documented local install.
- **Caching in the render path.** Assets and compiled templates are keyed by
  content and cached indefinitely; what a template code currently resolves to
  carries a short TTL and is dropped immediately by the replica that publishes
  or rolls back. A warm render touches no database at all.
- Documentation: [DECISIONS.md](docs/DECISIONS.md),
  [MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md), [SECURITY.md](SECURITY.md),
  [CONTRIBUTING.md](CONTRIBUTING.md), `.env.example`, and a measured
  Performance section.

### Changed

- **A draft is not a version.** Version numbers are minted at publication
  instead of on save. A draft has no number, can be edited and deleted, and is
  rejected by every render path; a template may hold several. The API separates
  `/drafts` from `/versions` accordingly — rebuilt rather than patched, since
  there are no consumers to keep compatible yet.

- **Render backpressure**: past the in-flight ceiling the service answers `429`
  with `Retry-After` instead of queueing without bound.
- **Container hardening**: runs as a non-root user, has a `HEALTHCHECK`, and
  pins its base images by digest.
- **Version authorship** is taken from the authenticated principal rather than
  the request body.
- The visual canvas draws page boundaries where pages actually end, accounting
  for the margins every page spends.

### Fixed

- **A block inserted with a table cell selected landed beside the table.**
  "After this cell" is a place nothing block-level can be, so the parser lifted
  it out — and dragging offered only before/after, never into. A cell is now a
  thing to put something *in*, for both the insert and the drag paths, and a
  block aimed at a row lands outside the table where it can legally go.
- **The canvas grew a page on every edit.** Height was measured from the
  iframe's viewport, which is the height that measurement itself decides, so
  each pass fed the sheet's bottom margin back in as content and the page count
  climbed without a page break anywhere in the document.
- **Resize handles were drawn above the edge they resize** on any template with
  a running header: they are positioned in the canvas document's coordinates but
  sat in a box that the margin-box strips had already pushed down.
- **A DoS advisory in shipped frontend code.** `underscore`, pulled in by the
  `.docx` importer, was locked at 1.13.1 — unbounded recursion in `_.flatten`
  and `_.isEqual` on hostile input, reachable by uploading a crafted document.
  Bumped to 1.13.8. CI now audits shipped dependencies as a blocking step and
  build tooling as an advisory one, since only the first is in the image.

- **Concurrent migrations were unserialised.** Every container runs `alembic
  upgrade head` on startup, so replicas starting together read the same current
  revision and raced to apply the next one. Migrations now take a PostgreSQL
  advisory lock, and CI runs four upgrades at once to prove it.
- An unpublished draft was renderable through the version-pinning endpoint by
  guessing its number — `404` by code, `200` by pin.
- The asset cache was bounded by entry count rather than by bytes: sixty-four
  large assets, base64-encoded, is hundreds of megabytes per replica.
- Both in-process caches evicted the oldest entry rather than the least recently
  used, so one-off traffic could push out the template every render needs.
- The compiled-version cache was keyed by a database id alone, so a process
  outliving its database (a restored backup, a repointed instance) could render
  a different template under the same id.
- The version-numbering retry re-read an ORM object across a rollback and died
  with `MissingGreenlet` on exactly the race it existed to survive.
- An already-broken render pool escaped as a `500` and never marked the
  instance unready.
- A sandbox `OverflowError` (a runaway `range()`) surfaced as a `500` rather
  than a `422` naming the template's problem.
- Visual mode refused templates carrying `<style>` in the body — which is where
  the header/footer blocks and the page-numbers preset put their `@page` rules.

## [0.1.0] — 2026-07-23

First working version.

### Added

- Render core: `POST /api/render` (HTML + JSON in, PDF out) on WeasyPrint,
  with Jinja2 sandboxed and a hard timeout.
- Stored templates with immutable versions, publish and rollback, and rendering
  by stable code or a pinned version.
- Web editor: code mode with a live paged preview, plus a purpose-built visual
  mode whose round trip is byte-exact through a Jinja bridge.
- Content-addressed assets (`asset://<sha256>`).
- QR and barcode filters rendering scannable vector symbols.
- Optional AI assistant (bring your own key, off by default).
- Two-tier token auth, `.docx` import, six worked examples.

[Unreleased]: https://github.com/Lito130965/linform/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Lito130965/linform/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Lito130965/linform/releases/tag/v0.1.0
