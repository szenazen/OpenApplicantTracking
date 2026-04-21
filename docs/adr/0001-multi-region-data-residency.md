# ADR 0001 — Multi-region data residency via per-region datasources

- **Status:** accepted
- **Date:** 2026-04
- **Deciders:** core maintainers

## Context

OpenApplicantTracking serves recruitment agencies whose clients operate under
different data-residency regimes (EU GDPR, UK DPA, Singapore PDPA, Australian
Privacy Act, …). A single user must be able to sign in once and switch
between **Accounts** whose candidate / application data is stored in the
**cloud region chosen by the account owner**.

Three shapes were considered:

1. **Single global database, `region` column.** Fast to build; fails residency
   compliance — all data co-locates with the primary.
2. **Separate deployments per region (no global plane).** Each region is a full
   standalone app. Forces duplicate users, breaks single sign-on, and makes
   cross-region reporting impossible.
3. **Hybrid: global control plane + regional data planes.** One global
   datasource for identity, accounts directory, RBAC, skills catalog. One
   regional datasource *per region* for the account-scoped data (jobs,
   pipelines, candidates, applications, audit). Requests are routed per
   account.

## Decision

Adopt **option 3 — the hybrid topology**. Implementation:

- Two Prisma schemas: `apps/api/prisma/global.prisma`, `apps/api/prisma/regional.prisma`.
- A `RegionRouterService` (`apps/api/src/infrastructure/region-router`) owns a
  `PrismaClient` per configured region, resolves the target client from the
  active account id (`x-account-id` header), and caches the account→region
  mapping.
- Every account-scoped request must pass through `AccountGuard` which loads
  the account from the global directory, enforces membership, and sets
  `req.regionalClient` for downstream handlers.
- The skills catalog is the one global resource that also needs to be fast
  from any region — seeded into a regional `skill_cache` table.
- Each region has its own Postgres in local dev (`docker-compose.yml` ports
  `5433..5437`) and its own RDS instance / Aurora cluster in AWS
  (`infra/terraform/envs/*`).

## Consequences

**Good**

- Residency is enforced by the shape of the system, not by discipline. A
  bug in a handler cannot accidentally leak EU candidate data to the US
  cluster — it simply has no connection to write it there.
- Adding a region is declarative: add `REGION_XXX_DATABASE_URL` to env, add
  a Terraform module call, redeploy. The router picks it up.
- Per-region scaling / backup / encryption keys are natural.
- The integration test `test/accounts.spec.ts` asserts that data written in
  one region is not visible from another region — proving isolation.

**Bad / accepted costs**

- Cross-region analytics require a separate pipeline (CDC → warehouse).
  Not solved in-repo; explicitly out of scope for v1.
- Two Prisma schemas mean two generated clients and two migration targets
  (`apps/api/scripts/migrate-all.ts` iterates them). Small DX tax.
- Seed and tests must know which region each account lives in.

## Alternatives considered

- **Citus / CockroachDB with region-pinned rows.** Rejected: auditors prefer
  physical separation; adds a single-vendor dependency.
- **Region-per-service (full cell architecture).** Overkill for the current
  stage; revisit post-1.0 when workload justifies it.

## References

- `apps/api/src/infrastructure/region-router/region-router.service.ts`
- `apps/api/src/common/account.guard.ts`
- `apps/api/test/accounts.spec.ts`
- `docs/data-model.md`
