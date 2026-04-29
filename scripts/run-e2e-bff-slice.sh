#!/usr/bin/env bash
# Spin up Docker (base + microservices overlay), seed, drain Hays US → slice,
# start Next.js against Web BFF :3080, run Playwright bff-slice project.
#
# Usage (repo root):
#   pnpm test:e2e:bff-slice
#   # or: bash scripts/run-e2e-bff-slice.sh
#
# Options (environment):
#   SKIP_COMPOSE=1       — do not run docker compose (stack already up)
#   SKIP_SEED=1          — skip seed inside backup-api
#   SKIP_DRAIN=1         — skip drain (slice already has jobs for Hays US)
#   BFF_E2E_BUILD=1      — add --build to docker compose up
#   USE_EXISTING_WEB=1   — do not start Next; reuse a server at E2E_BFF_WEB_URL
#   E2E_BFF_WEB_PORT    — host port for Next started by this script (default 3012;
#                          avoids clashing with a normal dev server on :3002)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.microservices.yml)
WEB_PID=""

cleanup() {
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
    wait "${WEB_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

BASE_WEB_PORT="${E2E_BFF_WEB_PORT:-3012}"
if [[ "${USE_EXISTING_WEB:-}" == "1" ]]; then
  export E2E_BFF_WEB_URL="${E2E_BFF_WEB_URL:-http://127.0.0.1:3002}"
  E2E_BFF_WEB_PORT="${E2E_BFF_WEB_PORT:-3002}"
else
  port="$BASE_WEB_PORT"
  while curl -sf "http://127.0.0.1:${port}/login" >/dev/null 2>&1; do
    echo "[next] port ${port} in use, trying $((port + 1))…" >&2
    port=$((port + 1))
    if [[ "$port" -gt $((BASE_WEB_PORT + 25)) ]]; then
      echo "No free port near ${BASE_WEB_PORT}; set E2E_BFF_WEB_PORT or stop the other Next dev server." >&2
      exit 1
    fi
  done
  E2E_BFF_WEB_PORT="$port"
  export E2E_BFF_WEB_URL="http://127.0.0.1:${E2E_BFF_WEB_PORT}"
fi

wait_http() {
  local url=$1
  local label=$2
  local max_attempts="${3:-90}"
  local i
  for ((i = 1; i <= max_attempts; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "[$label] ready ($url)"
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $label ($url)" >&2
  exit 1
}

if [[ "${SKIP_COMPOSE:-}" != "1" ]]; then
  if [[ "${BFF_E2E_BUILD:-}" == "1" ]]; then
    "${COMPOSE[@]}" up -d --build
  else
    "${COMPOSE[@]}" up -d
  fi
fi

wait_http "http://localhost:3101/health" "backup-api"
wait_http "http://localhost:3010/health" "account-service"
wait_http "http://localhost:3030/api/slice/pipeline/verify" "pipeline-service"
wait_http "http://localhost:3080/bff-health" "web-bff"

if [[ "${SKIP_SEED:-}" != "1" ]]; then
  echo "[seed] running in backup-api container…"
  "${COMPOSE[@]}" exec -T backup-api pnpm exec tsx scripts/seed.ts
fi

if [[ "${SKIP_DRAIN:-}" != "1" ]]; then
  ACCOUNT_ID="$(
    docker exec oat-global-pg psql -U oat -d oat_global -t -A -c \
      "select id from accounts_directory where slug = 'hays-us' limit 1;" 2>/dev/null | tr -d '\r' | tr -d '[:space:]'
  )"
  if [[ -z "$ACCOUNT_ID" ]]; then
    echo "Could not read Hays US account id from global DB (is oat-global-pg up?)." >&2
    exit 1
  fi
  echo "[drain] ACCOUNT_ID=$ACCOUNT_ID (hays-us → slice)"
  export ACCOUNT_ID
  export REGIONAL_SOURCE_URL="${REGIONAL_SOURCE_URL:-postgresql://oat:oat@127.0.0.1:5433/oat_us_east_1?schema=public}"
  export PIPELINE_SLICE_DATABASE_URL="${PIPELINE_SLICE_DATABASE_URL:-postgresql://oat:oat@127.0.0.1:5440/oat_pipeline_slice?schema=public}"

  pnpm --filter @oat/api db:generate
  pnpm --filter @oat/pipeline-service db:generate
  pnpm --filter @oat/api drain:pipelines-to-slice
fi

echo "[playwright] installing chromium (if needed)…"
pnpm --filter @oat/web exec playwright install chromium

if [[ "${USE_EXISTING_WEB:-}" == "1" ]]; then
  wait_http "${E2E_BFF_WEB_URL}/login" "next (existing)" 120
else
  echo "[next] NEXT_PUBLIC_API_URL=http://localhost:3080 on ${E2E_BFF_WEB_URL} …"
  (
    cd "$ROOT/apps/web"
    export NEXT_PUBLIC_API_URL="http://localhost:3080"
    export API_URL="http://localhost:3080"
    pnpm exec next dev -p "${E2E_BFF_WEB_PORT}"
  ) &
  WEB_PID=$!
  sleep 4
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Next.js exited early (check port ${E2E_BFF_WEB_PORT})." >&2
    exit 1
  fi
  wait_http "${E2E_BFF_WEB_URL}/login" "next" 120
fi

echo "[playwright] bff-slice project (${E2E_BFF_WEB_URL})…"
cd "$ROOT/apps/web"
export E2E_BFF_SLICE=1
pnpm exec playwright test --project=bff-slice

echo "Done."
