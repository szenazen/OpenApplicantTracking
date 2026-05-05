# Auth service (pilot)

Pilot **Auth** slice: paths under `/api/slice/auth/*` (no monolith DB in this service).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/slice/auth/probe` | Liveness marker for strangler routing. |
| `POST` | `/api/slice/auth/verify-access` | Body `{ "accessToken": "<JWT>" }` — verifies **signature + expiry** with `JWT_SECRET` (same as `apps/api` / `.env`). Returns `{ valid, payload?, _service }`. Does **not** load the user from DB (`ACTIVE`/suspended checks stay in API or [`user-service`](../user-service)). |

BFF routes here when `AUTH_SLICE_ENABLED=1` and `AUTH_SERVICE_URL` is set.

**Env:** `JWT_SECRET` (required for meaningful verify; Compose overlay sets default), optionally `JWT_ACCESS_TTL` (default `15m`, used for JwtModule symmetry with API).

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).
