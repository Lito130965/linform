#!/bin/sh
# Run the browser tests against a BUILT IMAGE.
#
# Two instances, because the two states cannot coexist in one process:
#   :8101  auth disabled  — dev mode, what most tests drive
#   :8102  accounts on    — the login/logout test
#   :8103  LINFORM_ROLE=demo — the public shop window, which has neither
#
# Both use the zero-configuration SQLite default: these tests are about the
# editor, and the concurrency invariants that need PostgreSQL are covered by
# tests/test_concurrency_pg.py instead.
#
#   ./run.sh              build the image, start, test, stop
#   ./run.sh --no-build   reuse the image already tagged linform:latest
set -eu

IMAGE=linform:latest
NO_AUTH=linform-e2e-noauth
WITH_AUTH=linform-e2e-auth
DEMO=linform-e2e-demo
E2E_SUPERUSER=e2e-admin
E2E_PASSWORD=e2e-password-1
# Must match @playwright/test in package.json exactly — the browsers live in
# this image, so a mismatch fails with "Executable doesn't exist".
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.0-jammy

cd "$(dirname "$0")"

cleanup() {
  docker rm -f "$NO_AUTH" "$WITH_AUTH" "$DEMO" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

if [ "${1:-}" = "--no-build" ]; then
  shift # do not pass it on to playwright
else
  echo "==> building $IMAGE"
  docker build -t "$IMAGE" ..
fi

echo "==> starting instances"
docker run -d --name "$NO_AUTH" -p 8101:8000 "$IMAGE" >/dev/null
docker run -d --name "$WITH_AUTH" -p 8102:8000 \
  -e LINFORM_SUPERUSER="$E2E_SUPERUSER" \
  -e LINFORM_SUPERUSER_PASSWORD="$E2E_PASSWORD" \
  "$IMAGE" >/dev/null

wait_for() {
  url=$1
  i=0
  while [ $i -lt 60 ]; do
    if curl -sf "$url/health" >/dev/null 2>&1; then
      echo "    $url is up"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "!!! $url never became healthy" >&2
  docker logs "$2" 2>&1 | tail -30 >&2
  return 1
}
wait_for http://localhost:8101 "$NO_AUTH"
wait_for http://localhost:8102 "$WITH_AUTH"
wait_for http://localhost:8103 "$DEMO"

echo "==> running tests"
if [ "${E2E_IN_CONTAINER:-}" = "1" ]; then
  # Already inside the Playwright image (CI): run directly.
  LINFORM_E2E_URL=http://localhost:8101 \
  LINFORM_E2E_AUTH_URL=http://localhost:8102 \
  E2E_SUPERUSER="$E2E_SUPERUSER" \
  E2E_PASSWORD="$E2E_PASSWORD" \
    npx playwright test "$@"
else
  # Host without Node: drive the browsers from the Playwright image, sharing
  # the host network so localhost:8101/8102 are the containers started above.
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/work \
    -v "$(cd .. && pwd)":/work \
    -w /work/e2e \
    -e LINFORM_E2E_URL=http://localhost:8101 \
    -e LINFORM_E2E_AUTH_URL=http://localhost:8102 \
    -e LINFORM_E2E_DEMO_URL=http://localhost:8103 \
    -e E2E_SUPERUSER="$E2E_SUPERUSER" \
    -e E2E_PASSWORD="$E2E_PASSWORD" \
    "$PLAYWRIGHT_IMAGE" \
    sh -c "npm ci --no-audit --no-fund >/dev/null 2>&1 && npx playwright test $*"
fi
