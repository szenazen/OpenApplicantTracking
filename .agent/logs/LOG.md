# Agent log

| ISO date (UTC) | Summary |
| --- | --- |
| 2026-05-05 | Merged `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` into `main` (`--no-ff`), resolved add/add `.agent` conflicts with canonical `tasks.json`; pushed `origin/main`. Branch `feat/agent-harness-wave`: ADR 0005–0007, `strangler-vs-ats-diagram.md` links, `api-gateway/README.md` nginx↔BFF table + `auth-service/README` ADR link; TASK-ADR-* → `review`, TASK-WEB-BFF-HARDEN-008 → `review`. |
| 2026-05-05 | Mapped Web BFF + monolith RBAC/auth; aligned optional `services/api-gateway/nginx.conf` with auth slice `/api/slice/auth` → auth-service (`feat/nginx-auth-slice-parity`). |
| 2026-05-05 | Pushed `feat/nginx-auth-slice-parity` to origin; ADR 0004 + strangler diagram updates tracked on `feat/adr-rbac-membership-boundary` (separate PR). |
| 2026-05-05 | On `feat/nginx-auth-slice-parity`: re-validated TASK-STRANGLER-NGINX-AUTH-001 (web-bff + auth-service tests, 120s cap); updated `.agent/tasks.json` evidence_refs + RBAC cross-branch handoff; CURRENT_TASK/HANDOFF aligned to merge PRs. |
| 2026-05-05 | On `feat/adr-rbac-membership-boundary`: re-ran web-bff + account-service tests (120s alarm); patched TASK-RBAC-NEXT-002 `evidence_refs`/`validation`; refreshed HANDOFF validation section. |
| 2026-05-06 | Extended `.agent/tasks.json` (20 tasks) for diagram-aligned microservices backlog: merge harness 003, ADRs 004–006, implementation epics 007–019, PRD 009, mobile deferred 099; updated CURRENT_TASK + HANDOFF. |
| 2026-05-05 | `feat/agent-harness-wave`: `GET /api/accounts/current/membership` + integration test (**007** slice); **008 done**, **009 done** (PRD `draft`); ADR tasks **004–006** evidence updated—remain **review** (Proposed, pre-main). `@oat/account-service` unit + integration + `@oat/web-bff` tests (120s cap). |
| 2026-05-06 | **`feat/agent-harness-wave`:** `git fetch` + `git rebase origin/main` (no-op). **TASK-RBAC-MEMBERSHIP-API-007** → **`done`** (parity + ADR 0004 + bounded tests). **TASK-WORKERS-DEFERRED-019** → **`done`** (`strangler-vs-ats-diagram.md` deferred workers). HANDOFF/CURRENT_TASK/tasks.json updated; commit + push branch. |
