# Handoff

## Restart Capsule

- Status: nginx auth slice **implementation + QA complete** on branch; **PR merge to `main`** remains.
- Last completed: **TASK-STRANGLER-NGINX-AUTH-001** (evidence in `.agent/tasks.json`).
- Next queue: **TASK-RBAC-NEXT-002** (ADR 0004 on **`feat/adr-rbac-membership-boundary`**, not in tree on nginx-only checkout).
- Current role: engineer (nginx) → **architect** for RBAC PR.
- Work mode: collaborative (`tasks.json`).
- Base branch: `main`.
- Branch: `feat/nginx-auth-slice-parity` (this session).
- Goal: Land strangler nginx parity; then land RBAC boundary ADR.

## Completed this session (2026-05-05)

- Checked out `feat/nginx-auth-slice-parity`; confirmed `services/api-gateway/nginx.conf` has `upstream auth_service` + `location ^~ /api/slice/auth` → `auth-service:3020`.
- Re-ran **`perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/web-bff test`** — 6 suites, 34 tests passed.
- Re-ran **`perl -e 'alarm 120; exec @ARGV' pnpm --filter @oat/auth-service test`** — 2 suites, 6 tests passed.
- Patched `.agent/tasks.json` (nginx evidence_refs, RBAC cross-branch pointers), `CURRENT_TASK.md`, `HANDOFF.md`. Appended `.agent/logs/LOG.md` (path may be gitignored).

## Next safest actions

1. **Merge** PR `feat/nginx-auth-slice-parity` → `main`.
2. **Merge** PR `feat/adr-rbac-membership-boundary` → `main` (ADR 0004 + diagram), or rebase onto updated `main`.
3. After ADR on `main`, move **TASK-RBAC-NEXT-002** to `done` and drop tentative `context_refs` notes.

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

- No code changes to nginx or services in this session — validation-only + harness sync.
