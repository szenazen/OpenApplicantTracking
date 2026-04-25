# Auth service (pilot)

Placeholder for a future **Auth** slice (tokens, MFA). **No shared DB** with the monolith in this pilot.

- **New paths:** `/api/slice/auth/probe` — not in `apps/api`.
- BFF routes here when `AUTH_SLICE_ENABLED=1` and `AUTH_SERVICE_URL` is set.

See [../README.md](../README.md) and [../../docs/deployment-modes.md](../../docs/deployment-modes.md).
