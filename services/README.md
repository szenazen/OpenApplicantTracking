# Microservices migration (strangler pattern)

The original system design targets **separate deployable services** (Account & membership, RBAC, Pipeline, …). The main app remains a **modular monolith** at [`apps/api`](../apps/api) so day-to-day development is unchanged.

This directory holds **extracted services** and the **Web BFF** that implement slices of the design. [`apps/api`](../apps/api) remains the **parallel modular monolith** (backup + day-to-day dev). Traffic is migrated gradually: the monolith keeps owning routes until the BFF forwards specific paths to a service.

## Current extracts

| Service | Port (local) | Responsibility | Status |
|--------|---------------|----------------|--------|
| [`web-bff`](./web-bff) | `3080` | **Web BFF** (design: single browser/edge entry): routes account slice → account-service, default → monolith on host (`:3001`) | Default edge |
| [`api-gateway`](./api-gateway) | (optional) | **Legacy** nginx: same routing rules in config; for comparison only — see [api-gateway/README.md](./api-gateway/README.md) | Optional |
| [`account-service`](./account-service) | `3010` | Global DB: accounts, members, invitations, `GET /api/platform/accounts` (JWT + `x-account-id`; platform JWT for `/platform/*`) | Strangler slice |
| [`pipeline-service`](./pipeline-service) | `3030` | **Own DB** (`pipeline-slice-pg` in overlay): new paths `/api/slice/pipeline/*` (BFF flag); does not touch `apps/api` | Pilot extract |
| [`auth-service`](./auth-service) | `3020` | New paths `/api/slice/auth/*` (BFF flag); no shared DB; future token/MFA | Pilot extract |
| [`kafka-ping`](./kafka-ping) | `3040` | Produce/consume on Redpanda (Kafka API) for async path smoke | Dev / wiring |

**Monolith vs edge:** [docs/deployment-modes.md](../docs/deployment-modes.md).

Responses include `_service: "…"` on several handlers so callers can verify routing during migration.

### Prisma schema sync

`account-service/prisma/schema.prisma` must stay aligned with [`apps/api/prisma/global.prisma`](../apps/api/prisma/global.prisma) (only the `generator client.output` line differs). Until we extract a shared `packages/db-global`, update both when the global model changes.

## Unified API (local, prod-like) — recommended for microservice testing

See [`design/ATS-design.drawio.xml`](../design/ATS-design.drawio.xml) (single **Web BFF** at the edge, services behind it). The **Web BFF** ([`web-bff/`](./web-bff)) implements routing in code ([`web-bff/src/routing.ts`](./web-bff/src/routing.ts), tested): account strangler paths → `account-service`; everything else (including `POST /api/accounts`, jobs, candidates, `POST /api/platform/accounts`, `/realtime`) → the monolith on **:3001**. Rules stay aligned with the optional [nginx](api-gateway/nginx.conf) reference.

1. **Infra + account-service + web-bff** (from repo root):

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build
   ```

2. **Monolith on the host** (expects port 3001 — same as always):

   ```bash
   pnpm --filter @oat/api dev
   ```

3. **Point the web app at the BFF** (single `NEXT_PUBLIC_API_URL`):

   ```bash
   export NEXT_PUBLIC_API_URL=http://localhost:3080
   export API_URL=http://localhost:3080
   pnpm --filter @oat/web dev
   ```

4. **Smoke the edge**: `curl -s http://localhost:3080/bff-health` and `curl -s http://localhost:3080/health` (monolith, once API is up).

**Production —** deploy the same path-based routing on your real edge (or run the BFF as a service); for compose-style URLs, set `MONOLITH_URL` / `ACCOUNT_SERVICE_URL` on the BFF instead of `host.docker.internal:3001` when the monolith is in-cluster. See [`web-bff/Dockerfile`](./web-bff/Dockerfile).

## Local testing: Docker Compose (account-service only)

Uses the **same** Postgres as dev (`docker-compose.yml`).

```bash
# Terminal 1 — infra + monolith as today (optional if DB already up)
docker compose up -d global-pg

# Terminal 2 — full overlay (gateway :3080 + account-service :3010) — see "Unified API" above
docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build
```

Legacy smoke (direct to account-service, no gateway):

```bash
curl -s http://localhost:3010/health
# JWT from normal login against the monolith (paths match monolith `/api/*`):
curl -s http://localhost:3010/api/accounts/<accountId> -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3010/api/accounts/current/members -H "Authorization: Bearer $TOKEN" -H "x-account-id: <accountId>"
curl -s http://localhost:3010/api/invitations -H "Authorization: Bearer $TOKEN" -H "x-account-id: <accountId>"
# Platform admin (user with platformAdmin=true in global DB), no x-account-id:
curl -s http://localhost:3010/api/platform/accounts -H "Authorization: Bearer $PLAT_JWT"
```

`POST /api/platform/accounts` (tenant provisioning with regional DB) remains on the monolith until a **pipeline/router** service exists.

Set `JWT_SECRET` in `.env` (≥32 chars) to match the monolith so tokens validate in both processes.

**Tests:** after `pnpm --filter @oat/api db:migrate` (shared global DB), run `pnpm --filter @oat/account-service db:generate && pnpm --filter @oat/account-service test` (unit, no DB) and `pnpm --filter @oat/account-service test:integration` (HTTP + Postgres). CI runs both in the `api-tests` job.

**Why Compose first:** faster feedback than Kubernetes, same images you promote to prod, no local VM. [`docker-compose.microservices.yml`](../docker-compose.microservices.yml) adds **`web-bff` (:3080)** and **`account-service` (:3010)**; the monolith still runs on the host.

**Web BFF tests:** `pnpm --filter @oat/web-bff test`

## Local testing: Kubernetes (kind / k3d)

Minikube is fine; **kind** and **k3d** are lighter on macOS/Linux and what many teams use in CI.

```bash
kind create cluster --name oat-dev
kubectl apply -k services/k8s/local/
# Build and load image into kind:
docker build -f services/account-service/Dockerfile -t oat-account-service:local .
kind load docker-image oat-account-service:local --name oat-dev
```

See [`k8s/local/README.md`](./k8s/local/README.md) for manifests and limitations (dev Postgres is still usually Docker Compose or a cloud DB).

## Edge (prod)

**Reference routing** is implemented in [`web-bff/src/routing.ts`](web-bff/src/routing.ts) and optionally mirrored in [`api-gateway/nginx.conf`](./api-gateway/nginx.conf). In production, run the **Web BFF** as a service or mirror the same path rules on **Envoy, Traefik, AWS ALB, or NGINX** with your internal service DNS.

## Roadmap (suggested order)

1. **Web BFF** + account reads/invites/members + `GET /platform/accounts` → next: more extracted services or `POST /platform/accounts` when a dedicated provisioning service exists.
2. Pipeline service (regional DB) behind router.
3. **Socket.IO:** add Redis adapter + separate realtime deployment (see `docs/adr/0002-realtime-kanban-via-socketio.md`).
4. Async domain events via existing Redpanda in `docker-compose.yml`.
