# Current task

## Last session (`feat/agent-harness-wave`)

- **007** **`review`:** `GET .../accounts/current/membership` on **account-service** + **monolith** parity (`AccountGuard`); ADR 0004 table row; **`@oat/account-service`** + **`@oat/api`** `accounts.spec` green.
- **008** **`done`** — nginx ↔ BFF checklist + `@oat/web-bff` tests.
- **009** **`done`** — PRD YAML `prd_status: draft`, revision log.
- **TASK-ADR-AUTH-MIGRATION-004 / JOB-PIPELINE-SPLIT-005 / REALTIME-GATEWAY-006** — stay **`review`** until ADRs Accepted + **`main`** merge per team policy (**do not** auto-**done**).

## Next actions

1. PR **`feat/agent-harness-wave`** → **`main`**: human review **007**; optionally flip **007** → **`done`** post-merge.
2. **TASK-AUTH-SESSION-SLICE-010**: **blocked** until **ADR 0005** accepted on mainline and a scoped first commit exists (see HANDOFF).
3. Next queue by priority: ADR tasks **004–006** (evidence on branch) or **010** when unblocked.
