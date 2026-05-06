# Current task

## Session (`feat/agent-harness-wave`, 2026-05-06)

Shipped in this wave:

1. **Auth phase-0 login shim** — **TASK-AUTH-SESSION-SLICE-010** **`review`**: `AUTH_LOGIN_SHIM`, **`services/web-bff`** routing + monolith path rewrite, **`services/auth-service`** `POST /api/slice/auth/login` → **`MONOLITH_URL` `/api/auth/login`**; ADR **0005** bullet for **`AUTH_LOGIN_SHIM`**.
2. **Realtime docs tranche** — **TASK-REALTIME-GATEWAY-011** **`in_progress`**: **`docs/realtime-gateway-tranche-notes.md`**, runbook §7 (**ADR 0007**).
3. **P1 candidate/job** — **012/013** handoff doc + **tasks.json** refs.
4. **ADR stubs** — **014/015/017** cite **0009–0011** Proposed.
5. **099** — `evidence_refs`: **unchanged deferred**.

**Validation:** `perl -e 'alarm 120; exec @ARGV'` `pnpm --filter @oat/auth-service test` and `@oat/web-bff test` (green).

## Next actions

1. Review / merge **010** with **0005** when appropriate; implement refresh + E2E per task AC.
2. Start **011** code only behind flags + **Kanban e2e** after programme ungates.
3. Continue **012/013** implementation from handoff note when pipeline ownership is chosen.
