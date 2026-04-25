# Pipeline service (pilot)

Strangler extract with a **dedicated Postgres** (`PIPELINE_SLICE_DATABASE_URL` / `pipeline-slice-pg` in the microservices compose overlay).

- **Internal slice API (JWT + `x-account-id` matching path):** `/api/slice/pipeline/accounts/:accountId/pipelines` and related CRUD — same JSON shapes as the monolith’s `/api/pipelines` routes.
- **Liveness + DB:** `GET /api/slice/pipeline/verify` (no auth).
- **Monolith opt-in:** In `apps/api`, set `OAT_USE_PIPELINE_SLICE=true` and `PIPELINE_SLICE_BASE_URL` (default `http://127.0.0.1:3030`) so the existing `/api/pipelines` controller delegates to this service. When unset, the monolith continues to use **regional Prisma** only.
- **BFF** routes here when `PIPELINE_SLICE_ENABLED=1` and `PIPELINE_SERVICE_URL` is set.
- **Events:** If `KAFKA_BROKERS` is set, domain events are emitted to topic `oat.domain.pipeline` (e.g. Redpanda in compose).

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).
