# Operations

Running Linform for other people: what it tells you while it runs, what it
costs, how to split it across machines, and how to get it back.

Configuration variables are in [CONFIGURATION.md](CONFIGURATION.md); the threat
model is in [SECURITY.md](../SECURITY.md).

## Observability

Every response carries an `X-Request-ID` — the one the caller sent, or a fresh
one — and every log line written while serving that request carries the same id,
so a report of "it was slow at 14:00" can be traced to the request that was
slow. With `LINFORM_JSON_LOGS=true` each line is one JSON object: `ts`, `level`,
`request_id`, `method`, `path`, `status`, `duration_ms`, and `principal` — who
made the call, **by name, never the credential they presented**.

The request body is never logged, by any path. Payloads are the consuming
application's business data; this service renders them and forgets them, and a
log file is the easiest place to break that promise by accident.

`LINFORM_METRICS_ENABLED=true` serves Prometheus metrics at `/metrics`, behind
the render role (a 404 when disabled — an endpoint that is off should not
advertise itself). It is off by default because the series are labelled by
template code, so scraping reveals which forms a deployment runs.

| Metric | Type | Notes |
|---|---|---|
| `linform_render_duration_seconds` | histogram | labels `template_code`, `outcome` (`ok`/`rejected`/`timeout`/`error`) |
| `linform_render_inflight` | gauge | renders in flight on this instance |
| `linform_render_concurrency_limit` | gauge | the ceiling, so the gauge above reads as utilisation |
| `linform_render_rejected_total` | counter | shed at the ceiling — the 429s |
| `linform_render_timeout_total` | counter | abandoned at the hard timeout — the 504s |
| `linform_login_failed_total` | counter | label `reason`; the reason is a metric, never part of the 401 |
| `linform_cache_hits_total` / `_misses_total` | counter | label `cache`; a TTL expiry counts as a miss, so the ratio is honest |
| `linform_cache_bytes` / `_entries` | gauge | label `cache`; what the caches are holding right now |
| `linform_cache_evictions_total` | counter | label `cache`; climbing steadily means the budget is smaller than the working set |

Ad-hoc renders share a single `<ad-hoc>` label instead of minting a series per
request.

## Performance

Absolute numbers from someone else's hardware are not a specification, so read
this as a **method and a shape**, and measure your own box with the script that
produced it:

```bash
python scripts/loadtest.py http://localhost:8100 <template-code> --data @payload.json
```

What holds regardless of hardware, because it follows from the design:

- **Rendering is CPU-bound and single-threaded per document.** Throughput is
  roughly `render workers / cost of one render`; latency tracks single-core
  speed, throughput tracks core count.
- **Throughput saturates at the worker count.** More concurrent clients past
  that point add no PDFs per second, only queueing — visible as latency.
- **Past the in-flight ceiling the service refuses immediately** with `429` and
  `Retry-After` rather than building a queue.

The runs below are one container on an AMD Ryzen 5 4600H (6 cores / 12 threads),
rendering the `invoice` example — two A4 pages with a 25-row table. **One render
costs about 235 ms** and that figure does not move with the worker count: it is
one document on one core, and it is the number to re-measure on your hardware
and your templates, both of which change it.

What the worker count buys, at the point where each setting stops gaining:

| Render workers | Sustained PDF/s | at clients | p50 | p95 |
|---:|---:|---:|---:|---:|
| 2 *(default)* | 7.9 | 4 | 527 ms | 547 ms |
| 4 | 14.7 | 8 | 529 ms | 627 ms |
| 6 | 18.1 | 8 | 401 ms | 528 ms |

Doubling the workers from 2 to 4 gives **1.87×** — 93% of linear, which is what
"throughput tracks core count" means in practice. From 4 to 6 it is 1.23× rather
than 1.5×: those six workers now share six physical cores with the application
process and the database. **The default of 2 is a floor, not a ceiling** — it
exists so the service behaves on a small box, and one environment variable moves
it.

Past the ceiling, the same runs at 16 concurrent clients:

| Render workers | Served | Refused | Median time to refuse |
|---:|---:|---:|---:|
| 2 | 4 | 90% | 24 ms |
| 4 | 8 | 80% | 19 ms |
| 6 | 12 | 70% | 10 ms |

The number served is exactly the in-flight ceiling — workers × 2 — in all three
runs, and everything over it comes back in milliseconds with `429` and
`Retry-After` rather than joining a queue. That is the backpressure design
end to end, and it is the row that will look the same on any machine.

Throughput and refusals are reported separately on purpose. Once the ceiling
starts shedding load the run is over in half a second, so "documents ÷ wall
clock" stops describing a sustained rate — it describes a handful of renders
divided by an interval too short to mean anything. The load script marks those
rows with a `*` for the same reason.

Scaling levers, in the order worth reaching for: raise
`LINFORM_RENDER_MAX_WORKERS` towards the core count, raise
`LINFORM_RENDER_MAX_CONCURRENCY` only if your callers genuinely tolerate
queueing, and run more replicas — the database invariants are built for that
(see the concurrency tests). A client rendering in bulk should honour
`Retry-After`; retry and batching are its job, by design.

### Caching

Caching does not make a render faster — the PDF engine is the cost, and it is
unchanged. What it removes is the database work around the render, which is what
stops the shared database becoming the ceiling once replicas multiply.

Statements issued per render, counted by the suite rather than estimated:

| | first render | every render after |
|---|---:|---:|
| template with no assets | 2 | **0** |
| template with one asset | 3 | **0** |

A warm render touches no database at all, so it does not take a connection from
the pool either. The arithmetic that follows: twenty replicas serving 1000
renders a second used to put ~3000 queries a second on one database, a third of
them pulling the same logo blob out again. Now the steady-state cost is one
lookup per template per replica per TTL — ten a second at the default — and it
no longer grows with traffic.

What is cached, and for how long, follows from how the key is formed
(`app/services/cache.py`):

- **Assets and compiled templates never expire.** They are addressed by the
  hash of their content, so a hit cannot be wrong.
- **"Which version does this code serve"** is a pointer, and pointers move, so
  it expires after `LINFORM_TEMPLATE_CACHE_TTL_SECONDS` (default 2). The process
  that publishes or rolls back drops its own entry immediately, so with one
  process — which is what the shipped container runs — the cache is never stale
  at all. Add processes, whether replicas or `uvicorn --workers`, and the TTL
  becomes the bound on how long a rollback takes to reach all of them.

Set `LINFORM_TEMPLATE_CACHE_TTL_SECONDS=0` to switch it off and resolve every
render against the database. `linform_cache_hits_total` and
`linform_cache_misses_total` report whether any of this is earning its memory.

## Deployment roles

One container does everything, and that is the right shape until traffic or a
security review says otherwise. `LINFORM_ROLE` splits it in two: **editor**
nodes for people, **render** nodes for consuming applications. Which routes
exist is decided at startup — a render node does not *refuse* the management
API, it does not have one, so there is nothing to misconfigure and nothing for a
stolen credential to reach.

| | `all` (default) | `editor` | `render` | `demo` |
|---|:---:|:---:|:---:|:---:|
| `POST /api/render` (markup you send) | ✓ | ✓ | ✓ | ✓ |
| `POST /api/render/{code}` and version pinning | ✓ | — | ✓ | — |
| Templates, directories, assistant | ✓ | ✓ | — | — |
| Asset uploads | ✓ | ✓ | — | scratch |
| Accounts and sign-in | ✓ | ✓ | — | — |
| Examples gallery | ✓ | ✓ | — | ✓ |
| Editor UI | ✓ | ✓ | — | gallery only |
| `/health`, `/ready`, `/metrics`, `/api/capabilities` | ✓ | ✓ | ✓ | ✓ |

The editor loses the consumer render endpoints deliberately: pointing a
consuming application at the editor node works by accident, and quietly makes
the one node nobody scales part of the render path.

**`demo` is the public shop window** — the examples gallery and the editor
behind it, rendering whatever markup it is handed, with nothing to sign in as
and nothing kept. It is safe to leave on the open internet because
nothing on it survives.

Uploads are the exception that proves the rule: a demo does accept them —
dropping in a logo is what makes the editor feel like yours — but they go to a
store of their own, keyed to an opaque cookie, **visible only to the browser
that sent them and deleted within the hour**, with a ceiling on how much one
visitor may hold. Somebody will eventually upload something unlawful or
malicious, and a public instance must be neither the place that serves it to
others nor the place it sits. The shell asks `/api/capabilities` what
this instance offers and draws only that, so a demo shows one tab and no
sign-in card rather than a login screen in front of a service with no accounts.

```bash
docker run -p 8100:8000 -e LINFORM_ROLE=demo ghcr.io/lito130965/linform:latest
```

That is exactly what runs at [linform.linitapp.com](https://linform.linitapp.com/).

### A demo that survives being noticed

The defaults are sized for a laptop: two render workers, and an in-flight
ceiling of four. That is correct behaviour under load — the fifth simultaneous
visitor gets a `429` rather than a queue — and it is the wrong first impression
entirely when a link is posted somewhere and two hundred people arrive in an
hour. Four things, in the order they matter:

```bash
LINFORM_RENDER_MAX_WORKERS=<cores>   # rendering is CPU-bound and single-threaded
LINFORM_RENDER_MAX_CONCURRENCY=<2-3x workers>
LINFORM_METRICS_ENABLED=true         # watch it on the day, not afterwards
```

**Measure it before strangers do.** `scripts/loadtest.py` against the demo's own
URL, not against localhost, answers the only question that matters — how many
simultaneous visitors it serves before it starts shedding — while there is still
time to change the answer.

**Put a rate limiter in front of it.** Nothing in this service protects a public
instance from one script; that belongs in the reverse proxy, where it is a
two-line job:

```nginx
limit_req_zone $binary_remote_addr zone=linform:10m rate=30r/m;

location / {
    limit_req zone=linform burst=10 nodelay;
    proxy_pass http://linform:8000;
}
```

**And check the disk.** A demo accepts uploads; they are deleted within the hour
and capped per visitor, but that is a claim worth verifying on your own instance
before finding out it was wrong.

On a serverless host that assigns a port — Cloud Run and its kind — the
entrypoint follows `$PORT`, so nothing else needs configuring. Set
`LINFORM_RENDER_MAX_WORKERS=1` and cap the instances: rendering is the only
expensive thing on it, and the ceiling already sheds what it cannot take.

```bash
docker compose -f docker-compose.roles.yml up -d --build --scale render=3
scripts/verify-scale.sh 3
```

That script is the multi-replica check, and it runs in CI: several containers
migrating one database at the same time (serialised by a PostgreSQL advisory
lock, since every container runs `alembic upgrade head` on startup), a render
node with no management API, every replica serving the same current version, and
publish and rollback on the editor reaching all of them within the cache TTL.


## Backup and restore

**One database holds everything** — templates, every version, uploaded assets,
users and API keys. There is no second store and no file volume to coordinate,
which is the whole backup story:

```bash
# Back up (compose deployment)
docker compose exec -T db pg_dump -U linform linform | gzip > linform-$(date +%F).sql.gz

# Restore into an empty database
gunzip -c linform-2026-07-29.sql.gz | docker compose exec -T db psql -U linform linform
```

Assets live in the database as rows, so a dump captures them; on the other hand
a deployment with large page backgrounds will produce large dumps, and that is
the trade behind that decision.

**Verify the restore, not just the backup.** A dump nobody has restored is a
belief, not a backup. The check that matters here is end to end, because it
exercises the promise the product makes:

1. Restore the dump into a scratch database.
2. Point an instance at it (`LINFORM_DATABASE_URL`).
3. Render a template **by a pinned version** and compare the PDF's page count
   and text against the original — `tests/golden_support.py` has the helpers.

If a pinned version renders identically, versions, assets and the engine all
came back. If it does not, you have found the problem while it is still cheap.

Nothing else needs backing up: the container is rebuilt from the image, and the
configuration is your `.env`. What is *not* recoverable is business data —
payloads are rendered and forgotten by design, so store the payload or the
resulting PDF on your side, with the version number beside it.

