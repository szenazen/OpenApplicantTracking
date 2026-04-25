# Pipeline service (pilot)

Strangler extract with a **dedicated Postgres** (`PIPELINE_SLICE_DATABASE_URL` / `pipeline-slice-pg` in the microservices compose overlay).

- **New API surface only:** `/api/slice/pipeline/verify` — not present in `apps/api`, so **monolith mode** is unaffected.
- BFF routes here when `PIPELINE_SLICE_ENABLED=1` and `PIPELINE_SERVICE_URL` is set.

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).
