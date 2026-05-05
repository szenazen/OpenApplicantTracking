# Current Task

## Recently completed

- **TASK-STRANGLER-NGINX-AUTH-001** — nginx `/api/slice/auth` → `auth-service:3020`; docs parity; **validation re-run 2026-05-05** (`pnpm --filter @oat/web-bff test`, `pnpm --filter @oat/auth-service test`, 120s cap). Status **done** in `tasks.json` (integration = merge PR to `main`).

## Active backlog (next)

- **TASK-RBAC-NEXT-002** — architect; ADR + diagram; **work on branch `feat/adr-rbac-membership-boundary`** (`docs/adr/0004` not on nginx branch until that PR merges).

## Next Action

1. Open/merge **PR** `feat/nginx-auth-slice-parity` → `main`.
2. Open/merge **PR** `feat/adr-rbac-membership-boundary` → `main` (or rebase after nginx) for TASK-RBAC-NEXT-002.
