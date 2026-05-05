# Legacy nginx API gateway (optional)

This **nginx** image mirrored the first strangler edge: route Account paths to
`account-service` and the rest to `apps/api` on the host. The **default** edge
in this repo is now the **Web BFF** ([`../web-bff`](../web-bff)) — a Node
process that encodes the same rules in
[`../web-bff/src/routing.ts`](../web-bff/src/routing.ts) and is what
`docker-compose.microservices.yml` runs on **:3080**.

Use this nginx only if you need a file-based static proxy (e.g. to compare
behaviour) without running the BFF.

```bash
docker build -f services/api-gateway/Dockerfile -t oat-api-gateway .
# Map host :3081 → 80 in the container; point clients at 3081.
```

`nginx.conf` is kept in sync *conceptually* with `web-bff` routing; when
changing one, update the other.

**Mirrored paths (high level)**

| Traffic | nginx (`nginx.conf`) | Web BFF (`routing.ts`) |
|--------|----------------------|-------------------------|
| `/api/accounts/current/*`, `GET /api/accounts/:id`, `/api/invitations`, `GET/PUT/… /api/platform/accounts` (not POST) | `account_service` | `account` |
| `POST /api/accounts`, `POST /api/platform/accounts` | `monolith` | `monolith` |
| Prefix `/api/slice/auth` | `auth_service` | `auth` when `AUTH_SLICE_ENABLED` |
| `/realtime` (WebSocket / Socket.IO) | `monolith` | `monolith` |
| `GET /api/users/me` | *Optional* commented block → `user_service` | `user` when `USER_SLICE_ENABLED` |
| `/api/slice/pipeline`, `GET/HEAD /api/pipelines`, `GET /api/jobs(…)` | `monolith` (no URI rewrite in nginx) | `pipeline` when slice + `BFF_*` flags |
| Everything else under `/` | `monolith` | `monolith` |

**Legend:** nginx mirrors **account**, **invitation**, **platform list**, and **auth slice** only. **Pipeline / jobs public rewrites** and **`USER_SLICE`** routing exist **only** in the BFF (see comments in `nginx.conf`).

- Global **account-service**: `/api/accounts/current/*`, `GET /api/accounts/:id` (single segment), `/api/invitations`, `GET /api/platform/accounts`; `POST /api/platform/accounts` and `POST /api/accounts` → monolith.
- **Auth slice**: `GET|POST /api/slice/auth/*` (probe, `verify-access`) → **`auth-service:3020`** (`POST /api/slice/auth/verify-access`, etc.) — aligns with **`AUTH_SLICE_ENABLED`** behaviour on Web BFF; **session login/register remain on backup `apps/api`**, not auth-service.

**Not duplicated in nginx (use Web BFF on :3080):** `BFF_PIPELINES_TO_SLICE` / `BFF_JOBS_TO_SLICE` path rewrites, `USER_SLICE` `GET /api/users/me`; see comments in [`nginx.conf`](./nginx.conf).
