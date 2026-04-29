#!/usr/bin/env bash
set -euo pipefail

# One-command demo launcher for backup monolith (apps/api) + web app.
#
# Default behavior:
# 1) Starts required infra containers (Postgres + Redis + Mailhog + MinIO)
# 2) Runs API Prisma migrate + seed
# 3) Starts apps/api on API_PORT (default: 3001)
# 4) Starts apps/web pointed at that API on WEB_PORT (default: 3002)
#
# Usage:
#   pnpm demo:backup
#   pnpm demo:backup:dry-run
#   bash scripts/start-demo-backup.sh --api-only
#
# Options:
#   --api-only     Start only apps/api (skip apps/web)
#   --no-migrate   Skip API migration step
#   --no-seed      Skip API seed step
#   --dry-run      Print resolved plan and exit
#   -h, --help     Show this help

API_ONLY=0
NO_MIGRATE=0
NO_SEED=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=1 ;;
    --no-migrate) NO_MIGRATE=1 ;;
    --no-seed) NO_SEED=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '1,36p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3002}"
API_URL="http://localhost:${API_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"

INFRA_SERVICES=(
  global-pg
  region-us-east-1-pg
  region-eu-west-1-pg
  region-ap-southeast-1-pg
  redis
  mailhog
  minio
)

if [[ "$DRY_RUN" == "1" ]]; then
  cat <<EOF
[dry-run] demo backup plan
  ROOT        = $ROOT
  API_PORT    = $API_PORT
  WEB_PORT    = $WEB_PORT
  API_ONLY    = $API_ONLY
  NO_MIGRATE  = $NO_MIGRATE
  NO_SEED     = $NO_SEED
  API_URL     = $API_URL
  WEB_URL     = $WEB_URL
  INFRA       = ${INFRA_SERVICES[*]}
EOF
  exit 0
fi

step() {
  echo
  echo "==> $*"
}

wait_http() {
  local url=$1
  local label=$2
  local attempts=${3:-60}
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then
      echo "[$label] ready: $url"
      return 0
    fi
    if (( i % 10 == 0 )); then
      echo "[$label] waiting... (${i}/${attempts})"
    fi
    sleep 2
  done
  echo "[$label] timed out: $url" >&2
  exit 1
}

kill_tree() {
  local pid=$1
  kill -0 "$pid" 2>/dev/null || return 0
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    kill_tree "$c"
  done
  kill "$pid" 2>/dev/null || true
}

API_PID=""
WEB_PID=""
cleanup() {
  local rc=$?
  if [[ -n "$WEB_PID" ]]; then kill_tree "$WEB_PID"; fi
  if [[ -n "$API_PID" ]]; then kill_tree "$API_PID"; fi
  if [[ "$rc" == "130" ]]; then
    echo
    echo "Stopped demo services."
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step "Starting infra containers"
docker compose up -d "${INFRA_SERVICES[@]}"

if [[ "$NO_MIGRATE" != "1" ]]; then
  step "Running API migrations"
  pnpm --filter @oat/api db:migrate
fi

if [[ "$NO_SEED" != "1" ]]; then
  step "Seeding API demo data"
  pnpm --filter @oat/api db:seed
fi

step "Starting backup API on :${API_PORT}"
(
  export API_PORT="$API_PORT"
  pnpm --filter @oat/api dev
) &
API_PID=$!

wait_http "${API_URL}/health" "backup-api" 90

if [[ "$API_ONLY" == "1" ]]; then
  echo
  echo "Backup API running for demo: ${API_URL}"
  echo "Swagger: ${API_URL}/api/docs"
  wait "$API_PID"
  exit 0
fi

step "Starting web app on :${WEB_PORT} (API -> ${API_URL})"
(
  export NEXT_PUBLIC_API_URL="$API_URL"
  export API_URL="$API_URL"
  pnpm --filter @oat/web exec next dev -p "$WEB_PORT"
) &
WEB_PID=$!

wait_http "${WEB_URL}/login" "web" 120

echo
echo "Demo is ready:"
echo "- Backup API: ${API_URL}"
echo "- Swagger:    ${API_URL}/api/docs"
echo "- Web app:    ${WEB_URL}"
echo
echo "Press Ctrl+C to stop both API and web."

wait "$WEB_PID"
