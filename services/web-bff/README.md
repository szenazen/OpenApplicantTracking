# Web BFF

Node **Web BFF** for OpenApplicantTracking — the default edge in
[`../README.md`](../README.md#unified-api-local-prod-like--recommended-for-microservice-testing)
that matches the “Web BFF” layer in
[`../../design/ATS-design.drawio.xml`](../../design/ATS-design.drawio.xml).

- **Routing:** [`src/routing.ts`](./src/routing.ts) (strangler: `account-service` vs `apps/api` monolith on the host).
- **Tests:** `pnpm test` (unit + small integration proxy test).
- **Run (host):** `MONOLITH_URL=http://127.0.0.1:3001 ACCOUNT_SERVICE_URL=http://127.0.0.1:3010 pnpm dev` (listens on **:3080** by default).
- **Docker:** [`Dockerfile`](./Dockerfile) from repository root.

The modular monolith in [`apps/api`](../../apps/api) is unchanged and remains the parallel reference implementation; this service only **forwards** traffic by rule.
