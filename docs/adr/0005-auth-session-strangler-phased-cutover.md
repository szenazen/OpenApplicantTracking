# ADR 0005: Auth session strangler — phased cutover to auth-service

## Status

Accepted

## Record

- **2026-05-06:** Accepted for strangler execution on `feat/agent-harness-wave` — phased cutover, shared `JWT_SECRET`, BFF-flag rollback, and non-goals (MFA, etc.) are sufficient to start **TASK-AUTH-SESSION-SLICE-010** once this ADR is **on `main`**.

## Context

Today **login, registration, refresh, and session persistence** live in **`apps/api`** (modular monolith). The pilot **`services/auth-service`** exposes **`/api/slice/auth/*`** for **stateless** operations—notably **`POST /api/slice/auth/verify-access`**—without a monolith DB ([`services/auth-service/README.md`](../../services/auth-service/README.md)).

The **Web BFF** already routes the auth slice when **`AUTH_SLICE_ENABLED`** and **`AUTH_SERVICE_URL`** are set ([`services/web-bff/src/routing.ts`](../../services/web-bff/src/routing.ts)); the optional **nginx** gateway mirrors **`/api/slice/auth/*`** only, not BFF-only rewrites ([ADR 0003](./0003-web-bff-edge-strangler.md)).

We need a **controlled strangler** for **session-bearing** auth (cookies / refresh tokens / session store) so we do not dual-write indefinitely or break JWT consumers (`apps/web`, BFF, regional APIs).

## Decision

1. **Phased cutover (strangler), not big-bang.** Each phase adds or moves **one family of routes** behind **`AUTH_SLICE_ENABLED`** (and **additional env flags** if needed, e.g. per-route pilots), with **monolith remaining the rollback target**.
2. **Phase 0 (current):** **`verify-access`** (and probe) on auth-service; all **interactive login/session** traffic remains **`apps/api`**.
3. **Phase 1 (next implementation tranche):** Pilot **access-token refresh** (and optionally **login**) on auth-service **only** when a **BFF flag** routes those paths to the slice; monolith implementations stay in place behind a **disabled** flag until soak completes.
4. **JWT compatibility during overlap:** **`JWT_SECRET`** (and compatible signing algorithm / TTL conventions) **shared** between **`apps/api`** and **`auth-service`** so issued tokens remain valid for both paths; claims and **`sub`** semantics stay aligned with existing guards.
5. **Rollback:** Turn off BFF routing flags (and optional auth-service feature flags); traffic returns to **`apps/api`** without redeploying clients. Document **order**: disable edge routing first, then optional service scale-down.
6. **Session store:** Any **server-side session** moved to auth-service must be **owned** by that service (or an explicitly named backing store); **no** cross-DB reads from monolith to auth DB for hot paths.

## BFF and edge flags

- **`AUTH_SLICE_ENABLED`:** routes **`/api/slice/auth/*`** to auth-service (existing).
- **`AUTH_LOGIN_SHIM`:** together with the above, routes **`POST /api/slice/auth/login`** to auth-service, which forwards JSON to **`MONOLITH_URL`** `POST /api/auth/login` ([`services/auth-service/README.md`](../../services/auth-service/README.md)). If **`AUTH_LOGIN_SHIM`** is unset/false, Web BFF sends that request to **`apps/api`** via path rewrite to **`/api/auth/login`** ([`services/web-bff/src/routing.ts`](../../services/web-bff/src/routing.ts)).
- **Future flags** (names TBD in implementation task): narrow **login / refresh / logout** path families so pilots can enable one without enabling all. **Nginx** reference gateway continues to mirror **only** `/api/slice/auth/*`; **BFF** owns conditional rewrites for public monolith paths if strangler requires them (per ADR 0003 parity rules).

## Non-goals (this ADR / phase)

- **MFA / WebAuthn / step-up auth** — out of scope until product/security asks; remain on monolith or a later ADR.
- **User profile `ACTIVE` / suspension checks** in **`verify-access`** — remains consistent with current pilot (may stay in API / user slice).
- **Replacing Next.js session handling** wholesale — only what is required for the pilot paths above.

## Consequences

- **Positive:** Clear migration ladder; rollback is configuration-first; JWT stays a stable contract for regional and BFF code.
- **Negative:** Temporary **dual maintenance** of parallel auth handlers during pilots; must guard against **split-brain** session stores without strict feature flags.
- **Tracking:** [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md) Auth Service row; implementation follows **TASK-AUTH-SESSION-SLICE-010** (queue).

## Related

- [ADR 0003 — Web BFF edge strangler](./0003-web-bff-edge-strangler.md)
- [ADR 0004 — Account membership / RBAC boundary](./0004-account-membership-rbac-boundary.md)
