# API

Every endpoint the service exposes. The machine-readable version is
[openapi.json](openapi.json), and a running instance serves it at `/docs`.

Which of these exist in a given process depends on `LINFORM_ROLE` — a render
node does not carry the management API at all (see
[Deployment roles](OPERATIONS.md#deployment-roles)).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/render/{code}` | **Main endpoint**: render the published version |
| POST | `/api/render/{code}/versions/{v}` | Pin an exact version (reproducible forever) |
| POST | `/api/render` | Ad-hoc render: raw HTML + data (no storage) |
| GET | `/api/templates` | List templates |
| POST | `/api/templates` | Create a template |
| GET | `/api/templates/{code}` | Template + version history |
| POST | `/api/templates/{code}/drafts` | Start a working copy (no version number) |
| PUT | `/api/templates/{code}/drafts/{id}` | Edit a draft in place |
| DELETE | `/api/templates/{code}/drafts/{id}` | Discard a draft |
| POST | `/api/templates/{code}/drafts/{id}/publish` | Publish it: numbered, frozen, live |
| POST | `/api/templates/{code}/versions/{v}/current` | Point consumers at a version (the rollback) |
| GET | `/api/templates/{code}/versions/{v}` | Full version content |
| DELETE | `/api/templates/{code}` | Archive (pinned versions keep rendering) |
| GET | `/api/templates/{code}/placeholders` | Fields the template expects — the integration contract |
| PUT | `/api/templates/{code}/directory` | File a template under a directory (or `null` for General) |
| GET / POST | `/api/directories` | List / create organizational buckets (editor-side only) |
| POST | `/api/assets` | Upload an asset (logo, background); returns an immutable `asset://<sha256>` URL |
| GET | `/api/assets` | List uploaded assets |
| GET | `/api/assets/{sha256}` | Raw asset bytes |
| GET | `/api/examples` | Built-in showcase examples (drives the editor gallery) |
| GET | `/health` | Liveness — process is up; touches nothing external |
| GET | `/ready` | Readiness — database and render pool reachable, `503` when not |
| POST | `/api/auth/login` | Password login → opaque session token |
| GET | `/api/auth/me` | Who the current credential is (drives the UI) |
| POST | `/api/admin/users` | **Superuser**: create an editor/superuser account |
| POST | `/api/admin/keys` | **Superuser**: mint a render API key (shown once) |

## Accounts and roles

Set `LINFORM_SUPERUSER` and `LINFORM_SUPERUSER_PASSWORD` to enable accounts. The superuser signs in and creates **editor** users (design
templates, preview, render — but not manage accounts) and **render API keys**
for consuming applications (render only, revocable one at a time). The static
`LINFORM_RENDER_TOKEN` / `LINFORM_ADMIN_TOKEN` still work unchanged for
machine-to-machine use; with nothing configured at all, auth stays off for local
dev.

## Versions, drafts and assets

**A draft is not a version.** A draft is a working copy: no number, editable,
deletable, and unreachable by any consuming application — not by template code,
and not by pinning. A template can hold several at once.

A version exists only once something is **published**. It is numbered then,
which means a version number always refers to something a consumer could
legitimately have rendered — there are no gaps for work that never shipped.
Published versions are immutable, and exactly one is *current* (enforced by the
database, so it holds with any number of replicas). Pointing that at an older
version is the rollback; it mints no new number.

A consumer either renders "whatever is current" or pins an explicit version.
Deciding *which* documents pin *which* version is the consumer's business rule,
kept out of this service on purpose. Archiving a template stops rendering by
code (`410`) while pinned versions keep working, because that promise was made
when the version was published.

Assets follow the same philosophy: they are content-addressed
(`asset://<sha256>`) and immutable — replacing a logo means uploading a new
file and referencing it from a new template version, so old versions keep
rendering pixel-for-pixel what they were published with.
