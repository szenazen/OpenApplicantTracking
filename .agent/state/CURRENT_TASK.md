# Current Task

## Recently completed

- **TASK-STRANGLER-NGINX-AUTH-001** — nginx `/api/slice/auth` → `auth-service:3020`; docs parity; **validation re-run 2026-05-05** (`pnpm --filter @oat/web-bff test`, `pnpm --filter @oat/auth-service test`, 120s cap). Status **done** in `tasks.json` (integration = merge PR to `main`).

## Active backlog (next)

- **TASK-RBAC-NEXT-002** — status **`review`**: acceptance met on **`feat/adr-rbac-membership-boundary`** (pushed); merge PR for ADR/docs, then mark **`done`** once on **`main`**.

## Next Action

1. Open/merge **PR** `feat/nginx-auth-slice-parity` → `main`.
2. Open/merge **PR** `feat/adr-rbac-membership-boundary` → `main` (or rebase after nginx) for TASK-RBAC-NEXT-002.
