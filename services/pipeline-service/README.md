# Pipeline service (pilot)

Strangler extract with a **dedicated Postgres** (`PIPELINE_SLICE_DATABASE_URL` / `pipeline-slice-pg` in the microservices compose overlay).

- **Internal slice API (JWT + `x-account-id` matching path):** `/api/slice/pipeline/accounts/:accountId/pipelines` and related CRUD — same JSON shapes as the monolith’s `/api/pipelines` routes.
- **Liveness + DB:** `GET /api/slice/pipeline/verify` (no auth).
- **Backup-API opt-in (no BFF):** In `apps/api`, `OAT_USE_PIPELINE_SLICE=true` + `PIPELINE_SLICE_BASE_URL` delegates `/api/pipelines` here. **Preferred:** Web BFF with `BFF_PIPELINES_TO_SLICE` so the browser never depends on `apps/api` for pipelines.
- **BFF** routes here when `PIPELINE_SLICE_ENABLED=1` and `PIPELINE_SERVICE_URL` is set.
- **Events:** If `KAFKA_BROKERS` is set, domain events are emitted to topic `oat.domain.pipeline` (e.g. Redpanda in compose).

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).
