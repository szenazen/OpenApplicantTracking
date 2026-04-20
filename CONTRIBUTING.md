# Contributing to OpenApplicantTracking

Thanks for your interest in contributing! This document explains how to get a dev environment running and how to submit changes.

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop (or Docker Engine + Compose v2)
- Make (optional but recommended)

## Quick start

```bash
git clone https://github.com/szenazen/OpenApplicantTracking.git
cd OpenApplicantTracking
cp .env.example .env
pnpm install
make up          # starts postgres (global + regional), redis, redpanda, minio, mailhog
pnpm db:migrate  # runs prisma migrations for all datasources
pnpm db:seed     # seeds skills catalog, demo accounts (Hays US/EU/SG)
pnpm dev         # runs api (3001), web (3000), workers
```

Open http://localhost:3000, log in with the seeded credentials printed in the terminal.

## Workspace layout

```
apps/
  api/      NestJS modular monolith (Auth, Accounts, Jobs, Pipelines, Candidates, ...)
  web/      Next.js 14 (App Router) UI + Kanban
  workers/  Background workers (CV parser, audit, notifications)
packages/
  shared-types/   shared TS types + generated OpenAPI/Zod
  config/         shared tsconfig / eslint
infra/
  terraform/      multi-region AWS IaC
  helm/           K8s charts
docs/             architecture, data model, api contracts, runbooks
design/           source diagrams (draw.io) and product references
```

## Branching & commits

- Branch from `main` using `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Follow [Conventional Commits](https://www.conventionalcommits.org/).
- One logical change per PR. Include tests.

## Running tests

```bash
pnpm test        # unit tests across workspace
pnpm test:e2e    # api e2e (supertest) + web e2e (playwright)
pnpm lint
pnpm typecheck
```

## Before opening a PR

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all green
- [ ] Updated relevant docs under `docs/`
- [ ] Added/updated Prisma migrations if schema changed
- [ ] No secrets committed; use `.env.example` for new env vars

## Reporting bugs / requesting features

Use GitHub issues with the provided templates. For security issues, see [SECURITY.md](./SECURITY.md).
