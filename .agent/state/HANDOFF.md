# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` — **rebased on `main`**; push after local commits.
- **2026-05-05 (wave-2)**  
  - **TASK-RBAC-MEMBERSHIP-API-007** — **`in_progress`:** `GET /api/accounts/current/membership` on **account-service** (ACTIVE membership probe per ADR 0004 § optional read-only probe). BFF already routes `/api/accounts/current/*` → slice; **no** `routing.ts` edit. Tests: `@oat/account-service` unit + `test:integration`, `@oat/web-bff` test (120s cap).  
  - **TASK-WEB-BFF-HARDEN-008** → **`done`** (parity checklist + web-bff green).  
  - **TASK-PRD-FRONTMATTER-009** → **`done`** (`prd_status: draft` + revision row in `.agent/prd/prd.md`).  
  - **TASK-ADR-AUTH-MIGRATION-004**, **TASK-ADR-JOB-PIPELINE-SPLIT-005**, **TASK-ADR-REALTIME-GATEWAY-006** — remain **`review`**: drafted ADRs **0005–0007** + diagram links satisfy **document** acceptance; **`Status: Proposed`** and **landing on `main`** still pending reviewer — **do not** flip **`done`** until **Accepted** (or team policy) **and** merge.
- **Open PR:** `feat/agent-harness-wave` → `main` (include ADRs 0005–0007 when merged from this branch).

## Blockers / gaps

- ADR lifecycle: **Proposed → Accepted** is the human gate for closing **TASK-ADR-*-004–006**.
- **007** remainder: callers adopting the probe optional; **`apps/api`** guard shim/parity not started this session (`pnpm --filter @oat/api test` **not** run).

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged and pushed (2026-05-05).
