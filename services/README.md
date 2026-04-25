# Microservices migration (strangler pattern)

The original system design targets **separate deployable services** (Account & membership, RBAC, Pipeline, …). The main app remains a **modular monolith** at [`apps/api`](../apps/api) so day-to-day development is unchanged.

This directory holds **extracted services** that implement slices of the design. Traffic is migrated gradually: the monolith keeps owning routes until an edge gateway forwards specific paths to a service.

## Current extracts

| Service | Port (local) | Responsibility | Status |
|--------|---------------|----------------|--------|
| [`api-gateway`](./api-gateway) | `3080` | nginx: routes account slice → account-service, default → monolith (`:3001` on host) | Local / ref for prod |
| [`account-service`](./account-service) | `3010` | Global DB: accounts, members, invitations, `GET /api/platform/accounts` (JWT + `x-account-id`; platform JWT for `/platform/*`) | Strangler slice |

Responses include `_service: "account-service"` so callers can verify routing during migration.

### Prisma schema sync

`account-service/prisma/schema.prisma` must stay aligned with [`apps/api/prisma/global.prisma`](../apps/api/prisma/global.prisma) (only the `generator client.output` line differs). Until we extract a shared `packages/db-global`, update both when the global model changes.

## Unified API (local, prod-like) — recommended for microservice testing

See [`design/ATS-design.drawio.xml`](../design/ATS-design.drawio.xml) (single front door / BFF, services behind an edge). This repo’s **nginx** gateway ([`api-gateway/`](./api-gateway)) routes the **account** strangler paths to `account-service` and everything else (including `POST /api/accounts`, jobs, candidates, `POST /api/platform/accounts`, `/realtime`) to the monolith on **:3001**.

1. **Infra + account-service + api-gateway** (from repo root):

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.microservices.yml up -d --build
   ```

2. **Monolith on the host** (expects port 3001 — same as always):

   ```bash
   pnpm --filter @oat/api dev
   ```

3. **Point the web app at the gateway** (single `NEXT_PUBLIC_API_URL`):

   ```bash
   export NEXT_PUBLIC_API_URL=http://localhost:3080
   export API_URL=http://localhost:3080
   pnpm --filter @oat/web dev
   ```

4. **Smoke the edge**: `curl -s http://localhost:3080/gateway-health` and `curl -s http://localhost:3080/health` (monolith, once API is up).

**Production —** deploy the same path-based routing on your real edge (ALB, Envoy, etc.); replace `host.docker.internal:3001` in [`api-gateway/nginx.conf`](./api-gateway/nginx.conf) with the monolith service address.

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

**Why Compose first:** faster feedback than Kubernetes, same images you promote to prod, no local VM. [`docker-compose.microservices.yml`](../docker-compose.microservices.yml) adds **`api-gateway` (:3080)** and **`account-service` (:3010)**; the monolith still runs on the host.

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

## Edge gateway (prod)

**Reference routing** is implemented in [`api-gateway/nginx.conf`](./api-gateway/nginx.conf) (local). In production, mirror the same path rules on **Envoy, Traefik, AWS ALB, or NGINX** with your internal service DNS instead of `host.docker.internal:3001`.

## Roadmap (suggested order)

1. **Gateway** (nginx) + account reads/invites/members + `GET /platform/accounts` → next: more slices or `POST /platform/accounts` when regional service exists.
2. Pipeline service (regional DB) behind router.
3. **Socket.IO:** add Redis adapter + separate realtime deployment (see `docs/adr/0002-realtime-kanban-via-socketio.md`).
4. Async domain events via existing Redpanda in `docker-compose.yml`.
