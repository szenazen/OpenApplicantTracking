# ADR 0007: Realtime Gateway extraction (Socket.IO off monolith)

## Status

Proposed

## Context

[ADR 0002](./0002-realtime-kanban-via-socketio.md) defines **Socket.IO** on **`/realtime`**, **JWT in handshake**, **room** naming **`account:<id>:job:<id>`**, and **membership checks on subscribe**. Today the server lives in **`apps/api`** (Nest gateway module); the **Web BFF** routes **`/realtime`** to the **monolith** ([`services/web-bff/src/routing.ts`](../../services/web-bff/src/routing.ts)); nginx does the same ([`services/api-gateway/nginx.conf`](../../services/api-gateway/nginx.conf)).

The **diagram** target includes a **Realtime Gateway** distinct from the monolith for regional fan-out and scaling. Extracting it implies **browser connection ownership**, **horizontal scale**, and **cross-instance** broadcast—typically a **Redis adapter** for Socket.IO.

## Decision

1. **North star:** A **dedicated Realtime Gateway** service (or regional pair) terminates **browser WebSocket / Socket.IO** connections; **`apps/api`** remains **source of truth** for business rules until further strangler steps move emitters.
2. **Phased extraction:**
   - **Phase A:** Run gateway as **separate process** still **co-located** or **same release** as monolith if needed; BFF/nginx point **`/realtime`** at gateway **behind same public host** where possible.
   - **Phase B:** Introduce **Redis adapter** for Socket.IO when **>1 gateway instance** is required; document **VPC / TLS** boundaries and **secret** handling for Redis.
   - **Phase C (optional):** Move **emit** triggers from monolith to **outbox / events** so gateway consumes **domain events** instead of in-process calls—**only** when coupling cost justifies it.
3. **BFF vs gateway ownership:** The **Web BFF** remains the **HTTP edge** for API aggregation; **`/realtime`** is **either** proxied **transparently** to the gateway (current pattern, new upstream URL) **or** documented as **direct client → gateway** only if cookie/CORS policy allows—**default** stays **via BFF/nginx** for one origin during migration.
4. **Security:** Reuse **ADR 0002** handshake and **subscribe** membership rules; gateway **must re-verify JWT** and **must not** trust client-supplied account/job ids without server-side membership resolution.
5. **Relation to ADR 0002:** ADR 0002 remains the **behavioural contract** for Kanban realtime; this ADR covers **deployment topology** and **scaling** only.

## Consequences

- **Positive:** Scales realtime **independently** of monolith CPU; clearer **failure domain** for long-lived connections.
- **Negative:** More moving parts (**Redis**, gateway deploys); **must** regression-test **e2e Kanban** ([`apps/web/e2e/kanban-realtime.spec.ts`](../../apps/web/e2e/kanban-realtime.spec.ts)) on each phase.
- **Tracking:** [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md); implementation gated on **TASK-REALTIME-GATEWAY-011**.

## Related

- [ADR 0002 — Realtime Kanban via Socket.IO](./0002-realtime-kanban-via-socketio.md)
- [ADR 0003 — Web BFF edge strangler](./0003-web-bff-edge-strangler.md)
