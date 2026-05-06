# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` — **`git fetch` / `git rebase origin/main`** (latest run: up to date with `origin/main`); **push** reflects auth slice shim + docs/tasks wave.
- **`TASK-AUTH-SESSION-SLICE-010`** → **`review`:** phase-0 **login** strangler — **`AUTH_LOGIN_SHIM`**, BFF routes slice login to auth-service or monolith rewrite to **`/api/auth/login`**; auth-service **`fetch`** shim to **`MONOLITH_URL`**.
- **`TASK-REALTIME-GATEWAY-011`** → **`in_progress` (docs):** **`docs/realtime-gateway-tranche-notes.md`** + **`docs/runbook.md`** §7 — **ADR 0007** pointer; **no** Socket.IO refactor this wave.
- **`TASK-CANDIDATE-SLICE-P1-012`** / **`TASK-JOB-APP-SLICE-P1-013`:** handoff note **`docs/handoff/strangler-p1-candidate-job-slices.md`** (+ **tasks.json** `evidence_refs`).
- **`TASK-SKILLS-CATALOG-014`** / **`TASK-FILE-SERVICE-015`** / **`TASK-ACCOUNT-TENANT-PROVISION-017`:** **ADR 0009–0011** Proposed stubs only.
- **`TASK-MOBILE-BFF-DEFERRED-099`** **`pending`** — `evidence_refs`: **unchanged deferred**.

## Blockers / gaps

- Refresh tokens + E2E login path for **010** still open vs full AC; merge **ADR 0005 + shim** to **`main`** when ready.
- Realtime **code** tranche remains gated on org process for **ADR 0007** on **`main`** if programme requires it.

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged (2026-05-05).
