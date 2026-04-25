# OpenApplicantTracking — Runbook

Operational recipes for developers and on-call.

---

## 1. Bring the local stack up

```bash
corepack enable
pnpm install

cp .env.example .env          # first time only
make up                       # docker compose: 1 global pg + 5 regional pg + redis + redpanda + minio + mailhog
make migrate                  # prisma migrate deploy against every datasource in .env
make seed                     # demo user + 3 accounts (hays-us, hays-eu, hays-sg)

pnpm --filter @oat/api dev    # :3001  (swagger at /api/docs)
pnpm --filter @oat/web dev    # :3002
```

Demo login: `demo@openapplicanttracking.local` / `demo1234`.

### Teardown

```bash
make down                     # keeps volumes
docker compose -p oat down -v # nukes volumes (fresh start)
```

---

## 2. Healthchecks

| Check | Command |
| --- | --- |
| API liveness | `curl http://localhost:3001/health` (returns `{status:"ok"}`) |
| API + DB readiness | `curl http://localhost:3001/api/health/ready` (queries global + every regional DB) |
| Web | `curl -I http://localhost:3002/login` |
| Postgres global | `PGPASSWORD=oat psql -h localhost -p 5432 -U oat -d oat_global -c 'select 1'` |
| Postgres regions | ports `5433..5437` (us-east-1, eu-west-1, ap-southeast-1, ap-northeast-1, ap-southeast-2) |

---

## 3. Adding a new region

1. Add a Postgres service + volume in `docker-compose.yml` (copy an existing
   `region-*-pg` block, bump port, rename `POSTGRES_DB`).
2. Add `REGION_<CODE>_DATABASE_URL` to `.env` and `.env.example`.
3. Add the region code to the `Region` enum in both
   `apps/api/prisma/global.prisma` and `apps/api/prisma/regional.prisma`,
   generate new Prisma migrations.
4. `make migrate` — `scripts/migrate-all.ts` auto-discovers any
   `REGION_*_DATABASE_URL` in the env.
5. Restart the API — `RegionRouterService.onModuleInit` discovers new
   regions from config. No code change required.
6. In AWS: add a Terraform module call in `infra/terraform/envs/prod/main.tf`.

---

## 4. Typical incidents

### 4.1 "Cannot find module '.../dist/main'"

The Nest build hasn't produced a dist yet, or `tsconfig.build.tsbuildinfo`
is stale after a dependency change.

```bash
rm -f apps/api/tsconfig*.tsbuildinfo
pnpm --filter @oat/api build
node --env-file=.env apps/api/dist/main.js
```

### 4.2 Seed script exits with
`Invalid value undefined for datasource "db" ... GLOBAL_DATABASE_URL`

The script didn't see `.env`. `db:seed` / `db:migrate` scripts run with
`tsx --env-file=../../.env`; run from the repo root via pnpm rather than
from inside `apps/api` with a shell where `.env` isn't exported.

### 4.3 Playwright `kanban-board` not visible

The job detail page errored while fetching. Check the browser console /
test-results/<test>/error-context.md. Common cause: the API is not running
on :3001 or the seed wasn't applied after a `docker compose down -v`.

### 4.4 Realtime updates don't arrive in other browsers

- Verify the socket handshake hits the API directly, not Next.js rewrites
  (WS upgrades don't survive the rewrite). The client uses
  `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`).
- Check the gateway logs for `ws auth failed` — usually a stale JWT.
- The event name is `application.change` with `type: 'moved'|'created'` —
  matching that contract on the client is mandatory.

### 4.5 Account switcher shows all accounts as the same region

Server-side the account directory stores `region`. If a membership row
exists in `global_db` but no matching `accounts` row exists in the regional
db, `GET /accounts/:id` returns `region` from the directory but
region-scoped reads will 404. Re-run `make seed` to re-upsert regional
rows.

---

## 5. Test discipline

The repo is developed under strict iterative TDD. Any change that touches
behaviour must:

1. Update / add the test first (Jest for services, Playwright for flows).
2. Run `pnpm --filter @oat/api test` → 22 green.
3. Run `pnpm --filter @oat/web exec playwright test` → 4 green.
4. `git commit` + `git push` in the same slice; no batched-multi-feature commits.

---

## 6. CI

`.github/workflows/ci.yml` runs on every push / PR:

- `lint-and-typecheck` — ESLint + `tsc --noEmit` across workspaces.
- `api-tests` — spins up Postgres + Redis, creates 4 logical DBs,
  migrates, runs Jest integration suites.
- `e2e-tests` — same infra, seeds, boots compiled API + `next start`,
  waits on both, runs Playwright (chromium) with `--with-deps`. On failure,
  uploads `test-results`, `playwright-report`, and API/web logs.

Keep failing CI artifacts — they contain traces and videos that reproduce
the failure locally via `playwright show-trace <trace.zip>`.
