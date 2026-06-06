# One-shot ProductConfiguration tier seed for docker compose (runs after migrate).
# Build context: repository root.

FROM node:24.16.0-alpine3.23@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14

RUN apk add --no-cache openssl
RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/shared-ui ./packages/shared-ui
COPY web/prisma ./web/prisma
COPY web/scripts/seed-product-tiers.mjs ./web/scripts/seed-product-tiers.mjs
COPY web/scripts/docker-seed-tiers.sh ./web/scripts/docker-seed-tiers.sh
RUN chmod +x ./web/scripts/docker-seed-tiers.sh

RUN pnpm install --frozen-lockfile --filter web...

ENV DATABASE_URL=""

CMD ["sh", "./web/scripts/docker-seed-tiers.sh"]
