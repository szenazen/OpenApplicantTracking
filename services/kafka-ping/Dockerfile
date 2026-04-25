# Build from repo root: `docker build -f services/kafka-ping/Dockerfile .`
FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/kafka-ping ./services/kafka-ping

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/kafka-ping
RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 3040
CMD ["node", "dist/server.js"]
