# ADR 0003: Web BFF as the default strangler edge

## Status

Accepted

## Context

The target architecture in `design/ATS-design.drawio.xml` places a **Web BFF** (and separate deployable services) in front of regional and global backends, with one browser/API entry and **service ownership** of data. [`apps/api`](../../apps/api) remains a **modular monolith** as **backup and reference** for unmigrated routes—not the primary long-term edge; the BFF + services are.

The first production-like edge in Compose was an **nginx** reverse proxy (`services/api-gateway`). Nginx is fine as an infrastructure primitive but does not encode the BFF in the same first-class, testable TypeScript module as the rest of the system.

## Decision

1. Add **`services/web-bff`**: a Fastify + `@fastify/reply-from` process that **routes** the same path rules as the previous nginx config (and keeps them in [`services/web-bff/src/routing.ts`](../../services/web-bff/src/routing.ts) with Jest tests).
2. Make **`web-bff` the default** service on **:3080** in `docker-compose.microservices.yml` instead of the nginx `api-gateway` container.
3. **`apps/api` stays in the repo** as the modular monolith **backup** implementation until domains are split out; extracted services are called through the BFF first. New work should prefer extending **services** and **routing**, not growing the monolith as the default path.
4. Keep **nginx** under `services/api-gateway` as an **optional** reference/backup proxy for teams that want file-based config; it must stay **conceptually aligned** with `routing.ts` when rules change.

## Consequences

- **Positive:** One edge component matches the “Web BFF” box in the diagram; routing is **unit- and integration-tested**; the strangler can grow (aggregation, auth shaping) in the BFF over time.
- **Positive:** `apps/api` remains a **backup** and contract reference without requiring a second duplicate stack; the **edge** is the default integration surface.
- **Negative:** Operations must run the BFF (Node) where before some teams might have run only nginx; resource profile is similar for local dev.
- **Follow-up:** Further extractions (Pipeline, Auth, etc.) add upstreams; `routing.ts` and tests grow. Async events (e.g. Kafka) remain a separate track from the HTTP edge.
