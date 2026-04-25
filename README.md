<div align="center">

# OpenApplicantTracking

**An open-source, multi-tenant, multi-region Applicant Tracking System.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
![Node](https://img.shields.io/badge/node-20%2B-green)
![TypeScript](https://img.shields.io/badge/typescript-5.5-blue)

</div>

OpenApplicantTracking (OAT) is a modern ATS designed for recruitment agencies and in-house talent teams that operate **across multiple countries, accounts, and data-residency regimes**. A single user logs in once and switches between multiple **Accounts**, each of whose candidate and job data lives in the **cloud region of the customer's choice** (e.g. `us-east-1`, `eu-west-1`, `ap-southeast-1`, `ap-northeast-1`, `ap-southeast-2`).

> **Status:** early development. Core APIs and the Kanban UI are functional; production hardening is ongoing. See [roadmap](#roadmap).

---

## Why OpenATS

- **True multi-tenancy, true multi-region.** Not a region tag in a single DB — a physical datasource per region, routed per request.
- **Global users, regional data.** One email/password. One click to switch between accounts in different regions. Your candidate data never leaves its home region.
- **Customizable pipelines.** Every job opening can define its own ordered list of statuses. Drag candidates across columns with live WebSocket updates.
- **Skills catalog shared globally.** Regional caches keep the skills list fast while a single source of truth governs it.
- **Built for OSS.** Apache-2.0, conventional commits, CI, Helm charts, Terraform modules, documented architecture.

---

## Architecture at a glance

```
                        ┌──────────────────────────────────────┐
                        │        Global Control Plane          │
   ┌─── Login ────────► │  Auth · Users · Accounts · RBAC ·    │
   │                    │  Skills (source of truth)            │
   │                    └──────────────────────────────────────┘
   │                                   │  (account→region map,
   │                                   │   skills sync)
   │                                   ▼
   │        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
   │        │  Region:      │  │  Region:      │  │  Region:      │
   │        │  us-east-1    │  │  eu-west-1    │  │  ap-southeast │
   │        │  Jobs · Pipe- │  │  Jobs · Pipe- │  │  Jobs · Pipe- │
   │        │  lines · Cand-│  │  lines · Cand-│  │  lines · Cand-│
   │        │  idates · Apps│  │  idates · Apps│  │  idates · Apps│
   │        └───────────────┘  └───────────────┘  └───────────────┘
   │
   └── Web / Mobile BFF · Realtime Gateway (Socket.IO) · Workers (CV · Audit · Email)
```

Full diagrams live in [`design/`](./design) (e.g. [`design/ATS-design.drawio.xml`](./design/ATS-design.drawio.xml) — *Global Control Plane* vs *Regional ATS*, *Web BFF* at the edge) and the exported architecture doc is [`docs/architecture.md`](./docs/architecture.md).

**Strangler / microservices (local + prod pattern):** the **Web BFF** in [`services/web-bff/`](./services/web-bff) (per [`design/ATS-design.drawio.xml`](./design/ATS-design.drawio.xml)) is the default edge: it routes the extracted **Account & membership** API to `account-service` and everything else (auth, jobs, candidates, `POST` tenant create, `/realtime`) to the monolith. [`apps/api`](./apps/api) stays the **parallel modular monolith** for development and as the reference when adding slices. **Run monolith direct (:3001) or through BFF (:3080):** [docs/deployment-modes.md](./docs/deployment-modes.md). Optional legacy **nginx** proxy: [`services/api-gateway/README.md`](./services/api-gateway/README.md). Docker: [`services/README.md`](./services/README.md#unified-api-local-prod-like--recommended-for-microservice-testing).

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/szenazen/OpenApplicantTracking.git
cd OpenApplicantTracking

# 2. Install
corepack enable
pnpm install

# 3. Boot infra (postgres x6, redis, redpanda, minio, mailhog)
cp .env.example .env
make up

# 4. Migrate + seed (creates demo Hays accounts in US/EU/SG)
make migrate
make seed

# 5. Run
make dev
# Web:      http://localhost:3002
# API:      http://localhost:3001/api/docs    (OpenAPI / Swagger)
# MailHog:  http://localhost:8025
# MinIO:    http://localhost:9001  (minioadmin / minioadmin)
```

Demo login credentials are printed by `make seed`.

---

## Repository layout

| Path | What's inside |
| --- | --- |
| `apps/api` | NestJS **modular monolith** (parallel reference implementation). Modules mirror service boundaries in the design diagram; remains the main dev path until a slice is extracted. |
| `apps/web` | Next.js 14 App Router UI: login, account switcher, jobs list, Kanban board with dnd-kit + Socket.IO live updates, candidate drawer. |
| `services/web-bff` | **Web BFF** — single HTTP/WS entry in front of `account-service` and the monolith; implements [`design/ATS-design.drawio.xml`](./design/ATS-design.drawio.xml) edge routing in code. |
| `apps/workers` | Background workers: CV parser (pdf-parse), audit consumer, notification dispatcher. |
| `packages/shared-types` | Shared TypeScript types + generated OpenAPI client + Zod schemas. |
| `packages/config` | Shared `tsconfig`, ESLint, Prettier. |
| `infra/terraform` | Multi-region AWS IaC: VPC, EKS, RDS (regional + global), MSK, S3, Route53, ACM. Add a region in one block. |
| `infra/helm` | Helm charts for each service, deployable per region. |
| `docs/` | [`data-model.md`](./docs/data-model.md), [`runbook.md`](./docs/runbook.md), architecture decision records in [`docs/adr/`](./docs/adr). |
| `design/` | Source draw.io diagrams and product requirements. |

---

## Deliverables mapping

The original challenge asks for:

| Deliverable | Where |
| --- | --- |
| Data Structure Design | [`docs/data-model.md`](./docs/data-model.md) · Prisma schemas in `apps/api/prisma/` · source `design/ATS-design.drawio.xml` |
| High-Level Architecture | [`docs/adr/0001-multi-region-data-residency.md`](./docs/adr/0001-multi-region-data-residency.md) · diagram `design/ATS-design.drawio.png` |
| API Contracts | Live OpenAPI at `http://localhost:3001/api/docs` after `pnpm --filter @oat/api dev` |
| Front-End Interaction & Responsiveness | `apps/web/src/app/dashboard/jobs/[id]/page.tsx` + `apps/web/src/components/KanbanBoard.tsx` · ADR [`0002-realtime-kanban-via-socketio.md`](./docs/adr/0002-realtime-kanban-via-socketio.md) |

---

## Roadmap

- [x] OSS baseline (license, CoC, contributing, CI)
- [x] Monorepo scaffolding (pnpm + turbo)
- [x] Data model (global + regional Prisma schemas)
- [x] Core API (auth, accounts, jobs, pipelines, candidates, skills)
- [x] Realtime Kanban (Socket.IO)
- [x] Web UI (login, switcher, Kanban)
- [x] E2E test suite (Playwright — auth, account switching, Kanban drag + DB persist, cross-browser realtime sync)
- [x] CI (lint/typecheck + api jest + playwright e2e in GH Actions)
- [ ] Workers (CV parser, email, audit)
- [ ] Terraform modules + Helm charts
- [ ] SAML / SSO (post-1.0)
- [ ] Candidate self-service portal (post-1.0)

---

## Running the tests

```bash
# One-time: bring up infra + migrate + seed
make up && make migrate && make seed

# Backend integration tests (Jest + supertest)
pnpm --filter @oat/api test          # 22 tests

# Frontend end-to-end (Playwright, chromium)
# (expects api on :3001 and web on :3002)
pnpm --filter @oat/api dev &          # or: node --env-file=.env apps/api/dist/main.js
pnpm --filter @oat/web dev &
pnpm --filter @oat/web exec playwright install chromium   # first run only
pnpm --filter @oat/web exec playwright test               # 4 tests
```

CI runs all of the above on every push / PR — see `.github/workflows/ci.yml`.

---

## License

[Apache 2.0](./LICENSE) © OpenApplicantTracking contributors.
