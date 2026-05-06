# Handoff

## Restart capsule

- **Branch:** `feat/agent-harness-wave` — synced with **`origin/main`** (2026-05-06); push after this session’s commit.
- **TASK-ADR-AUTH-MIGRATION-004**, **TASK-ADR-JOB-PIPELINE-SPLIT-005**, **TASK-ADR-REALTIME-GATEWAY-006** → **`done`:** ADRs **0005–0007** set **Accepted** + Record; merge PR to **`main`** for org default.
- **TASK-KAFKA-GOVERNANCE-016** → **`done`:** `docs/kafka-governance.md` + links from `deployment-modes.md`, `services/README.md`, `pipeline-service` README, strangler diagram.
- **TASK-SEARCH-ADR-018** → **`done`:** `docs/adr/0008-search-service-placement-research.md` (Proposed) + strangler **Search** row.
- **TASK-AUTH-SESSION-SLICE-010** — **`pending`:** ADR **0005** Accepted on branch — **do not implement** until **0005 is on `main`** (programme gate).

## Blockers / gaps

- Merge **wave branch** → **`main`** to unblock **010** / **011** implementation starts per queue handoffs.
- ADR **0008** remains **Proposed** (research); no search service build-out.

## Merges (already on `main`)

- `feat/nginx-auth-slice-parity` and `feat/adr-rbac-membership-boundary` merged (2026-05-05).
