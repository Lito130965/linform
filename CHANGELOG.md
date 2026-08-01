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
- Documentation: [DECISIONS.md](docs/DECISIONS.md),
  [MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md), [SECURITY.md](SECURITY.md),
  [CONTRIBUTING.md](CONTRIBUTING.md), `.env.example`, and a measured
  Performance section.

### Changed

- **Render backpressure**: past the in-flight ceiling the service answers `429`
  with `Retry-After` instead of queueing without bound.
- **Container hardening**: runs as a non-root user, has a `HEALTHCHECK`, and
  pins its base images by digest.
- **Version authorship** is taken from the authenticated principal rather than
  the request body.
- The visual canvas draws page boundaries where pages actually end, accounting
  for the margins every page spends.

### Fixed

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
