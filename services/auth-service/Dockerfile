# Build from repo root: `docker build -f services/auth-service/Dockerfile .`
FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/auth-service ./services/auth-service

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/auth-service
RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 3020
CMD ["node", "dist/main.js"]
