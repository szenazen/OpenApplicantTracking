#!/usr/bin/env bash
# Smoke test for scripts/run-e2e-bff-slice.sh --dry-run.
# Verifies the plan output contains the key knobs so future edits that break
# option parsing or defaults fail here instead of at 20-minute e2e runs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/run-e2e-bff-slice.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack=$1
  local needle=$2
  if ! grep -qF -- "$needle" <<<"$haystack"; then
    echo "--- output ---" >&2
    echo "$haystack" >&2
    echo "--------------" >&2
    fail "expected to find: $needle"
  fi
}

# 1) Default plan.
out="$(bash "$SCRIPT" --dry-run)"
assert_contains "$out" "[dry-run] resolved plan:"
assert_contains "$out" "E2E_BFF_WEB_URL       = http://127.0.0.1:3012"
assert_contains "$out" "USE_EXISTING_WEB      = 0"
assert_contains "$out" "PW_REPORTER           = line"
assert_contains "$out" "NEXT_READY_TIMEOUT    = 180s"

# 2) USE_EXISTING_WEB defaults to :3002.
out="$(USE_EXISTING_WEB=1 bash "$SCRIPT" --dry-run)"
assert_contains "$out" "E2E_BFF_WEB_URL       = http://127.0.0.1:3002"
assert_contains "$out" "USE_EXISTING_WEB      = 1"

# 3) Overrides flow through.
out="$(USE_EXISTING_WEB=1 E2E_BFF_WEB_URL=http://example.local:9999 PW_REPORTER=dot NEXT_READY_TIMEOUT=60 \
  bash "$SCRIPT" --dry-run)"
assert_contains "$out" "E2E_BFF_WEB_URL       = http://example.local:9999"
assert_contains "$out" "PW_REPORTER           = dot"
assert_contains "$out" "NEXT_READY_TIMEOUT    = 60s"

# 4) Unknown arg exits non-zero.
if bash "$SCRIPT" --bogus >/dev/null 2>&1; then
  fail "expected non-zero exit for --bogus"
fi

# 5) --help prints usage header without executing.
out="$(bash "$SCRIPT" --help)"
assert_contains "$out" "Spin up Docker"

echo "OK: scripts/run-e2e-bff-slice.sh --dry-run plan is stable"
