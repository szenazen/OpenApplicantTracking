# API gateway (nginx)

Implements a **single HTTP entry** for the web app in line with
[`design/ATS-design.drawio.xml`](../../design/ATS-design.drawio.xml) (frontend-facing BFF/edge; Global Control Plane
services split from the monolith as strangler slices).

## Local Docker

Build from the **repository root**:

```bash
docker build -f services/api-gateway/Dockerfile -t oat-api-gateway:local .
```

With Compose (see root `docker-compose.microservices.yml`), the gateway listens on **`:3080`** and forwards:

| Path / rule | To |
|-------------|----|
| `GET` `/api/accounts/…` (incl. `current/*` and by id) | `account-service` |
| `/api/invitations` | `account-service` |
| `GET` `/api/platform/accounts` | `account-service` |
| `POST` `/api/platform/accounts` | monolith (regional provisioning) |
| `POST` `/api/accounts` (create tenant) | monolith |
| `/realtime` (Socket.IO) | monolith |
| everything else under `/` | monolith (default, **:3001 on the host** via `host.docker.internal`) |

The monolith is **not** in this image — run `pnpm --filter @oat/api dev` on the host, or in prod replace `host.docker.internal:3001` with your monolith `Service` DNS name.

## Production

Use the same path rules on **Envoy, Traefik, AWS ALB, or API Gateway** with two upstreams: **account-service** and **core API**. No cross-DB access between services; clients only see one API origin. Replace `host.docker.internal` with internal DNS (e.g. `oat-api.default.svc.cluster.local:3001`).

## Health

- `GET /gateway-health` — nginx only (suitable for a sidecar liveness check).
- `GET /health` — proxied to the monolith when using the default `location /` (full stack readiness).
