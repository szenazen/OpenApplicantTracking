# Local / CI image for the User microservice.
# Build from repository root: `docker build -f services/user-service/Dockerfile .`
FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/user-service ./services/user-service

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/user-service
RUN pnpm run db:generate && pnpm run build

ENV NODE_ENV=production
EXPOSE 3050
CMD ["node", "dist/main.js"]
