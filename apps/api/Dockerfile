# Backup / reference Nest API — build from repo root:
#   docker build -f apps/api/Dockerfile .
#
# On boot: `migrate-all` (db push when USE_PRISMA_DB_PUSH=1) then `node dist/main.js`.
FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile

WORKDIR /repo/apps/api
RUN pnpm run db:generate && pnpm run build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm exec tsx scripts/migrate-all.ts && node dist/main.js"]
