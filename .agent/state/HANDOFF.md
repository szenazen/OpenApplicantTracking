# Handoff

## Restart Capsule

- Status: nginx auth slice **implementation + QA complete** on branch; **PR merge to `main`** remains.
- Last completed: **TASK-STRANGLER-NGINX-AUTH-001** (evidence in `.agent/tasks.json`).
- Next queue: **TASK-RBAC-NEXT-002** (status **`review`**) — **`feat/adr-rbac-membership-boundary`** pushed to `origin` with harness validation notes; nginx checkout still lacks ADR paths until merge.
- Current role: engineer (nginx) → **architect** for RBAC PR.
- Work mode: collaborative (`tasks.json`).
- Base branch: `main`.
- Branch: `feat/nginx-auth-slice-parity` (this session).
- Goal: Land strangler nginx parity; then land RBAC boundary ADR.

## Completed this session (2026-05-05)

- Checked out `feat/nginx-auth-slice-parity`; confirmed `services/api-gateway/nginx.conf` has `upstream auth_service` + `location ^~ /api/slice/auth` → `auth-service:3020`.
- Re-ran **`perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/web-bff test`** — 6 suites, 34 tests passed.
- Re-ran **`perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/auth-service test`** — 2 suites, 6 tests passed.
- Patched **`feat/nginx-auth-slice-parity`** `.agent/tasks.json` (`TASK-RBAC-NEXT-002` **`review`**), **`CURRENT_TASK.md`**, **`HANDOFF.md`**.
- **`feat/adr-rbac-membership-boundary`**: re-ran `pnpm --filter @oat/web-bff test` + `pnpm --filter @oat/account-service test` (120s alarm) 2026-05-05; pushed harness commit **`c922497`** to **`origin`**.

## Next safest actions

1. **Merge** PR `feat/nginx-auth-slice-parity` → `main`.
2. **Merge** PR `feat/adr-rbac-membership-boundary` → `main` (ADR 0004 + diagram + harness refs).
3. After ADR is on **`main`**, set **TASK-RBAC-NEXT-002** **`review`** → **`done`** in canonical queue.

## Files touched (harness)

- `.agent/tasks.json`
- `.agent/state/CURRENT_TASK.md`
- `.agent/state/HANDOFF.md`
- `.agent/logs/LOG.md` (optional; gitignored)

## Commands

```bash
perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/web-bff test
perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/auth-service test
```

## Negative space

- No nginx service/nginx.conf edits this slice — **`tasks.json` sync** (`TASK-RBAC-NEXT-002` **review**) + adb-branch validation note.
