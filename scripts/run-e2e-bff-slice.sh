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
#   PW_REPORTER          — Playwright reporter (default: line; e.g. dot, list, html)
#   NEXT_READY_TIMEOUT   — seconds to wait for Next first compile (default 180)
#
# Self-check:
#   bash scripts/run-e2e-bff-slice.sh --dry-run
#     Prints the resolved plan (ports, URLs, flags) and exits 0 without touching
#     Docker, seed, drain, Next, or Playwright. Used as a lightweight test.

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.microservices.yml)
WEB_PID=""
NEXT_LOG=""
STEP_STARTED_AT=0
SCRIPT_STARTED_AT=$(date +%s)

now() { date +%s; }
elapsed() { echo $(( $(now) - SCRIPT_STARTED_AT ))s; }

step() {
  STEP_STARTED_AT=$(now)
  printf '\n\033[1;34m==> [%s] %s\033[0m\n' "$(elapsed)" "$*"
}

step_done() {
  local d=$(( $(now) - STEP_STARTED_AT ))
  printf '\033[0;32m    done (%ss)\033[0m\n' "$d"
}

# Recursively kill a process and its descendants. `pnpm exec next dev` spawns
# at least: pnpm wrapper → node next/dist/bin/next → next-server. SIGTERM on the
# root only leaves the grandchildren chewing CPU forever (we hit this).
kill_tree() {
  local pid=$1
  local sig=${2:-TERM}
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    kill_tree "$c" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  local rc=$?
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill_tree "${WEB_PID}" TERM
    # give them a beat, then SIGKILL anything still alive
    for _ in 1 2 3 4 5; do
      kill -0 "${WEB_PID}" 2>/dev/null || break
      sleep 1
    done
    kill_tree "${WEB_PID}" KILL
    wait "${WEB_PID}" 2>/dev/null || true
  fi
  if [[ -n "${NEXT_LOG:-}" && -f "${NEXT_LOG}" && "${NEXT_LOG_KEEP:-}" != "1" ]]; then
    if [[ "$rc" == "0" ]]; then
      rm -f "${NEXT_LOG}" 2>/dev/null || true
    else
      echo "[next] log preserved at ${NEXT_LOG}" >&2
    fi
  fi
}
trap cleanup EXIT
trap 'echo "[interrupt] cleaning up Next/Playwright children…" >&2; exit 130' INT TERM

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

# Poll a URL until 2xx. Prints a heartbeat every 10 attempts (~20s) so callers
# can see we are not hung. `max_attempts` counts poll attempts of ~2s each.
wait_http() {
  local url=$1
  local label=$2
  local max_attempts="${3:-90}"
  local i
  local started=$(now)
  for ((i = 1; i <= max_attempts; i++)); do
    if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
      echo "[$label] ready ($url) after $(( $(now) - started ))s"
      return 0
    fi
    if (( i % 10 == 0 )); then
      echo "[$label] still waiting after $(( $(now) - started ))s ($url)…" >&2
    fi
    sleep 2
  done
  echo "Timed out waiting for $label ($url) after $(( $(now) - started ))s" >&2
  if [[ "$label" == "next"* && -n "${NEXT_LOG:-}" && -f "${NEXT_LOG}" ]]; then
    echo "---- last 80 lines of ${NEXT_LOG} ----" >&2
    tail -n 80 "${NEXT_LOG}" >&2 || true
  fi
  exit 1
}

NEXT_READY_TIMEOUT="${NEXT_READY_TIMEOUT:-180}"
NEXT_READY_ATTEMPTS=$(( NEXT_READY_TIMEOUT / 2 ))
PW_REPORTER="${PW_REPORTER:-line}"

if [[ "$DRY_RUN" == "1" ]]; then
  cat <<EOF
[dry-run] resolved plan:
  ROOT                  = $ROOT
  E2E_BFF_WEB_URL       = $E2E_BFF_WEB_URL
  E2E_BFF_WEB_PORT      = $E2E_BFF_WEB_PORT
  USE_EXISTING_WEB      = ${USE_EXISTING_WEB:-0}
  SKIP_COMPOSE          = ${SKIP_COMPOSE:-0}
  SKIP_SEED             = ${SKIP_SEED:-0}
  SKIP_DRAIN            = ${SKIP_DRAIN:-0}
  BFF_E2E_BUILD         = ${BFF_E2E_BUILD:-0}
  NEXT_READY_TIMEOUT    = ${NEXT_READY_TIMEOUT}s (~${NEXT_READY_ATTEMPTS} attempts)
  PW_REPORTER           = $PW_REPORTER
EOF
  exit 0
fi

if [[ "${SKIP_COMPOSE:-}" != "1" ]]; then
  step "docker compose up"
  if [[ "${BFF_E2E_BUILD:-}" == "1" ]]; then
    "${COMPOSE[@]}" up -d --build
  else
    "${COMPOSE[@]}" up -d
  fi
  step_done
fi

step "waiting for services"
wait_http "http://localhost:3101/health" "backup-api"
wait_http "http://localhost:3010/health" "account-service"
wait_http "http://localhost:3030/api/slice/pipeline/verify" "pipeline-service"
wait_http "http://localhost:3080/bff-health" "web-bff"
step_done

if [[ "${SKIP_SEED:-}" != "1" ]]; then
  step "seeding backup-api"
  "${COMPOSE[@]}" exec -T backup-api pnpm exec tsx scripts/seed.ts
  step_done
fi

if [[ "${SKIP_DRAIN:-}" != "1" ]]; then
  step "drain hays-us → slice"
  ACCOUNT_ID="$(
    docker exec oat-global-pg psql -U oat -d oat_global -t -A -c \
      "select id from accounts_directory where slug = 'hays-us' limit 1;" 2>/dev/null | tr -d '\r' | tr -d '[:space:]'
  )"
  if [[ -z "$ACCOUNT_ID" ]]; then
    echo "Could not read Hays US account id from global DB (is oat-global-pg up?)." >&2
    exit 1
  fi
  echo "    ACCOUNT_ID=$ACCOUNT_ID"
  export ACCOUNT_ID
  export REGIONAL_SOURCE_URL="${REGIONAL_SOURCE_URL:-postgresql://oat:oat@127.0.0.1:5433/oat_us_east_1?schema=public}"
  export PIPELINE_SLICE_DATABASE_URL="${PIPELINE_SLICE_DATABASE_URL:-postgresql://oat:oat@127.0.0.1:5440/oat_pipeline_slice?schema=public}"

  pnpm --filter @oat/api db:generate
  pnpm --filter @oat/pipeline-service db:generate
  pnpm --filter @oat/api drain:pipelines-to-slice
  step_done
fi

step "playwright install chromium (first run can take 1-2min)"
pnpm --filter @oat/web exec playwright install chromium
step_done

if [[ "${USE_EXISTING_WEB:-}" == "1" ]]; then
  step "reusing existing Next at ${E2E_BFF_WEB_URL}"
  wait_http "${E2E_BFF_WEB_URL}/login" "next (existing)" "${NEXT_READY_ATTEMPTS}"
  step_done
else
  step "starting Next dev on ${E2E_BFF_WEB_URL} (NEXT_PUBLIC_API_URL=http://localhost:3080)"
  NEXT_LOG="$(mktemp -t oat-next-bff-slice.XXXXXX).log"
  echo "    next logs → ${NEXT_LOG}"
  (
    cd "$ROOT/apps/web"
    export NEXT_PUBLIC_API_URL="http://localhost:3080"
    export API_URL="http://localhost:3080"
    pnpm exec next dev -p "${E2E_BFF_WEB_PORT}" >"${NEXT_LOG}" 2>&1
  ) &
  WEB_PID=$!
  sleep 4
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Next.js exited early (check port ${E2E_BFF_WEB_PORT}). Log: ${NEXT_LOG}" >&2
    tail -n 80 "${NEXT_LOG}" >&2 || true
    exit 1
  fi
  wait_http "${E2E_BFF_WEB_URL}/login" "next" "${NEXT_READY_ATTEMPTS}"
  step_done
fi

step "playwright bff-slice project (${E2E_BFF_WEB_URL}, reporter=${PW_REPORTER})"
cd "$ROOT/apps/web"
export E2E_BFF_SLICE=1
pnpm exec playwright test --project=bff-slice --reporter="${PW_REPORTER}"
step_done

echo
echo "Done in $(elapsed)."
