# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Lito130965/linform/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Lito130965/linform/releases/tag/v0.1.0
