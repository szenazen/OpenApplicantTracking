# ADR 0006: Splitting Job Service from Pipeline Service

## Status

Proposed

## Context

The target diagram in **`design/ATS-design.drawio.xml`** shows **Job Service** and **Pipeline Service** as **separate** regional components. In the repo, **one** **`services/pipeline-service`** owns a **single slice database** with **jobs**, **pipelines**, **candidates**, and **applications** (after drain), with the Web BFF optionally routing **`GET /api/jobs`** and public pipeline reads to the slice ([`design/strangler-vs-ats-diagram.md`](../../design/strangler-vs-ats-diagram.md)).

That **compression** reduces operational surface area early; it does **not** forbid a future split when boundaries clarify.

## Decision

1. **Stay combined (defer split)** until **at least one** of the following holds:
   - **Ownership:** distinct teams or release trains need **independent deploy** and **blast-radius isolation** for job catalog vs pipeline/workflow lifecycle.
   - **Scale / SLO:** slice DB or process hotspots are **attributed** to one domain (e.g. job search vs pipeline CRUD) and **cannot** be cost-effectively tuned as one service.
   - **Data lifecycle:** **job data** must move to a **different retention / residency** tier than pipeline definitions, or **cross-region** job APIs are required while pipelines stay regional.
2. **When splitting:**
   - **Two databases** (or clearly separated schemas with **no** cross-DB reads): **job-service** owns job catalog + job-scoped read models; **pipeline-service** owns pipelines, statuses, ordering, and workflow triggers.
   - **Integration** via **HTTP** for synchronous calls and **events** (e.g. Kafka topics) for async: job created/updated → pipeline consumers; pipeline events must not require transactional coupling across services.
   - **BFF:** path-based routing in [`services/web-bff/src/routing.ts`](../../services/web-bff/src/routing.ts) (and nginx parity only for non-rewrite paths per ADR 0003) **must** be updated so browsers keep **one origin**; **no** raw cross-service chaining from the browser.
3. **Deferral is acceptable:** Operating one **`pipeline-service`** with one slice DB remains the **default** until the criteria bite; **document** the decision here and in the strangler diagram rather than premature service count growth.

## Consequences

- **Positive:** Avoids extra services, repos, and migrations before the domain boundary is painful.
- **Risk accepted:** **mixed ownership** of “job vs pipeline” in one codebase until split; refactors before split should **respect future seams** (modules, bounded contexts).
- **Tracking:** [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md) pilot compression table links here.

## Related

- [ADR 0003 — Web BFF edge strangler](./0003-web-bff-edge-strangler.md)
