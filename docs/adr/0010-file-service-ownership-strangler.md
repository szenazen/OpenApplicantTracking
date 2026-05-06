# ADR 0010: File service placement (uploads, presigned URLs, MinIO) — Proposed

## Status

Proposed

## Context

The stack uses object storage (e.g. **MinIO** in `docker-compose.yml`) and **`apps/api`** paths for uploads and signed URL issuance. A dedicated **File / asset** edge is depicted in **`design/ATS-design.drawio.xml`** but **not** extracted as its own runnable service yet.

Stub for backlog **TASK-FILE-SERVICE-015**.

## Decision (proposal)

1. **Strangler:** first document **today’s monolith-owned** flows (who mints URLs, bucket layout, TTL); then pilot **presigned PUT/GET** from a slim service **only** with BFF routing parity ([ADR 0003](./0003-web-bff-edge-strangler.md)).
2. **Security gate:** SSRF, path traversal, and bucket ACL review **before** any new public ingress (coordinate with **`security`** role).

## Non-goals

- Full CDN or virus-scan pipeline — future tasks.

## Consequences

- **Positive:** Establishes explicit ownership before duplicating MinIO policies at the edge.
- **Negative:** Temporary **dual maintenance** if both monolith and service mint URLs during pilot.

## Related

- [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md)
