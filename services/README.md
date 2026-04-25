# Microservices migration (strangler pattern)

The original system design targets **separate deployable services** (Account & membership, RBAC, Pipeline, …). The main app remains a **modular monolith** at [`apps/api`](../apps/api) so day-to-day development is unchanged.

This directory holds **extracted services** that implement slices of the design. Traffic is migrated gradually: the monolith keeps owning routes until an edge gateway forwards specific paths to a service.

## Current extracts

| Service | Port (local) | Responsibility | Status |
|--------|---------------|----------------|--------|
| [`account-service`](./account-service) | `3010` | Global DB: accounts, members, invitations, `GET /api/platform/accounts` (JWT + `x-account-id`; platform JWT for `/platform/*`) | Strangler slice |

Responses include `_service: "account-service"` so callers can verify routing during migration.

### Prisma schema sync

`account-service/prisma/schema.prisma` must stay aligned with [`apps/api/prisma/global.prisma`](../apps/api/prisma/global.prisma) (only the `generator client.output` line differs). Until we extract a shared `packages/db-global`, update both when the global model changes.

## Local testing: Docker Compose (recommended)

Uses the **same** Postgres as dev (`docker-compose.yml`).

```bash
# Terminal 1 — infra + monolith as today (optional if DB already up)
docker compose up -d global-pg

# Terminal 2 — account microservice (overlay file)
docker compose -f docker-compose.yml -f docker-compose.microservices.yml up --build account-service
```

Smoke:

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

**Why Compose first:** faster feedback than Kubernetes, same images you promote to prod, no local VM. [`docker-compose.microservices.yml`](../docker-compose.microservices.yml) only adds `account-service`; it does not remove or replace `apps/api`.

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

## Edge gateway (next step)

When you strangler-route production traffic, put **Envoy, Traefik, or NGINX** in front of:

- **Monolith** — `/api/*` (default)
- **account-service** — e.g. `/api/accounts/*`, `/api/invitations`, `/api/platform/accounts` (GET only; route what this service implements)

The web app can keep using the monolith until you point `NEXT_PUBLIC_API_URL` (or a BFF) at the gateway.

## Roadmap (suggested order)

1. Account reads + invitations + membership + `GET /platform/accounts` → `POST /platform/accounts` (regional) or **gateway** next.
2. Pipeline service (regional DB) behind router.
3. **Socket.IO:** add Redis adapter + separate realtime deployment (see `docs/adr/0002-realtime-kanban-via-socketio.md`).
4. Async domain events via existing Redpanda in `docker-compose.yml`.
