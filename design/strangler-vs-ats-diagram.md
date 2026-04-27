# Strangler implementation vs `ATS-design.drawio.xml`

This note maps the **target architecture** in [`ATS-design.drawio.xml`](./ATS-design.drawio.xml) to the **current repo** (Web BFF + extracted services + backup monolith). It is for migration tracking, not a promise that every box is a separate deployable yet.

## Aligned with the diagram

| Diagram concept | Repo reality |
|-----------------|--------------|
| **Web BFF** as the browser-facing edge (SSR / aggregation described in the diagram; we implement routing + proxy first) | [`services/web-bff`](../services/web-bff): path-based routing to services and backup API ([`routing.ts`](../services/web-bff/src/routing.ts)). |
| **Auth Service** (login, tokens) | Pilot [`services/auth-service`](../services/auth-service) behind `/api/slice/auth/*` when `AUTH_SLICE_ENABLED`; primary auth for the app still flows through **`apps/api`** until fully cut over. |
| **Account & Membership** | [`services/account-service`](../services/account-service): accounts, members, invitations (global DB), BFF-routed. |
| **Pipeline Service** — CRUD pipelines, ordered statuses | [`services/pipeline-service`](../services/pipeline-service): pipelines REST + slice DB; BFF can rewrite `/api/pipelines` when `BFF_PIPELINES_TO_SLICE`. |
| **Regional ATS** data: **jobs**, **pipelines**, **applications** cylinders | Slice DB holds **jobs** (list fields aligned with regional `Job` when drained), **pipelines**, **statuses**, **application** stubs; full Kanban/detail still **`apps/api`** until migrated. |
| **Service ownership** — own DB, no direct cross-DB reads | `pipeline-service` uses **only** `PIPELINE_SLICE_DATABASE_URL`; `account-service` uses global Prisma; **`apps/api`** owns regional DB until domains are fully split. |
| **Async: Kafka** | `pipeline-service` emits to `oat.domain.pipeline` when `KAFKA_BROKERS` is set ([`DomainEventsService`](../services/pipeline-service/src/domain-events/domain-events.service.ts)); diagram’s “Kafka (async com)” matches this direction. |
| **Realtime / Kanban live** | **Realtime Gateway** in the diagram → today **`/realtime`** is still proxied to **`apps/api`** (Socket.IO); separate gateway service not extracted yet. |

## Pilot / intentional compression (differs from diagram layout)

| Diagram | Today’s strangler choice | Target end state (per diagram) |
|---------|--------------------------|--------------------------------|
| **Job Service** and **Pipeline Service** as **separate** boxes under Regional ATS | **One** deployable `pipeline-service` owns a **single slice DB** that includes **minimal `Job` rows** plus pipelines + statuses, and serves **`GET /api/jobs`** (list only) when `BFF_JOBS_TO_SLICE`. Reduces coordination during the pilot; **split into a dedicated Job Service + DB** when job CRUD and Kanban fully migrate. | Two services, two stores; HTTP/events between them. |
| **Job Application Service** | Not extracted; applications live in **`apps/api`** regional DB; slice only has **stub** `Application` rows if drained for parity. | Dedicated service + APIs. |
| **Web BFF** description includes SSR shell, aggregation | BFF is **Fastify + `reply-from`**: reverse proxy and path rewrite, not Next SSR. **Next.js** remains **`apps/web`**. | Optional: move more aggregation into BFF or SSR as needed. |
| **Mobile BFF** | Not implemented. | Separate BFF when mobile ships. |
| **RBAC service** as separate global service | RBAC enforcement largely in **`apps/api`** and account flows; no standalone RBAC microservice in this repo yet. | Extract when scope warrants. |

## How to use this file

- When adding a **new BFF route** or service, check the diagram for **ownership** (which DB and which service box).
- Prefer **new regional behavior** in an **owned service + owned DB** rather than growing **`apps/api`** as the default path (see [ADR 0003](../docs/adr/0003-web-bff-edge-strangler.md)).
- **Split `pipeline-service`** when job and application domains are ready to match the diagram’s **Job Service** / **Job Application Service** boundaries.
