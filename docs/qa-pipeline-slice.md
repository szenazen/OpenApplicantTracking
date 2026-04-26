# QA: pipeline slice (BFF + pipeline-service)

This path exercises **real** pipeline CRUD in `pipeline-service` through the **same** browser routes (`/api/pipelines`). The **BFF is the primary edge**; `apps/api` is only needed for **other** API surface (jobs, auth, etc.) until those move to services.

## Prerequisites

- **Same `JWT_SECRET`** everywhere: root `.env`, backup API (`apps/api`) when you run it, and pipeline/account containers. The overlay `docker-compose.microservices.yml` injects `JWT_SECRET` into `account-service` and `pipeline-service`.
- **Postgres** base stack: `docker compose up -d` (regions, global, Redis, Redpanda, …).
- **Regional/global data:** migrate + seed as usual (`pnpm db:migrate`, `pnpm db:seed`) — that tooling still lives on the backup API / shared DBs.

## One-command edge stack

```bash
pnpm compose:gateway
# or: docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build
```

This starts **web-bff** (:3080), **pipeline-service** (:3030, `prisma db push` on boot), **pipeline-slice-pg** (:5440), **account-service**, **auth-service**, **kafka-ping**, etc.

### BFF behaviour (QA default)

With `BFF_PIPELINES_TO_SLICE=1` (set in the overlay for `web-bff`):

- Requests to **`/api/pipelines`** are **rewritten** to `pipeline-service` at  
  `/api/slice/pipeline/accounts/{x-account-id}/pipelines…`
- The browser still sends **`Authorization`** and **`x-account-id`**; the BFF forwards them.
- **`/api/jobs` and all other non-sliced routes** go to the **backup API** (`apps/api`, `MONOLITH_URL`, default `http://host.docker.internal:3001`).

You **do not** need `OAT_USE_PIPELINE_SLICE` on `apps/api` when using this BFF mode (pipelines never hit the backup API).

### Run the backup API on the host (for jobs, auth, realtime, …)

```bash
pnpm --filter @oat/api dev
```

Keep `JWT_SECRET` in `.env` aligned with compose. When every route is behind a service, this step goes away.

### Point the web app at the BFF

```bash
export NEXT_PUBLIC_API_URL=http://localhost:3080
export API_URL=http://localhost:3080
pnpm --filter @oat/web dev
```

Sign in, pick an account, open **Settings → Pipelines** (or any screen that loads pipelines). Creates/updates hit the slice DB.

## Health checks

- BFF: `GET http://localhost:3080/bff-health`
- Aggregated: `GET http://localhost:3080/api/bff/aggregated-health` — includes `pipeline`, `pipelineDb` (slice DB touch), and optional Kafka ping.
- Pipeline only: `GET http://localhost:3030/api/slice/pipeline/verify` (no auth)

## Existing data: drain from regional DB to slice

If the account already has pipelines/jobs/applications in a **regional** DB, copy them into the slice store **with the same IDs** so job `pipelineId` and kanban data stay consistent:

```bash
export REGIONAL_SOURCE_URL="postgresql://oat:oat@localhost:5433/oat_us_east_1?schema=public"
export PIPELINE_SLICE_DATABASE_URL="postgresql://oat:oat@localhost:5440/oat_pipeline_slice?schema=public"
export ACCOUNT_ID="<your-account-cuid>"

pnpm --filter @oat/api db:generate
pnpm --filter @oat/pipeline-service db:generate
pnpm --filter @oat/api drain:pipelines-to-slice
```

Then use the UI with the BFF as above. **Backup** both databases before running in production-like environments.

## Optional: backup API-only delegation (no BFF)

If the browser talks to **`apps/api` on :3001** directly (no BFF), set:

- `OAT_USE_PIPELINE_SLICE=true`
- `PIPELINE_SLICE_BASE_URL=http://127.0.0.1:3030`

## Jobs / “matching” routes

- **Jobs** remain on the **monolith** (`/api/jobs`). The slice stores a **minimal** job row for pipeline invariants (e.g. stage delete rules); the **drain script** copies that subset.
- There is **no** separate BFF “matching” route: routing is by prefix (`/api/pipelines` → slice when `BFF_PIPELINES_TO_SLICE` is on; everything else default rules).

## Troubleshooting

| Symptom | Check |
|--------|--------|
| 401 on `/api/pipelines` | `JWT_SECRET` matches token issuer (monolith) and pipeline-service |
| 400 `x-account-id` | Browser sends account header; BFF public pipeline mode requires it |
| Monolith not reached | BFF `MONOLITH_URL` and `host.docker.internal` (Linux: add `extra_hosts` if needed) |
| Empty pipelines after drain | `ACCOUNT_ID`, `REGIONAL_SOURCE_URL` point at the right region DB |

For Linux Docker hosts, if `host.docker.internal` fails, set `MONOLITH_URL` to the host gateway IP in `web-bff` environment (see Docker docs for your version).
