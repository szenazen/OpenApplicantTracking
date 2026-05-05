# Current Task

## Active Task

- ID: **TASK-RBAC-NEXT-002** (done on this branch; merge PR → `main` for canonical mainline docs)
- Title: Decide RBAC/account membership read API split
- Role: architect
- Work mode: collaborative
- Base branch: main
- Branch: **feat/adr-rbac-membership-boundary**
- Phase: done
- Status: done

## Next Backlog cue

- Land **TASK-STRANGLER-NGINX-AUTH-001** by merging **`feat/nginx-auth-slice-parity`** (status `review` in `tasks.json`).
- Follow-up implementation (separate task): optional read-only membership probe on `account-service` only if an edge component needs it (ADR 0004).
