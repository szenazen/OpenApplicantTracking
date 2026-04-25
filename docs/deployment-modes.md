# Monolith mode vs microservices (edge) mode

`apps/api` and `apps/web` are unchanged: you can run the **monolith** alone, or add the **optional** Docker overlay for extracted services + **Web BFF**.

## Monolith mode (default local dev)

- **API:** `pnpm --filter @oat/api dev` → **http://localhost:3001**
- **Web:** `pnpm --filter @oat/web dev` → **http://localhost:3002** (or your `WEB_PORT`)
- **Set:** `NEXT_PUBLIC_API_URL=http://localhost:3001` and `API_URL=http://localhost:3001` in `.env`

The browser talks **directly** to the Nest monolith. No BFF, no account-service, no new slice paths. This matches a single deployable and is the backup path when microservices are not running.

## Microservices (edge) mode

- **Base infra:** `docker compose up -d` (Postgres regions, **Redpanda**, Redis, …)
- **Overlay:** `docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build`  
  Brings up `account-service`, `pipeline-service` (own DB), `auth-service` (placeholder), `kafka-ping` (async smoke), and **`web-bff` on :3080**.
- **Monolith** still on the **host** at :3001 — same codebase as monolith mode.
- **Set:** `NEXT_PUBLIC_API_URL=http://localhost:3080` and `API_URL=http://localhost:3080` so the UI goes through the BFF.

The BFF routes **existing** public paths to the monolith or `account-service` (strangler). **New** paths under `/api/slice/pipeline/*` and `/api/slice/auth/*` are only active when the BFF has `PIPELINE_SLICE_ENABLED` / `AUTH_SLICE_ENABLED` (set in the microservices compose file). Those paths are **not** implemented in `apps/api`, so the monolith never conflicts.

- **Ops snapshot:** `GET http://localhost:3080/api/bff/aggregated-health` (BFF-aggregated checks of monolith, account, optional slices, optional Kafka smoke).

## Choosing a mode

| Concern | Monolith mode | Microservices mode |
|--------|---------------|---------------------|
| Simplest | Yes | No (more containers) |
| Strangler + slices | No | Yes |
| **apps/api** source edits | N/A (direct) | N/A (host process unchanged) |

### Optional: monolith delegates `/api/pipelines` to pipeline-service

By default, pipeline CRUD stays on **regional Prisma** inside `apps/api`. To point the same `/api/pipelines` routes at **pipeline-service** (without changing the web app or route paths), set on the monolith: `OAT_USE_PIPELINE_SLICE=true` and `PIPELINE_SLICE_BASE_URL` (e.g. `http://127.0.0.1:3030`). The monolith forwards `Authorization` and `x-account-id` to the slice. When this flag is off, behavior matches monolith-only mode.

## Async events

**Redpanda** (Kafka API) in `docker-compose.yml` is used by `kafka-ping` in the overlay to validate produce/consume. Future domain event publishers can use the same brokers without changing the monolith until you add optional hooks.
