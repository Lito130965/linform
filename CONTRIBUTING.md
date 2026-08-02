# Contributing

## Running it locally

```bash
docker compose up --build          # everything, on http://localhost:8100
```

Without Docker, backend only:

```bash
pip install -e ".[dev]" -c constraints.txt
alembic upgrade head
uvicorn app.main:app --reload
```

`-c constraints.txt` pins the versions CI and the image use. Skip it and you get
today's PyPI instead, which is how you end up debugging a golden-PDF diff that
came from a WeasyPrint release rather than from your change. To bump a
dependency, edit the pin, run the suite and `python -m scripts.openapi_snapshot
--check`, and commit the results together.

WeasyPrint needs native libraries (Pango and friends). On Debian/Ubuntu:

```bash
sudo apt-get install -y libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
    fonts-dejavu-core fonts-liberation
```

They are not available on a bare Windows checkout, and that is fine — the tests
that need them skip, rather than failing the run.

Frontend:

```bash
cd frontend && npm ci && npm run dev
```

## Tests

| What | Command | Needs |
|---|---|---|
| Backend | `pytest -q` | — (render tests skip without WeasyPrint) |
| Concurrency invariants | `LINFORM_TEST_PG_URL=postgresql+asyncpg://... pytest tests/test_concurrency_pg.py` | PostgreSQL |
| Frontend units | `cd frontend && npm test` | node |
| Lint (accessibility) | `cd frontend && npm run lint` | node |
| Browser tests | `cd e2e && ./run.sh` | Docker |
| Migration reversibility | `alembic upgrade head && alembic downgrade base && alembic upgrade head` | — |

`e2e/run.sh` builds the image, starts two instances (one in dev mode, one with
accounts enabled) and drives a real Chromium against them. It does not need
Node on the host — without `E2E_IN_CONTAINER=1` it runs the browsers from the
official Playwright image. That image tag and `@playwright/test` in
`e2e/package.json` are pinned to the same version and **must move together**;
a mismatch fails with "Executable doesn't exist".

## Updating the golden PDFs

`tests/test_golden_pdfs.py` compares the rendered output of every example
against `tests/golden/<id>.txt`: exact page count, then page-by-page text.

When a change is *meant* to change the output:

```bash
python -m tests.regenerate_golden              # all examples
python -m tests.regenerate_golden invoice      # just one
```

Needs WeasyPrint, so run it in the image or on Linux.

**Commit regenerated goldens on their own, with the diff read in review.**
Folding a golden update into a feature commit is exactly how a layout
regression gets blessed without anyone looking at it. If the diff is larger
than the change you made, that is the test doing its job — find out why before
committing it.

## What the CI gates are

- backend tests, migrations up→down→up
- frontend tests, typecheck, production build, accessibility lint
- browser tests (Playwright + axe) against the built image
- dependency audit (advisory)

All of them except the audit are blocking. If the accessibility lint fails,
fix the markup rather than relaxing the rule — the one rule that *is* relaxed
(`control-has-associated-label`) has its reasoning written in
`frontend/eslint.config.js`, and it is not "it was noisy".

## House style

The code is commented for the next reader, and the comments explain **why**,
not what. A comment that restates the line above it is noise; a comment that
records why the obvious approach was rejected is the reason the file is
maintainable a year later. Several such decisions are collected in
[docs/DECISIONS.md](docs/DECISIONS.md); if you make one of that size, add it
there.

Two invariants deserve special care, because breaking either is easy and the
damage is quiet:

1. **The visual editor's round trip.** Opening a template in Visual and leaving
   must not rewrite markup. Guarded by `frontend/src/editor/spike.test.ts` and
   `e2e/tests/roundtrip.spec.ts`.
2. **Payloads are never logged or stored.** Guarded by a test in
   `tests/test_observability.py` that looks for a marker value in the log
   records.
