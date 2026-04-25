# Web BFF

Node **Web BFF** for OpenApplicantTracking — the default edge in
[`../README.md`](../README.md#unified-api-local-prod-like--recommended-for-microservice-testing)
that matches the “Web BFF” layer in
[`../../design/ATS-design.drawio.xml`](../../design/ATS-design.drawio.xml).

- **Routing:** [`src/routing.ts`](./src/routing.ts) (strangler: `account-service` vs `apps/api` monolith; optional `PIPELINE_SLICE_*` / `AUTH_SLICE_*` to `/api/slice/...` upstreams). When `BFF_PIPELINES_TO_SLICE=true` and `PIPELINE_SERVICE_URL` is set, **`/api/pipelines`** is rewritten to pipeline-service (same JSON; requires `x-account-id`). See [`../../docs/qa-pipeline-slice.md`](../../docs/qa-pipeline-slice.md).
- **Aggregation (ops):** `GET /api/bff/aggregated-health` — parallel health checks; optional `KAFKA_PING_URL` in env (see [aggregated-health.ts](./src/aggregated-health.ts)).
- **Tests:** `pnpm test`
- **Run (host):** `MONOLITH_URL=… ACCOUNT_SERVICE_URL=… pnpm dev` (default **:3080**).
- **Docker:** [`Dockerfile`](./Dockerfile) from repository root.

The modular monolith in [`apps/api`](../../apps/api) is unchanged and remains the parallel reference implementation; this service only **forwards** traffic by rule.
