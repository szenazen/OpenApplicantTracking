# Data Model

OpenApplicantTracking uses **two physically separate datasources** to satisfy the multi-region residency requirement:

1. **Global control plane** — one logical Postgres cluster (replicated across regions in prod). Holds identity, account directory, RBAC catalog, skills source-of-truth. Schema: [`apps/api/prisma/global.prisma`](../apps/api/prisma/global.prisma).
2. **Regional plane** — one Postgres cluster per AWS region (`us-east-1`, `eu-west-1`, `ap-southeast-1`, `ap-northeast-1`, `ap-southeast-2`). Holds the account's business data (jobs, pipelines, candidates, applications, files, audit). Schema: [`apps/api/prisma/regional.prisma`](../apps/api/prisma/regional.prisma).

## Why split?

| Concern | Solution |
| --- | --- |
| A user must log in once and see all their accounts — even when accounts live in different regions. | Identity lives globally. Tokens carry `user_id`, not `account_id`. |
| Candidate data must stay in the region the customer chose. | `accounts_directory.region` maps `account_id → region`. A `RegionRouter` picks the right regional Prisma client per request. |
| Skills must be identical across regions. | Single `skills` table in global; a `skill_cache` mirror in each regional DB keeps reads fast and latency-free. Sync via Kafka events. |
| Auditability of cross-region access. | Auth events → global `sessions` table. Domain audit → regional `audit_events` (partitioned by account). |

## Global schema (highlights)

```
users ─┬─< memberships >─┬─ accounts_directory
       │                 │
       └─< sessions      └─< invitations
auth_credentials (1:1 users)

roles ─< role_permissions >─ permissions
roles ─< memberships
roles ─< invitations

skills  (source of truth, replicated to regions)
```

## Regional schema (highlights)

```
accounts ─┬─< jobs ─────────────< applications >──── candidates
          │                               │
          ├─< pipelines ─< pipeline_statuses ──┘
          │                               (current status ref)
          ├─< files
          └─< audit_events

applications ─< application_transitions   (full pipeline history)

skill_cache   (eventually consistent from global.skills)
```

## Key invariants

- **Tenant key**: every regional row carries `accountId`. A NestJS `TenantGuard` blocks any query where `membership.accountId ≠ request.accountId`.
- **One candidate per account**: `@@unique([accountId, email])` on `candidates`.
- **One application per (candidate, job)**: `@@unique([candidateId, jobId])` on `applications`.
- **Ordered statuses**: `@@unique([pipelineId, position])` on `pipeline_statuses` so drag-reorder can swap positions atomically.
- **Deterministic kanban ordering**: `@@index([jobId, currentStatusId, position])` → O(log n) column fetch.

## Why Prisma (two schemas)?

Prisma does not natively support multiple datasources in one schema. We use two separate schema files + two generated clients (`@prisma/global` and `@prisma/regional`). The regional client is instantiated **N times** at boot, one per configured `REGION_*_DATABASE_URL`, stored in a `Map<Region, PrismaClient>` in [`src/infrastructure/region-router/`](../apps/api/src/infrastructure/region-router) (created in a later slice).

## Adding a new region

1. Provision a Postgres in the target region (Terraform module `rds-regional`).
2. Add `REGION_<CODE>_DATABASE_URL` to the API's env.
3. Run `pnpm db:migrate` (applies `regional.prisma` to the new DB).
4. The `Region` enum in `global.prisma` gains a value via migration.
5. Deploy the regional API workload via Helm (values-`<region>`.yaml).

No code changes required — the router discovers regions from env at boot.
