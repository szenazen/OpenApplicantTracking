# Web BFF — build from repository root: `docker build -f services/web-bff/Dockerfile .`
FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config ./packages/config
COPY services/web-bff ./services/web-bff

RUN pnpm install --frozen-lockfile

WORKDIR /repo/services/web-bff
RUN pnpm run build

ENV NODE_ENV=production
EXPOSE 3080
CMD ["node", "dist/server.js"]
