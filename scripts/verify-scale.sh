#!/bin/sh
# Verify a split, multi-replica deployment actually behaves the way the README
# says it does. Not a load test — a correctness check on the claims that only
# become testable once there is more than one process:
#
#   1. several containers migrate one database at the same time without
#      stepping on each other;
#   2. a render node has no management API;
#   3. an editor node is not part of the render path for consuming applications;
#   4. every replica serves the same current version;
#   5. publishing and rolling back on the editor reach every replica, and the
#      lag is bounded by LINFORM_TEMPLATE_CACHE_TTL_SECONDS.
#
#   scripts/verify-scale.sh [replicas]     # default 3
#
# Runs with authentication off, which is the default with no tokens set: this
# checks topology, and the auth tests cover auth.
set -eu

REPLICAS=${1:-3}
COMPOSE="docker compose -f docker-compose.roles.yml"
CODE="scale-check-$(date +%s)"
# TTL plus generous slack. If convergence takes longer than this, something is
# wrong with invalidation, not with the machine being busy.
DEADLINE=15

cd "$(dirname "$0")/.."

cleanup() {
  echo "==> tearing down"
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "!!! $1" >&2
  $COMPOSE logs --tail 40 >&2 || true
  exit 1
}

post() { # url, path, [body] -> http status
  body=${3-}
  [ -n "$body" ] || body='{}'
  curl -s -o /dev/null -w '%{http_code}' -X POST "$1$2" \
    -H 'content-type: application/json' -d "$body"
}

version_served() { # url -> the version a render node answered with
  curl -s -o /dev/null -D - -X POST "$1/api/render/$CODE" \
    -H 'content-type: application/json' -d '{"who":"x"}' \
    | tr -d '\r' | sed -n 's/^[Xx]-[Ll]inform-[Vv]ersion: //p'
}

wait_for_health() { # url, label
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -sf "$1/health" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  fail "$2 ($1) never became healthy"
}

echo "==> starting one editor and $REPLICAS render replicas against one database"
# All of them run `alembic upgrade head` at once. That is the first thing being
# checked here, and it fails loudly: a container that loses the race exits.
$COMPOSE up -d --scale "render=$REPLICAS" >/dev/null 2>&1 \
  || fail "compose could not bring the deployment up"

EDITOR="http://localhost:${LINFORM_PORT:-8100}"
wait_for_health "$EDITOR" "editor"

RENDER_URLS=""
i=1
while [ "$i" -le "$REPLICAS" ]; do
  hostport=$($COMPOSE port --index "$i" render 8000) || fail "replica $i has no published port"
  url="http://localhost:${hostport##*:}"
  wait_for_health "$url" "render replica $i"
  RENDER_URLS="$RENDER_URLS $url"
  i=$((i + 1))
done
echo "    up:$RENDER_URLS"
# Every container ran `alembic upgrade head` against the same empty database a
# moment ago. A container that lost that race exits, and the health wait above
# is where that shows up — by name, with its logs.
echo "==> concurrent migrations: all $((REPLICAS + 1)) containers came up"

echo "==> a render node carries no management API"
for url in $RENDER_URLS; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url/api/templates")
  [ "$status" = "404" ] || fail "$url answered $status for GET /api/templates"
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url/")
  [ "$status" = "404" ] || fail "$url is serving the editor bundle ($status)"
done

echo "==> publishing v1 on the editor"
post "$EDITOR" "/api/templates" "{\"code\":\"$CODE\",\"name\":\"scale check\"}" >/dev/null
draft=$(curl -s -X POST "$EDITOR/api/templates/$CODE/drafts" \
  -H 'content-type: application/json' \
  -d '{"html_content":"<p>v1 {{ who }}</p>","comment":"first"}' \
  | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
[ -n "$draft" ] || fail "the editor did not return a draft id"
status=$(post "$EDITOR" "/api/templates/$CODE/drafts/$draft/publish")
[ "$status" = "200" ] || fail "publish answered $status"

echo "==> an editor node is not part of the render path"
status=$(post "$EDITOR" "/api/render/$CODE" '{"who":"x"}')
[ "$status" = "404" ] || fail "the editor answered $status for a consumer render"

echo "==> every replica serves v1"
for url in $RENDER_URLS; do
  served=$(version_served "$url")
  [ "$served" = "1" ] || fail "$url served version '${served:-none}', expected 1"
done

converge() { # expected version -> seconds taken
  waited=0
  while [ "$waited" -le "$DEADLINE" ]; do
    all_agree=1
    for url in $RENDER_URLS; do
      [ "$(version_served "$url")" = "$1" ] || all_agree=0
    done
    [ "$all_agree" = "1" ] && { echo "$waited"; return 0; }
    sleep 1
    waited=$((waited + 1))
  done
  fail "replicas never converged on version $1 within ${DEADLINE}s"
}

echo "==> publishing v2 on the editor, waiting for the replicas to follow"
draft=$(curl -s -X POST "$EDITOR/api/templates/$CODE/drafts" \
  -H 'content-type: application/json' \
  -d '{"html_content":"<p>v2 {{ who }}</p>","comment":"second"}' \
  | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
post "$EDITOR" "/api/templates/$CODE/drafts/$draft/publish" >/dev/null
echo "    all $REPLICAS replicas serving v2 after $(converge 2)s"

echo "==> rolling back to v1 — the operation the cache must not delay"
post "$EDITOR" "/api/templates/$CODE/versions/1/current" >/dev/null
echo "    all $REPLICAS replicas back on v1 after $(converge 1)s"

echo "==> a pinned version still renders on every replica"
for url in $RENDER_URLS; do
  status=$(post "$url" "/api/render/$CODE/versions/2" '{"who":"x"}')
  [ "$status" = "200" ] || fail "$url answered $status for a pinned version"
done

echo
echo "OK: $REPLICAS render replicas and one editor, one database, all claims held."
