# Local / CI image for the Account microservice.
# Build from repository root: `docker build -f services/account-service/Dockerfile .`
FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/account-service ./services/account-service

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/account-service
RUN pnpm run db:generate && pnpm run build

ENV NODE_ENV=production
EXPOSE 3010
CMD ["node", "dist/main.js"]
