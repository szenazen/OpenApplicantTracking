# Handoff

## Restart Capsule

- Status: awaiting PR
- Current task: TASK-STRANGLER-NGINX-AUTH-001
- Current role: engineer
- Work mode: collaborative (`tasks.json`)
- Base branch: main
- Branch: feat/nginx-auth-slice-parity
- Current phase: review
- Git state: feature branch; do not merge to main without approval
- Context budget: small
- Context risk: low
- Goal: Strangler-aligned nginx parity for auth slice pilot
- Constraints: user asked not to push without approval; nginx cannot express `BFF_*`/`USER_SLICE` env toggles — document limits in README/strangler diagram
- Last completed step: `services/api-gateway/nginx.conf` upstream `auth_service` + `location ^~ /api/slice/auth`; docs updated; `pnpm --filter @oat/web-bff test` ✅ and `pnpm --filter @oat/auth-service test` ✅
- Next safest action: `git push -u origin feat/nginx-auth-slice-parity`, open PR with summary below

## Completed Steps

- Mapped HTTP/RBAC responsibilities (routes + guards) vs `routing.ts` / design docs.
- Implemented nginx **`/api/slice/auth` → auth-service:3020** parity with Web BFF `AUTH_SLICE_ENABLED` behaviour on that prefix.
- Updated `design/strangler-vs-ats-diagram.md` and `services/api-gateway/README.md`.
- Updated `.agent/tasks.json` (+ backlog TASK-RBAC-NEXT-002), `CURRENT_TASK.md`, `logs/LOG.md`.

## Routes / RBAC sketch (inventory)

### Web BFF (`resolveUpstream`)

- **Self:** `/gateway-health`, `/bff-health`, `/api/bff/aggregated-health`
- **`pipeline`:** `/api/slice/pipeline*` when flagged; optionally `GET /api/jobs*` + `/api/pipelines*` when `BFF_*`
- **`auth`:** `/api/slice/auth*` when `AUTH_SLICE_ENABLED` — **`GET …/probe`**, **`POST …/verify-access`** (JWT verify only)
- **`user`:** **`GET /api/users/me`** when `USER_SLICE_ENABLED`
- **`account`:** `/api/accounts/current*`, **`GET /api/accounts/:id`**, **`/api/invitations***`, **`GET /api/platform/accounts***`; **`POST /api/accounts`**, **`POST /api/platform/accounts`** → monolith
- **`monolith`:** default (incl. `/realtime`, regional jobs/candidates, **`/api/auth` login/register** session)

### `apps/api` (backup)

- **JWT Passport `jwt`**: `JwtStrategy` loads **ACTIVE** user from **global DB** (`AuthUser`).
- **`AccountGuard`**: requires **`x-account-id`**, verifies **ACTIVE membership**, sets **`req.ctx.region`** via **RegionRouterService**, attaches **`membership.role.name`** (**account-scope RBAC**, not standalone service).
- **Job-level RBAC**: `JobPermissionsService` + **`job-members`** (OWNER/RECRUITER/etc.) enforced on job routes.
- **Platform admin**: `PlatformAdminGuard` for platform controllers.

### Slices today

| Service | Responsibility |
| ------ | ------- |
| **auth-service** | Crypt JWT verify **`POST /api/slice/auth/verify-access`**; **`GET /api/slice/auth/probe`** — **no OAuth/session DB** |
| **user-service** | **`GET /api/users/me`** (global DB, JWT `sub`) |
| **account-service** | Account/members CRUD-ish parity under `/api` (JWT + account context guards) |

### Gaps vs diagram (`strangler-vs-ats-diagram.md`)

- Standalone **RBAC service** → **none** today (diagram target).
- **nginx** lacked auth slice routing until this change → **fixed** (`/api/slice/auth`).
- **`/api/slice/pipeline`**, **`BFF_PIPELINES`**, **`USER_SLICE`** still **BFF-first** — nginx comments unchanged.

## Open Questions

- When to add optional nginx block for **`GET /api/users/me`** mirroring **`USER_SLICE_ENABLED`** consistently (Compose vs host networking names)?

## Decisions And Evidence

- Implemented nginx auth proxy **without** env mirroring flags: callers using `/api/slice/auth/*` intentionally opt into pilot; backup monolith has no conflicting handler for that prefix.
- Ports and hostnames matched **`docker-compose.microservices.yml`** (`auth-service:3020`, `AUTH_SERVICE_URL` parity).

## Negative Space

- No change to **`apps/api`**, Web BFF **TypeScript** routing logic, or **auth-service** code.
- Did **not** extract RBAC service or add RBAC-only read endpoints.

## Files Touched

- `services/api-gateway/nginx.conf`
- `services/api-gateway/README.md`
- `design/strangler-vs-ats-diagram.md`
- `.agent/tasks.json`
- `.agent/state/CURRENT_TASK.md`
- `.agent/state/HANDOFF.md`
- `.agent/logs/LOG.md` (append entry; folder may be **gitignored** — not included in commits)

## Commands Run

- `pnpm --filter @oat/web-bff test` (after edits)
- `pnpm --filter @oat/auth-service test` (after edits)

## Suggested PR title / body

**Title:** feat(gateway): proxy auth slice `/api/slice/auth` in optional nginx edge

**Body:** Mirrors Web BFF `AUTH_SLICE_ENABLED` routing for **`/api/slice/auth/*`** (`probe`, `verify-access`) to **`auth-service:3020`**, aligning optional nginx (`services/api-gateway`) with ADR 0003 — backup monolith does not serve this prefix. Updates strangler diagram and README to document parity and BFF-only rewrites (**pipelines**, **jobs**, **`GET /api/users/me`**) nginx does not duplicate.

## Do Not Repeat

- Do not assume nginx edge supersedes BFF — microservices Compose default remains **`:3080` Web BFF**.

## Validation State

- `pnpm --filter @oat/web-bff test` — 6 suites passed
- `pnpm --filter @oat/auth-service test` — 2 suites passed
