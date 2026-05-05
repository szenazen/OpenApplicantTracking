# Handoff

## Restart capsule

- **Status:** `TASK-MERGE-HARNESS-003` completed locally — `origin/feat/nginx-auth-slice-parity` and `origin/feat/adr-rbac-membership-boundary` merged into **`main`** (`--no-ff`); add/add conflicts in `.agent/*` resolved with canonical full `tasks.json`.
- **Landed on `main`:** nginx `/api/slice/auth` → auth-service; **ADR 0004** + strangler diagram RBAC row; **`TASK-RBAC-NEXT-002`** → **done**.
- **Push:** Run `git push origin main` when authenticated so GitHub matches local `main`.
- **Next queue:** **TASK-ADR-AUTH-MIGRATION-004** → ADR 0005 (auth strangler cutover); follow with job pipeline ADR + realtime gateway ADR on branch **`feat/agent-harness-wave`** (recommended).
- **Work mode:** collaborative (`tasks.json`).
- **Base branch:** `main`.

## Completed (2026-05-05)

- Merge 1: `feat/nginx-auth-slice-parity` → `main`.
- Merge 2: `feat/adr-rbac-membership-boundary` → `main` (conflicts resolved).
- Canonical `.agent/tasks.json` restored from pre-merge stash and reconciled (merge + RBAC tasks closed).

## Next safest actions

1. `git push origin main`.
2. `git checkout -b feat/agent-harness-wave` (or continue on `main`) for ADR 0005–0007 + harness updates.
3. Optional smoke: `pnpm install --frozen-lockfile && pnpm --filter @oat/web-bff test`.

## Negative space

- Full CI not re-run in this session after merge; run pipelines or local smoke if needed.
