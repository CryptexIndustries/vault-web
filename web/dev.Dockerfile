# syntax=docker.io/docker/dockerfile:1.24.0@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

# Development server image (hot reload via Turbopack). Build context: repo root.
# Run with compose.dev.yaml: bind-mounts ./web and ./packages over /app sources,
# plus repo-root package.json / pnpm-lock.yaml / pnpm-workspace.yaml.
# /app/web/node_modules is a named volume seeded from this image; the CMD re-runs
# pnpm install at start so the bind-mounted manifests stay in sync without a rebuild.

FROM node:24.16.0-alpine3.23@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14

RUN apk add --no-cache libc6-compat curl \
    && corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY scripts/install-lefthook.mjs ./scripts/install-lefthook.mjs
COPY web/package.json ./web/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/api-contract/package.json ./packages/api-contract/

RUN pnpm install --frozen-lockfile --filter web...

COPY packages/shared-ui ./packages/shared-ui
COPY packages/api-contract ./packages/api-contract

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "pnpm install --frozen-lockfile --filter web... && pnpm --filter web exec next dev --hostname 0.0.0.0 --port 3000"]
