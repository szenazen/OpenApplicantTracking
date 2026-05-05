# Strangler implementation vs `ATS-design.drawio.xml`

This note maps the **target architecture** in [`ATS-design.drawio.xml`](./ATS-design.drawio.xml) to the **current repo** (Web BFF + extracted services + backup monolith). It is for migration tracking, not a promise that every box is a separate deployable yet.

## Aligned with the diagram

| Diagram concept | Repo reality |
|-----------------|--------------|
| **Web BFF** as the browser-facing edge (SSR / aggregation described in the diagram; we implement routing + proxy first) | [`services/web-bff`](../services/web-bff): path-based routing to services and backup API ([`routing.ts`](../services/web-bff/src/routing.ts)). |
| **Optional nginx** reference gateway | [`services/api-gateway/nginx.conf`](../services/api-gateway/nginx.conf): mirrors **account** + **invitation** splits and proxies **`/api/slice/auth/*`** → `auth-service` (port **3020** in Compose). Does **not** duplicate BFF-only rewrites (`/api/pipelines`, `GET /api/jobs`, `USER_SLICE` `GET /api/users/me` — commented pattern in config). See [ADR 0003](../docs/adr/0003-web-bff-edge-strangler.md). |
| **Auth Service** (login, tokens) | Pilot [`services/auth-service`](../services/auth-service): `/api/slice/auth/*` when enabled (e.g. **JWT cryptographic verify** `POST …/verify-access` — no DB); **login/register/session** remain on **`apps/api`** until full cut-over. |
| **User Service** (profile) | [`services/user-service`](../services/user-service): `GET /api/users/me` (global DB, JWT `sub`) when `USER_SLICE_ENABLED` + `USER_SERVICE_URL`; BFF aggregated health probes user `/health` when configured. |
| **Account & Membership** | [`services/account-service`](../services/account-service): accounts, members, invitations (global DB), BFF-routed. |
| **Pipeline Service** — CRUD pipelines, ordered statuses | [`services/pipeline-service`](../services/pipeline-service): pipelines REST + slice DB; BFF can rewrite `/api/pipelines` when `BFF_PIPELINES_TO_SLICE`. |
| **Regional ATS** data: **jobs**, **pipelines**, **applications** | Slice DB holds **candidates**, **applications** (Kanban cards after drain), **jobs** (list fields), **pipelines**; pipeline-service may call **account-service** to resolve job **owners** (active members). |
| **Service ownership** — own DB, no direct cross-DB reads | `pipeline-service` uses **only** `PIPELINE_SLICE_DATABASE_URL`; `account-service` uses global Prisma; **`apps/api`** owns regional DB until domains are fully split. |
| **Async: Kafka** | `pipeline-service` emits to `oat.domain.pipeline` when `KAFKA_BROKERS` is set ([`DomainEventsService`](../services/pipeline-service/src/domain-events/domain-events.service.ts)); diagram’s “Kafka (async com)” matches this direction. |
| **Realtime / Kanban live** | **Realtime Gateway** in the diagram → today **`/realtime`** is still proxied to **`apps/api`** (Socket.IO); separate gateway service not extracted yet. |

## Pilot / intentional compression (differs from diagram layout)

| Diagram | Today’s strangler choice | Target end state (per diagram) |
|---------|--------------------------|--------------------------------|
| **Job Service** and **Pipeline Service** as **separate** boxes under Regional ATS | **One** deployable `pipeline-service` owns a **single slice DB** (**jobs**, **pipelines**, **candidates**, **applications** when drained); BFF **`GET /api/jobs`** and **`GET /api/jobs/:id`** when `BFF_JOBS_TO_SLICE`. **Split** when job vs pipeline operational boundaries warrant it. | Two services, two stores; HTTP/events between them. |
| **Job Application Service** | **Read path** for Kanban cards can be served from the slice after **drain**; writes, comments, reactions still **`apps/api`**. | Dedicated service + APIs. |
| **Web BFF** description includes SSR shell, aggregation | BFF is **Fastify + `reply-from`**: reverse proxy and path rewrite, not Next SSR. **Next.js** remains **`apps/web`**. | Optional: move more aggregation into BFF or SSR as needed. |
| **Mobile BFF** | Not implemented. | Separate BFF when mobile ships. |
| **RBAC service** as separate global service | Account-scoped roles live in **global DB**; enforced via **`apps/api` [`AccountGuard`](../apps/api/src/common/account.guard.ts)** (membership + **region** pin) vs **`account-service` [`AccountContextGuard`](../services/account-service/src/common/account-context.guard.ts)** (membership only). No standalone RBAC service yet — see [ADR 0004](../docs/adr/0004-account-membership-rbac-boundary.md). | Extract when scope warrants. |

## How to use this file

- When adding a **new BFF route** or service, check the diagram for **ownership** (which DB and which service box).
- Prefer **new regional behavior** in an **owned service + owned DB** rather than growing **`apps/api`** as the default path (see [ADR 0003](../docs/adr/0003-web-bff-edge-strangler.md)). For **membership vs regional guard** rules, see [ADR 0004](../docs/adr/0004-account-membership-rbac-boundary.md).
- **Split `pipeline-service`** when job and application domains are ready to match the diagram’s **Job Service** / **Job Application Service** boundaries.
