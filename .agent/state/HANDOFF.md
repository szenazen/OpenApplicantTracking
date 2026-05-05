# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` (based on pushed `main` after strangler merges).
- **Done on branch:** ADR **0005** (auth strangler), **0006** (job vs pipeline split), **0007** (realtime gateway); **`design/strangler-vs-ats-diagram.md`** cross-links; **`services/api-gateway/README.md`** nginx ↔ BFF parity table; **`services/auth-service/README.md`** → ADR 0005; **`.agent/tasks.json`** — `TASK-ADR-AUTH-MIGRATION-004`, `TASK-ADR-JOB-PIPELINE-SPLIT-005`, `TASK-ADR-REALTIME-GATEWAY-006` → **review**; `TASK-WEB-BFF-HARDEN-008` → **review** with checklist evidence.
- **Remote:** Open PR **`feat/agent-harness-wave` → `main`**; ADRs are **Proposed** until reviewer accepts.
- **Next:** Human **accept** ADRs (status flip in doc + tasks **done**); then **TASK-AUTH-SESSION-SLICE-010** / **TASK-REALTIME-GATEWAY-011** per ADRs.

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged locally and **pushed** to `origin/main` (2026-05-05).
