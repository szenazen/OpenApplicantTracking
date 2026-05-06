# ADR 0011: Tenant / platform account provisioning extraction — Proposed

## Status

Proposed

## Context

Regional **tenant provisioning** and **`POST /api/platform/accounts`** (or equivalents) imply **multi-DB provisioning**, routing metadata, and high blast radius. Today much of this lives at **`apps/api`** with **`services/account-service`** handling account-adjacent reads per earlier strangler work.

Stub for backlog **TASK-ACCOUNT-TENANT-PROVISION-017**.

## Decision (proposal)

1. **No implementation** until this ADR is **accepted** alongside account-service strangler diagrams and rollback plan.
2. **Coordination:** explicit handoff between **backup API**, **account-service**, and regional DB operators (see [.agent/tasks.json](../../.agent/tasks.json) context refs).

## Non-goals

- Automating SaaS signup at scale — product-scoped separately.

## Consequences

- **Positive:** Blocks risky “quiet” forks of provisioning logic.
- **Negative:** Provision UX improvements may serialize behind ADR throughput.

## Related

- [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md)
