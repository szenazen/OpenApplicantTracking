# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` — rebased on **`origin/main`** (2026-05-05 session: already up to date); push after local commits.
- **TASK-RBAC-MEMBERSHIP-API-007** — **`review`:** Read-only membership probe `GET /api/accounts/current/membership` on **account-service** (`AccountContextGuard`) and **monolith** (`AccountGuard`, same JSON). ADR **0004** endpoint table documents parity. Tests: `pnpm --filter @oat/account-service test` + `test:integration`, `pnpm --filter @oat/api exec jest test/accounts.spec.ts --runInBand` (bounded). **No** BFF / `routing.ts` change this slice.
- **TASK-WEB-BFF-HARDEN-008** → **`done`**. **TASK-PRD-FRONTMATTER-009** → **`done`**.
- **TASK-ADR-AUTH-MIGRATION-004**, **TASK-ADR-JOB-PIPELINE-SPLIT-005**, **TASK-ADR-REALTIME-GATEWAY-006** — remain **`review`**: do **not** set **`done`** until **Status: Accepted** + merge policy + on **`main`** (evidence on branch only).
- **TASK-AUTH-SESSION-SLICE-010** — **`pending` / discover:** **do not start** until **ADR 0005** is **accepted on mainline** and there is a clearly scoped first commit; still blocked.

## Blockers / gaps

- ADR lifecycle human gate for **TASK-ADR-004–006**.
- **010** blocked on **ADR 0005** acceptance + implementation scope.

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged (2026-05-05).
