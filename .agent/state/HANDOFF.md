# Handoff

## Restart Capsule

- Status: RBAC boundary documented; nginx PR still open
- Current task: **TASK-RBAC-NEXT-002** completed on branch `feat/adr-rbac-membership-boundary`
- Prior task: **TASK-STRANGLER-NGINX-AUTH-001** — code on `origin/feat/nginx-auth-slice-parity`, merge via PR
- Work mode: collaborative (`tasks.json`)
- Base branch: main
- Current role: architect (RBAC); engineer (nginx PR)
- Goal: Strangler alignment + explicit RBAC/membership guard ownership

## Completed This Session

- Pushed **`feat/nginx-auth-slice-parity`** to origin (open PR from GitHub UI).
- Added **ADR 0004** (`docs/adr/0004-account-membership-rbac-boundary.md`): `AccountGuard` (region pin) vs `AccountContextGuard` (global only); endpoint ownership table; no standalone RBAC service for this phase.
- Updated **`design/strangler-vs-ats-diagram.md`** RBAC pilot row + “How to use” link to ADR 0004.

## Next Safest Actions

1. Open / merge PR **`feat/nginx-auth-slice-parity`** → `main` (nginx `/api/slice/auth` parity).
2. Open PR **`feat/adr-rbac-membership-boundary`** → `main` (ADR + diagram + optional `.agent` queue files if kept in repo).

## Validation

- **`feat/adr-rbac-membership-boundary` (2026-05-05):** `pnpm --filter @oat/web-bff test`, `pnpm --filter @oat/account-service test` (`perl -e 'alarm 120; exec @ARGV' …`) — green.
- **Nginx strangler slice PR:** `pnpm --filter @oat/auth-service test` alongside web-bff (see TASK-STRANGLER validation in `tasks.json`).

## Negative Space

- No new account-service HTTP; no pipeline/realtime scope.
