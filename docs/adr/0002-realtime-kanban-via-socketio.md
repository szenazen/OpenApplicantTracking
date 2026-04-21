# ADR 0002 — Realtime Kanban via Socket.IO rooms

- **Status:** accepted
- **Date:** 2026-04

## Context

The Kanban board must reflect other users' moves in near-real-time. Users
working the same job in different browsers / tabs must see cards move without
a reload. Notifications are **scoped to an account and a job** — a recruiter
in account A must never see events from account B.

## Decision

- Use **Socket.IO** (already part of the NestJS ecosystem via
  `@nestjs/platform-socket.io`). HTTP long-polling fallback matters for
  corporate proxies and keeps dev friction low.
- Client connects **directly to the API origin**, not through Next.js
  rewrites (which don't proxy WebSocket upgrades). Path: `/realtime`.
- Handshake carries the **JWT** in `auth.token`; the gateway re-verifies it
  and re-checks membership on each `subscribe`.
- Room naming: `account:<accountId>:job:<jobId>`. After
  `ApplicationsService.move` commits the DB transaction, it calls
  `RealtimeGateway.emitApplicationChange(accountId, jobId, event)`, which
  broadcasts to that room only.
- **Server is the source of truth.** The client applies an optimistic local
  state update when the user drags, then issues `PATCH /applications/:id/move`.
  Both the local optimistic update *and* the broadcast event go through the
  same pure `reconcileMove()` function in `apps/web/src/components/KanbanBoard.tsx`,
  which re-packs positions deterministically — so incoming events that
  arrive after the server has already accepted the drag are idempotent.

## Consequences

**Good**

- Cross-browser sync works (e2e test
  `apps/web/e2e/kanban-realtime.spec.ts` opens two contexts, moves a card
  in A, asserts propagation in B without reload).
- Membership is enforced at `subscribe` time, not just at connect, so a
  compromised client can't join another account's room just by knowing the id.
- Sticking to the same reconcile function avoids the
  "optimistic-update-then-server-update-double-applies" class of bugs.

**Bad / accepted costs**

- Next.js dev rewrites can't transparently proxy WebSocket upgrades — the
  web client has to know the API origin (`NEXT_PUBLIC_API_URL`). Documented
  in `.env.example`.
- Socket.IO is a heavier dependency than a raw `ws` library. Worth it for
  the reconnect / polling-fallback semantics at this stage.

## Alternatives

- **Server-sent events** — lacks a built-in subscribe/unsubscribe per room
  primitive, would require a parallel HTTP channel for joins.
- **Postgres `LISTEN/NOTIFY` fanned out to clients.** Cute, but ties the
  realtime channel to a specific DB vendor and doesn't scale across
  replicas without an adapter anyway.
