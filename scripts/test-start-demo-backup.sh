#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/start-demo-backup.sh"

assert_contains() {
  local haystack=$1
  local needle=$2
  if ! grep -qF -- "$needle" <<<"$haystack"; then
    echo "Expected to find: $needle" >&2
    echo "--- output ---" >&2
    echo "$haystack" >&2
    echo "--------------" >&2
    exit 1
  fi
}

out="$(bash "$SCRIPT" --dry-run)"
assert_contains "$out" "[dry-run] demo backup plan"
assert_contains "$out" "API_PORT    = 3001"
assert_contains "$out" "WEB_PORT    = 3002"
assert_contains "$out" "API_ONLY    = 0"
assert_contains "$out" "NO_MIGRATE  = 0"
assert_contains "$out" "NO_SEED     = 0"

out="$(API_PORT=3999 WEB_PORT=4888 bash "$SCRIPT" --dry-run --api-only --no-migrate --no-seed)"
assert_contains "$out" "API_PORT    = 3999"
assert_contains "$out" "WEB_PORT    = 4888"
assert_contains "$out" "API_ONLY    = 1"
assert_contains "$out" "NO_MIGRATE  = 1"
assert_contains "$out" "NO_SEED     = 1"

if bash "$SCRIPT" --bogus >/dev/null 2>&1; then
  echo "Expected unknown arg to fail" >&2
  exit 1
fi

echo "OK: start-demo-backup dry-run behavior is valid"
