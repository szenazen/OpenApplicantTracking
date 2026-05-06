# Realtime Gateway — tranche operational notes

Companion to [ADR 0007 — Realtime gateway extraction](./adr/0007-realtime-gateway-extraction.md) (**Accepted**).

## Current default (production-shaped local)

1. **`/realtime`** is proxied unchanged from the **Web BFF** (`services/web-bff/src/routing.ts`) and **`services/api-gateway/nginx.conf`** to **`apps/api`**, where the Nest Socket.IO gateway lives (`apps/api/src/modules/realtime`).
2. Behavioural contract (JWT handshake, Kanban rooms, subscribe guards): [ADR 0002 — Kanban realtime via Socket.IO](./adr/0002-realtime-kanban-via-socketio.md).

## Phased rollout (no big-bang)

| Phase | Intent | Operational checks |
| --- | --- | --- |
| **A** | Run gateway as a **separate process** (or image) but keep **the same public path**; point BFF/nginx upstream at the new host:port **behind a feature flag** if possible. | Smoke: browser connects, room join, one emit across two browser tabs; compare with monolith baseline. |
| **B** | Enable **Redis adapter** only when **>1** gateway replica is required. | Validate VPC / TLS to Redis; secret rotation runbook; load test fan-out latency. |
| **C (optional)** | Emit path moves toward **outbox / events** — only if in-process emit cost justifies the coupling break. | Consumer lag dashboards; idempotency per [kafka-governance.md](./kafka-governance.md). |

## Safety

- **Never** trust client-supplied account/job ids for room membership without **server-side** resolution (same rule as ADR 0002).
- Gate **production** path changes on **`TASK-REALTIME-GATEWAY-011`** + **Kanban e2e** (`apps/web/e2e/kanban-realtime.spec.ts` per ADR 0007).

## Rollback

Restore BFF/nginx upstream to **`MONOLITH_URL`** for **`/realtime`**; scale down experimental gateway. No client URL change if path stayed **`/realtime`**.
