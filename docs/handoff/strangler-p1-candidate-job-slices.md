# Handoff: Regional Candidate + Job Application slices (P1)

Narrow planning note for queue items **TASK-CANDIDATE-SLICE-P1-012** and **TASK-JOB-APP-SLICE-P1-013**. No pipeline code in this wave.

## Shared constraints

- **Reads first:** align **Kanban card** and **job application** read paths with [design/strangler-vs-ats-diagram.md](../../design/strangler-vs-ats-diagram.md) and **ADR 0006** ([Job vs pipeline split](../adr/0006-job-service-vs-pipeline-service-split.md)) before moving writes.
- **BFF flags:** any new public path must stay behind **Web BFF** routing flags (pattern in [ADR 0003](../adr/0003-web-bff-edge-strangler.md)); **no** breaking change to `apps/web` without an explicit flag.
- **Events:** if Kafka is introduced on the read path, document topic + idempotency against [kafka-governance.md](../kafka-governance.md).

## Sequencing

1. Freeze **ownership** row in the strangler table (candidate card source vs pipeline-service regional DB vs monolith backup).
2. Add **contract** (OpenAPI snippet or markdown table): request/response shapes for the first **read-only** probe endpoint (if any) or explicitly document **documentation-only** step for this tranche.

## Acceptance for “handoff-only” slice

Deliverable satisfied when **diagram + tasks** cite this file and **`tasks.json`** `evidence_refs` point here for both tasks.
