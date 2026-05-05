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

- Global **account-service**: `/api/accounts/current/*`, `GET /api/accounts/:id` (single segment), `/api/invitations`, `GET /api/platform/accounts`; `POST /api/platform/accounts` and `POST /api/accounts` → monolith.
- **Auth slice**: `GET|POST /api/slice/auth/*` (probe, `verify-access`) → **`auth-service:3020`** (`POST /api/slice/auth/verify-access`, etc.) — aligns with **`AUTH_SLICE_ENABLED`** behaviour on Web BFF; **session login/register remain on backup `apps/api`**, not auth-service.

**Not duplicated in nginx (use Web BFF on :3080):** `BFF_PIPELINES_TO_SLICE` / `BFF_JOBS_TO_SLICE` path rewrites, `USER_SLICE` `GET /api/users/me`; see comments in [`nginx.conf`](./nginx.conf).
