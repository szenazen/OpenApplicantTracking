# Deployment modes: edge-first vs monolith backup

**Product direction:** the **Web BFF** (`services/web-bff` on **:3080**) plus **extracted services** (account, pipeline, …) are the **primary** HTTP edge. The Nest app in **`apps/api`** (**:3001**) is the **backup / reference** implementation: use it for routes not yet owned by a slice, for OpenAPI during development, or when you want a single process without the compose overlay.

---

## Edge mode (recommended local + prod-like)

- **Base infra:** `docker compose up -d` (Postgres regions, **Redpanda**, Redis, …)
- **Overlay:** `docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build`  
  Brings up **web-bff** (:3080), **account-service**, **pipeline-service**, **auth-service** (placeholder), **kafka-ping**, etc.
- **Backup API (`apps/api`):** in the microservices compose overlay this runs as **`backup-api`** on the Docker network (`MONOLITH_URL=http://backup-api:3001` for `web-bff`). Host port **3101** → container **3001** (Swagger: `http://localhost:3101/api/docs`). On first boot the image runs **`migrate-all`** with `USE_PRISMA_DB_PUSH=1` (schema sync without checked-in migration folders). Seed demo data once:  
  `docker compose -f docker-compose.yml -f docker-compose.microservices.yml exec backup-api pnpm exec tsx scripts/seed.ts`  
  To use a **host** process on :3001 instead, stop `backup-api` and set `MONOLITH_URL=http://host.docker.internal:3001` on `web-bff` (and restore `extra_hosts` if needed on Linux).

- **Browser:** `NEXT_PUBLIC_API_URL=http://localhost:3080` and `API_URL=http://localhost:3080` so all traffic goes through the BFF.

The BFF routes **extracted** paths to services (e.g. account membership, `/api/pipelines` when `BFF_PIPELINES_TO_SLICE=1`) and **everything else** to the backup API until those routes move. **New** paths under `/api/slice/pipeline/*` and `/api/slice/auth/*` are slice-only when the BFF flags are on.

- **Ops snapshot:** `GET http://localhost:3080/api/bff/aggregated-health` (BFF + account + optional pipeline DB + optional Kafka smoke + backup API when configured).

Pipeline QA details: [qa-pipeline-slice.md](./qa-pipeline-slice.md).

---

## Monolith-only mode (backup / simplest single process)

Use when you are **not** running the microservices overlay and want one API process only.

- **API:** `pnpm --filter @oat/api dev` → **http://localhost:3001**
- **Web:** `pnpm --filter @oat/web dev` → **http://localhost:3002** (or your `WEB_PORT`)
- **Set:** `NEXT_PUBLIC_API_URL=http://localhost:3001` and `API_URL=http://localhost:3001` in `.env`

The browser talks **directly** to `apps/api`. No BFF, no account-service, no slice paths. This is the **backup** path for a single deployable or offline work without Docker services.

---

## Choosing a mode

| Concern | Edge (BFF + slices) | Monolith-only (backup) |
|--------|---------------------|-------------------------|
| Matches target architecture | Yes | No |
| Fewest moving parts | No | Yes |
| Strangler + owned services | Yes | No |
| **`apps/api` required** | Only for unmigrated routes | Always |

### Optional: backup API delegates `/api/pipelines` to pipeline-service

If you call **`apps/api` on :3001 directly** (no BFF) but still want pipeline CRUD in `pipeline-service`, set: `OAT_USE_PIPELINE_SLICE=true` and `PIPELINE_SLICE_BASE_URL` (e.g. `http://127.0.0.1:3030`). Prefer the BFF path when possible: `BFF_PIPELINES_TO_SLICE=1` + `PIPELINE_SERVICE_URL` so the backup API is not in the loop for pipelines ([qa-pipeline-slice.md](./qa-pipeline-slice.md)).

---

## Async events

**Redpanda** (Kafka API) in `docker-compose.yml` is used by `kafka-ping` in the overlay and by services that publish domain events (e.g. pipeline-service when `KAFKA_BROKERS` is set). This does not require routing through `apps/api`.
