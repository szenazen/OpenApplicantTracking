# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` — rebased on **`origin/main`** (2026-05-06: fetch + rebase, already current); pushed after **007**/**019** closure commit.
- **TASK-RBAC-MEMBERSHIP-API-007** → **`done`:** `GET /api/accounts/current/membership` parity **account-service** + **`apps/api`** (ADR 0004 table); validation re-run 2026-05-06 (`@oat/account-service`, `@oat/api` accounts spec, `@oat/web-bff`, 120s perl alarm).
- **TASK-WORKERS-DEFERRED-019** → **`done`:** `design/strangler-vs-ats-diagram.md` **Deferred diagram workers** section points at drawio Notification / Audit / CV Parser / Analytics boxes + backlog placeholder.
- **TASK-ADR-AUTH-MIGRATION-004**, **TASK-ADR-JOB-PIPELINE-SPLIT-005**, **TASK-ADR-REALTIME-GATEWAY-006** — remain **`review`**: ADRs **0005–0007** are **Proposed** on branch — do **not** set task **`done`** until **Accepted** + merge to **`main`**.
- **TASK-AUTH-SESSION-SLICE-010** — **`pending`:** **do not start** until **ADR 0005** **Accepted on mainline** + scoped first-commit plan.

## Blockers / gaps

- ADR lifecycle human gate for **TASK-ADR-004–006** (status Proposed).
- **010** blocked on **ADR 0005** acceptance on **main** + implementation scope.

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged (2026-05-05).
