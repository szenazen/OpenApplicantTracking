# Kafka / Redpanda governance (OpenATS)

Operational conventions for **async messaging** using the **Kafka API** (Redpanda in local compose). HTTP remains the primary strangler path; events supplement **domain notifications** and future consumers.

## Topic naming

| Pattern | Owner | Example |
|--------|--------|---------|
| `oat.domain.<bounded-context>` | Declaring service / platform team | `oat.domain.pipeline` — pipeline slice ([`PIPELINE_EVENTS_TOPIC`](../services/pipeline-service/src/domain-events/domain-events.service.ts)) |
| `oat.domain.smoke` | Dev / platform (kafka-ping) | Connectivity smoke ([`services/kafka-ping`](../services/kafka-ping/README.md)) |

**Rules:**

- Prefix **`oat.domain.`** for application domain events (avoids collision with infrastructure topics).
- New topics require an **owning service** named in code (constant or config); document the topic in this file when adding producers outside pipeline-service.

## Producer responsibilities (`pipeline-service`)

[`DomainEventsService`](../services/pipeline-service/src/domain-events/domain-events.service.ts) publishes when `KAFKA_BROKERS` is set:

- **Partition key:** `accountId` (stable routing per tenant).
- **Envelope:** JSON with `v`, `service`, `type`, `accountId`, optional `pipelineId` / `payload`, and `at` (ISO timestamp).

Producers **must** stay backward-compatible (`v` field) when extending payloads.

## Consumer responsibilities (future / other services)

Until dedicated consumers exist:

- Treat messages as **at-least-once** from the broker’s perspective: **idempotent** handlers (dedupe by `(type, accountId, pipelineId?, business-id, at)` or a stable event id once introduced).
- **Retry:** bounded exponential backoff; surface poison messages after N failures.
- **DLQ:** use a companion topic **`oat.domain.<context>.dlq`** (or `{topic}.dlq`) when implementing production consumers — move raw payload + error metadata; alert on DLQ depth.

## Alignment with deployment

See [deployment-modes.md](./deployment-modes.md) (**Async events**). Brokers are optional for monolith-only development; edge overlay enables Redpanda and `kafka-ping`.

## Checklist (new consumer)

1. Topic name registered above; owner on-call declared.
2. Consumer group id **`oat.<service>.<purpose>`** (one purpose per group).
3. Idempotency strategy documented in the service README.
4. Runbook: retry limits, DLQ drain, and lag dashboards (when production).
