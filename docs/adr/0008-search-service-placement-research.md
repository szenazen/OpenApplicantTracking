# ADR 0008: Search service placement — research

## Status

Proposed

## Context

The target diagram in **`design/ATS-design.drawio.xml`** includes search / indexing capability (often pictured as **Elasticsearch** or similar). Today, **ATS** search-like behaviour is satisfied by **`apps/api`** and relational queries; there is **no** dedicated search cluster in this repo.

## Decision (research)

1. **Defer a standalone Search Service** until **P0–regional slices** (pipeline, jobs, auth strangler, realtime gateway tranche) stabilize — cost and operational surface outweigh premature extraction.
2. **When product requires** full-text, faceted, or cross-entity search at scale, prefer **one regional search plane** (managed OpenSearch/Elasticsearch or equivalent) **behind the Web BFF** or an internal read API, not browser-direct.
3. **Data flow:** index from **outbox / domain events** where possible (align with [kafka-governance.md](../kafka-governance.md)); avoid dual-write from request path without idempotency.
4. **Ownership:** whichever service owns the **indexed entities** should own index mapping versioning; a future **read-only Search API** may wrap the cluster for stable contracts.

## Non-goals (this document)

- Choosing a specific vendor or cluster topology.
- Implementing index pipelines or migrations.

## Consequences

- **Positive:** Avoids running search infra before demand is clear.
- **Negative:** Some product search UX may stay **DB-bound** longer; plan a spike when PRD search requirements harden.

## Related

- [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md)
- [.agent/prd/prd.md](../../.agent/prd/prd.md)
