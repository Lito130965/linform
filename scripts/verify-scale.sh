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

# Every curl carries a timeout. Without one a connection that hangs rather than
# refuses turns a bounded 60-second wait into an unbounded one, and the failure
# shows up as a build that never finishes instead of an error anyone can read.
CURL="curl -s --connect-timeout 3 --max-time 30"

cleanup() {
  echo "==> tearing down"
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "!!! $1" >&2
  echo "--- containers" >&2
  $COMPOSE ps -a >&2 || true
  echo "--- logs" >&2
  $COMPOSE logs --tail 40 >&2 || true
  exit 1
}

post() { # url, path, [body] -> http status
  body=${3-}
  [ -n "$body" ] || body='{}'
  $CURL -o /dev/null -w '%{http_code}' -X POST "$1$2" \
    -H 'content-type: application/json' -d "$body"
}

version_served() { # url -> the version a render node answered with
  $CURL -o /dev/null -D - -X POST "$1/api/render/$CODE" \
    -H 'content-type: application/json' -d '{"who":"x"}' \
    | tr -d '\r' | sed -n 's/^[Xx]-[Ll]inform-[Vv]ersion: //p'
}

# sh has no local variables: everything a function assigns is global. So each of
# these uses a name of its own — sharing `i` with the caller's loop counter, as
# an earlier version of this script did, resets it on every call and the caller
# loops forever over its first item.
wait_for_health() { # url, label
  health_tries=0
  while [ "$health_tries" -lt 60 ]; do
    if $CURL --max-time 3 -f "$1/health" >/dev/null 2>&1; then
      echo "    $2 up after ${health_tries}s"
      return 0
    fi
    health_tries=$((health_tries + 1))
    sleep 1
  done
  fail "$2 ($1) never became healthy"
}

echo "==> starting one editor and $REPLICAS render replicas against one database"
# All of them run `alembic upgrade head` at once. That is the first thing being
# checked here, and it fails loudly: a container that loses the race exits.
$COMPOSE up -d --scale "render=$REPLICAS" >/dev/null \
  || fail "compose could not bring the deployment up"
$COMPOSE ps -a || true

EDITOR="http://localhost:${LINFORM_PORT:-8100}"
wait_for_health "$EDITOR" "editor"

RENDER_URLS=""
replica=1
while [ "$replica" -le "$REPLICAS" ]; do
  hostport=$($COMPOSE port --index "$replica" render 8000) \
    || fail "replica $replica has no published port"
  [ -n "$hostport" ] || fail "replica $replica reported no published port"
  replica_url="http://localhost:${hostport##*:}"
  wait_for_health "$replica_url" "render replica $replica"
  RENDER_URLS="$RENDER_URLS $replica_url"
  replica=$((replica + 1))
done
found=$(echo "$RENDER_URLS" | tr ' ' '\n' | grep -c 'http') || true
[ "$found" -eq "$REPLICAS" ] || fail "expected $REPLICAS replica URLs, collected $found:$RENDER_URLS"
echo "    up:$RENDER_URLS"
# Every container ran `alembic upgrade head` against the same empty database a
# moment ago. A container that lost that race exits, and the health wait above
# is where that shows up — by name, with its logs.
echo "==> concurrent migrations: all $((REPLICAS + 1)) containers came up"

new_draft() { # html -> draft id
  $CURL -X POST "$EDITOR/api/templates/$CODE/drafts" \
    -H 'content-type: application/json' \
    -d "{\"html_content\":\"$1\",\"comment\":\"scale check\"}" \
    | sed -n 's/.*"id":\([0-9]*\).*/\1/p'
}

# Sets CONVERGED_IN rather than printing it, because a function that reports
# through a command substitution runs in a SUBSHELL: fail() would exit that
# subshell, the caller would carry on with an empty string, and a deployment
# that never converged would leave the build green.
converge() { # expected version
  converge_waited=0
  while [ "$converge_waited" -le "$DEADLINE" ]; do
    converge_agreed=1
    for check_url in $RENDER_URLS; do
      [ "$(version_served "$check_url")" = "$1" ] || converge_agreed=0
    done
    if [ "$converge_agreed" = "1" ]; then
      CONVERGED_IN=$converge_waited
      return 0
    fi
    sleep 1
    converge_waited=$((converge_waited + 1))
  done
  fail "replicas never converged on version $1 within ${DEADLINE}s"
}

echo "==> a render node carries no management API"
for node_url in $RENDER_URLS; do
  status=$($CURL -o /dev/null -w '%{http_code}' "$node_url/api/templates")
  [ "$status" = "404" ] || fail "$node_url answered $status for GET /api/templates"
  status=$($CURL -o /dev/null -w '%{http_code}' "$node_url/")
  [ "$status" = "404" ] || fail "$node_url is serving the editor bundle ($status)"
done

echo "==> publishing v1 on the editor"
post "$EDITOR" "/api/templates" "{\"code\":\"$CODE\",\"name\":\"scale check\"}" >/dev/null
draft=$(new_draft '<p>v1 {{ who }}</p>')
[ -n "$draft" ] || fail "the editor did not return a draft id"
status=$(post "$EDITOR" "/api/templates/$CODE/drafts/$draft/publish")
[ "$status" = "200" ] || fail "publish answered $status"

echo "==> an editor node is not part of the render path"
status=$(post "$EDITOR" "/api/render/$CODE" '{"who":"x"}')
[ "$status" = "404" ] || fail "the editor answered $status for a consumer render"

echo "==> every replica serves v1"
for node_url in $RENDER_URLS; do
  served=$(version_served "$node_url")
  [ "$served" = "1" ] || fail "$node_url served version '${served:-none}', expected 1"
done

echo "==> publishing v2 on the editor, waiting for the replicas to follow"
draft=$(new_draft '<p>v2 {{ who }}</p>')
[ -n "$draft" ] || fail "the editor did not return a draft id for v2"
status=$(post "$EDITOR" "/api/templates/$CODE/drafts/$draft/publish")
[ "$status" = "200" ] || fail "publishing v2 answered $status"
converge 2
echo "    all $REPLICAS replicas serving v2 after ${CONVERGED_IN}s"

echo "==> rolling back to v1 — the operation the cache must not delay"
status=$(post "$EDITOR" "/api/templates/$CODE/versions/1/current")
[ "$status" = "200" ] || fail "rollback answered $status"
converge 1
echo "    all $REPLICAS replicas back on v1 after ${CONVERGED_IN}s"

echo "==> a pinned version still renders on every replica"
for node_url in $RENDER_URLS; do
  status=$(post "$node_url" "/api/render/$CODE/versions/2" '{"who":"x"}')
  [ "$status" = "200" ] || fail "$node_url answered $status for a pinned version"
done

echo
echo "OK: $REPLICAS render replicas and one editor, one database, all claims held."
