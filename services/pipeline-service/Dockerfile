# Build from repo root: `docker build -f services/pipeline-service/Dockerfile .`
FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/pipeline-service ./services/pipeline-service

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/pipeline-service
RUN pnpm run db:generate && pnpm run build

ENV NODE_ENV=production
EXPOSE 3030
CMD ["sh", "-c", "pnpm exec prisma db push --schema=prisma/schema.prisma && node dist/main.js"]
