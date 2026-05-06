# ADR 0009: Skills catalog service (global control plane) — Proposed strangler framing

## Status

Proposed

## Context

The target architecture includes **global Skills** semantics (controlled vocabulary, normalization) versus **regional reads** tied to tenants and pipelines. Today skills-like data may live partly in **`apps/api`** schemas; no standalone **Skills catalog** deployment exists in this repository.

This ADR is a **narrow framing stub** only (see backlog **TASK-SKILLS-CATALOG-014**). Full APIs and migrations are explicitly **out of scope** until pipeline/auth slices stabilize.

## Decision (proposal)

1. **Ownership:** treat **canonical skill definitions** as a **global control-plane** concern; **instances on candidates/jobs** remain owned by regional stores / entities that reference stable skill IDs or slugs.
2. **Routing:** eventual read API is served **behind the Web BFF** or internal services — not browser-direct to a future cluster without ADR/sign-off ([ADR 0003](./0003-web-bff-edge-strangler.md)).
3. **Migration ladder:** strangler probes (read-first) ahead of writes; coordinated with [.agent/prd/prd.md](../../.agent/prd/prd.md) when product prioritizes taxonomy depth.

## Non-goals

- Choosing search technology (defer to discovery or [ADR 0008](./0008-search-service-placement-research.md)).
- Implementing **`skills-service`** in this wave.

## Consequences

- **Positive:** Clear placeholder for backlog ordering and tenancy boundaries.
- **Negative:** Skills UX may remain **DB-bound** longer until extraction.

## Related

- [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md)
