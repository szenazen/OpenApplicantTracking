# ADR 0004: Account membership and RBAC guard boundaries

## Status

Accepted

## Context

The target diagram includes a standalone **RBAC** capability. In this repo, **account-scoped** authorization is implemented as:

- **JWT authentication** (`AuthGuard('jwt')` / Passport) loading the **ACTIVE** user from the **global** database.
- **`apps/api` [`AccountGuard`](../../apps/api/src/common/account.guard.ts):** after validating `x-account-id` (or `accountId` query) and **ACTIVE** membership (global DB + role name), it calls **`RegionRouterService`** and sets **`req.ctx.region`** for regional data access.
- **`services/account-service` [`AccountContextGuard`](../../services/account-service/src/common/account-context.guard.ts):** same membership + **`req.ctx.role`** for **global-DB-only** account routes; it **does not** resolve region (slice stays off regional Prisma).
- **Job-level permissions** ([`JobPermissionsService`](../../apps/api/src/common/job-permissions.service.ts), job-members routes) remain **monolith-only** until an extraction is planned.

Strangler **BFF** routing can send **`/api/accounts/**`** traffic to **`account-service`** while **regional ATS** traffic still hits **`apps/api`**.

## Decision

1. **Do not** introduce a dedicated **RBAC microservice** in the current phase; keep membership and role names in the **global** datastore, enforced in-process via guards.
2. Treat **`apps/api` `AccountGuard`** as the **canonical** guard for any handler that must **pin region** or use **regional** Prisma after membership checks.
3. Treat **`account-service`** as the **home for account / membership / invitation HTTP** that needs **only** global DB (aligned with [`AccountsController`](../../services/account-service/src/accounts/accounts.controller.ts)); extend it for new **global** account-domain APIs rather than growing monolith routes **when BFF already targets the slice**.
4. **Job-level RBAC**, **platform admin** guards, and **search/report** controllers stay on **`apps/api`** until those domains move with their data ownership (see strangler diagram).
5. **Optional later:** a small **read-only** membership probe on `account-service` (e.g. role + status for a given `x-account-id`) is allowed **if** an edge component needs it without duplicating Prisma calls—**not** a prerequisite for current routing.

## Consequences

- **Positive:** Clear rule for engineers: **region + membership** → monolith guard path; **global account/members** → account-service guard path.
- **Positive:** Avoids duplicating `RegionRouterService` inside `account-service` until regional reads are intentionally moved.
- **Negative:** Two guard implementations must stay behavior-compatible for membership checks (status + role naming).
- **Tracking:** [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md) references this ADR for the **RBAC service** pilot row.

## Endpoint ownership (summary)

| Surface | Deployable | Notes |
|--------|------------|--------|
| **`/api/accounts`**, **`/api/accounts/current/*`**, **`/api/accounts/:id`**, **`/api/invitations*`**, **`/api/platform/accounts*`** (as routed by BFF) | **`account-service`** | Parity controllers under `/api`; [`AccountContextGuard`](../../services/account-service/src/common/account-context.guard.ts) only. |
| **Regional ATS:** jobs, candidates, applications, pipelines, search, comments, reactions, notes, activities, sourcing, home, reports, recommendations, notifications (members-scoped), job-members | **`apps/api`** | Typically **`AuthGuard` + `AccountGuard`**; [`AccountGuard`](../../apps/api/src/common/account.guard.ts) sets **region**. |
| **`/api/auth`**, session login/register | **`apps/api`** | Not auth-service until full cut-over (see ADR 0003 / auth-service README). |
| **`/api/slice/auth/*`** | **`auth-service`** (when enabled) | JWT verify probe only; no membership DB. |

Exact controller lists change over time; prefer **data ownership** (global vs regional DB) and **BFF [`routing.ts`](../../services/web-bff/src/routing.ts)** as the live source of which upstream answers a path.
