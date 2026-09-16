# Configuration

Every environment variable the service reads. Nothing here is required to start
it: with no configuration at all it runs on SQLite with authentication off,
which is the right shape for a laptop and the wrong one for anything else.

Copy `.env.example` to `.env` and set an authentication section before exposing
it to anyone.

| Env variable | Default | Meaning |
|---|---|---|
| `LINFORM_ROLE` | `all` | `all`, `editor` or `render` — which half of the service this process serves (see Deployment roles) |
| `LINFORM_RENDER_TOKEN` | *(empty)* | Bearer token for render endpoints only — give this to consuming applications |
| `LINFORM_ADMIN_TOKEN` | *(empty)* | Bearer token for everything incl. template/asset management — the editor side |
| `LINFORM_API_TOKEN` | *(empty)* | Legacy single token, counts as both roles. No tokens at all = auth disabled (dev) |
| `LINFORM_SUPERUSER` | *(empty)* | Bootstrap admin username. Set with the password below to enable user accounts |
| `LINFORM_SUPERUSER_PASSWORD` | *(empty)* | Bootstrap admin password, re-synced from env on every start (env is the source of truth) |
| `LINFORM_SESSION_TTL_HOURS` | `168` | How long a browser login stays valid |
| `LINFORM_MAX_LOGIN_FAILURES` | `5` | Consecutive failures before an account is locked |
| `LINFORM_LOGIN_LOCKOUT_MINUTES` | `15` | How long that lock lasts |
| `LINFORM_LOGIN_RATE_PER_MINUTE` | `20` | Login attempts per client address per minute (0 disables) |
| `LINFORM_RENDER_TIMEOUT_SECONDS` | `30` | Hard render timeout |
| `LINFORM_RENDER_MAX_WORKERS` | `2` | Render worker processes |
| `LINFORM_RENDER_MAX_CONCURRENCY` | `0` (→ workers × 2) | In-flight ceiling; over it, renders get `429 Retry-After` |
| `LINFORM_PDF_VARIANT` | *(empty)* | Write a PDF standard rather than a plain PDF: `pdf/a-3b`, `pdf/ua-1`, … (see below) |
| `LINFORM_STRICT_PLACEHOLDERS` | `true` | Fail on missing placeholder values |
| `LINFORM_TEMPLATE_CACHE_TTL_SECONDS` | `2` | How long another replica may serve the previous current version after a rollback (0 = no caching) |
| `LINFORM_TEMPLATE_CACHE_MB` | `32` | Memory budget for resolved template versions |
| `LINFORM_ASSET_CACHE_MB` | `64` | Memory budget for assets inlined into renders; content-addressed, so never stale |
| `LINFORM_ALLOW_EXTERNAL_URLS` | `false` | Allow http(s) resources in templates |
| `LINFORM_ALLOWED_URL_HOSTS` | `[]` | Host allowlist when external URLs are on |
| `LINFORM_AI_API_KEY` | *(empty — assistant off)* | BYOK key for an OpenAI-compatible API; stays server-side |
| `LINFORM_AI_BASE_URL` | `https://api.openai.com/v1/` | Provider base URL (Gemini compat, OpenRouter, Ollama, …) |
| `LINFORM_AI_MODEL` | `gpt-4o-mini` | Model id |
| `LINFORM_AI_SEND_TEST_DATA` | `false` | Allow the assistant to see test data (may contain personal data) |
| `LINFORM_AI_TIMEOUT_SECONDS` | `60` | Give up on the AI provider after this long |
| `LINFORM_JSON_LOGS` | `false` | One JSON object per log line (for a collector); plain text otherwise |
| `LINFORM_LOG_LEVEL` | `INFO` | Root log level |
| `LINFORM_METRICS_ENABLED` | `false` | Serve Prometheus metrics at `/metrics` (behind the render role) |
| `LINFORM_DATABASE_URL` | local SQLite file | Database; compose sets PostgreSQL |
| `LINFORM_PORT` | `8100` | Host port (compose only) |
| `LINFORM_DB_PASSWORD` | `linform` | PostgreSQL password (compose only) |


**Tokens, accounts, or neither.** The static tokens above are for
machine-to-machine use and predate accounts; `LINFORM_SUPERUSER` enables
sign-in, editor users and revocable render keys, described in
[API.md](API.md#accounts-and-roles). The two coexist.

**Roles.** `LINFORM_ROLE` decides which half of the API this process serves —
see [Deployment roles](OPERATIONS.md#deployment-roles).

## PDF/A and PDF/UA

`LINFORM_PDF_VARIANT` asks the engine for a PDF standard instead of a plain PDF.
Empty — the default — is what every deployment has produced until now.

| Family | Names | What it is for |
|---|---|---|
| PDF/A | `pdf/a-1b`, `pdf/a-2b`, `pdf/a-3b`, `pdf/a-2u`, `pdf/a-3u`, `pdf/a-4u`, `pdf/a-1a`, `pdf/a-2a`, `pdf/a-3a`, `pdf/a-4e`, `pdf/a-4f` | Archival storage: everything needed to reproduce the page is inside the file |
| PDF/UA | `pdf/ua-1`, `pdf/ua-2` | A tagged document a screen reader can navigate |
| PDF/X | `pdf/x-1a`, `pdf/x-3`, `pdf/x-4`, `pdf/x-5g` | Handing artwork to a printer |

The names are not a list this service keeps: they are WeasyPrint's, checked
against the engine when a render asks for one, so an upgrade that adds or
removes a variant needs no change here. An unknown name is refused with the
real list in the message rather than silently ignored — which is the failure
that matters, since a document that quietly did not become PDF/A looks exactly
like one that did until an archive rejects it years later.

**The honest caveat.** PDF/A is mostly about embedded fonts, colour profiles
and self-containment, and the engine handles all of that by itself: set the
variant and a normal template comes out conforming. **PDF/UA does not work that
way.** A tagged document is only navigable if the template gives it something
to tag — headings as `<h1>`–`<h6>` rather than large paragraphs, tables with
`<th>`, alternative text on every image. The flag produces a *tagged* file; it
cannot produce a *meaningful* one from markup that carries no meaning. Treat it
as a requirement on whoever writes the form, with the flag as the last step.

What the automated tests check is that the document claims what it was asked to
claim. Whether it is *valid* is a question for a conformance checker —
[veraPDF](https://verapdf.org/) is the reference one, and validating against it
is [M-08](MANUAL-CHECKS.md) before a release.

**One instance, one variant, for now.** The setting is per deployment, so
changing it changes what an already-published version renders as — which sits
awkwardly beside "a version renders the same document forever". A variant
stored on the version itself is the right home for it and is on the list in the
README's What's next; until then, a deployment that needs two standards runs
two render nodes.
