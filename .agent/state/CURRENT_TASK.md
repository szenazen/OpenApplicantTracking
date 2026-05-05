# Current task

## Last session (`feat/agent-harness-wave`)

- **007** **`in_progress`:** Membership read probe `GET /api/accounts/current/membership` + integration coverage.
- **008** **`done`** — nginx ↔ BFF checklist + `@oat/web-bff` tests.
- **009** **`done`** — PRD YAML `prd_status: draft`, revision log.
- **TASK-ADR-004 / 005 / 006** — stay **`review`** until ADRs **Accepted** + **main** merge (docs already on branch).

## Next actions

1. Open or refresh PR **`feat/agent-harness-wave`** → **`main`**.
2. Reviewer: set ADR docs **Accepted** when ready; then set **TASK-ADR-*-004–006** → **`done`** and merge.
3. Continue **007:** wire consumers / monolith parity per ADR 0004; run **`pnpm --filter @oat/api test`** when touching guards.
