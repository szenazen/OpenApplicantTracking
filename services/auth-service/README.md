# Auth service (pilot)

Pilot **Auth** slice: paths under `/api/slice/auth/*` (no monolith DB in this service).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/slice/auth/probe` | Liveness marker for strangler routing. |
| `POST` | `/api/slice/auth/login` | **Strangler shim:** when `AUTH_LOGIN_SHIM=1`, forwards JSON credentials to **`MONOLITH_URL`** `POST /api/auth/login` (`fetch`); same contract as `apps/api`. When the flag is off but the route is hit directly on this service, responds **503**. With `AUTH_SLICE_ENABLED` on the BFF, **`AUTH_LOGIN_SHIM` off** routes slice login to **`apps/api`** automatically (path rewrite). |
| `POST` | `/api/slice/auth/verify-access` | Body `{ "accessToken": "<JWT>" }` — verifies **signature + expiry** with `JWT_SECRET` (same as `apps/api` / `.env`). Returns `{ valid, payload?, _service }`. Does **not** load the user from DB (`ACTIVE`/suspended checks stay in API or [`user-service`](../user-service)). |

BFF routes `/api/slice/auth/*` here when `AUTH_SLICE_ENABLED=1` and `AUTH_SERVICE_URL` is set. **`POST .../login`** is sent to this service only when **`AUTH_LOGIN_SHIM`** is also **`1`/`true`**; otherwise the BFF proxies to **`MONOLITH_URL`** with `/api/auth/login`.

**Env:** `JWT_SECRET` (required for meaningful verify; Compose overlay sets default), optionally `JWT_ACCESS_TTL` (default `15m`, used for JwtModule symmetry with API). For the login shim: **`MONOLITH_URL`** (backup API base URL, default `http://127.0.0.1:3001`), **`AUTH_LOGIN_SHIM`** (`1`/`true` to enable forwarding from this service).

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).

**Strangler cutover** (login / refresh / sessions vs this pilot): [ADR 0005](../../docs/adr/0005-auth-session-strangler-phased-cutover.md).
