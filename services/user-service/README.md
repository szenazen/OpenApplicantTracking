# User Service

Global user profile slice for OpenApplicantTracking.

- `GET /health`
- `GET /api/users/me` (JWT required)

Run locally:

```bash
pnpm --filter @oat/user-service dev
```

Required env vars:

- `GLOBAL_DATABASE_URL`
- `JWT_SECRET`
- `USER_SERVICE_PORT` (default `3050`)
