# syntax=docker.io/docker/dockerfile:1.24.0@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

# Production image: Next.js vault UI, no Postgres/Prisma/API server.
# for local-only mode, or true with NEXT_PUBLIC_ONLINE_SERVICES_API_URL to point
# at a separately hosted Cryptex Cloud API.

FROM node:24.16.0-alpine3.23@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14 AS base

FROM base AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/install-lefthook.mjs ./scripts/install-lefthook.mjs
COPY web/package.json ./web/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/vault-core/package.json ./packages/vault-core/

RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter web...

COPY ./web ./web
COPY ./packages ./packages

# NEXT_PUBLIC_* must be present at build time (inlined by Next.js).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_CLOUD_ENABLED=false
ARG NEXT_PUBLIC_ONLINE_SERVICES_API_URL=
ARG NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ARG NEXT_PUBLIC_PUSHER_APP_ID=local-disabled
ARG NEXT_PUBLIC_PUSHER_APP_KEY=local-disabled
ARG NEXT_PUBLIC_PUSHER_APP_HOST=localhost
ARG NEXT_PUBLIC_PUSHER_APP_PORT=6004
ARG NEXT_PUBLIC_PUSHER_APP_TLS=false
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_local
ARG NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID=prod_local000000000000
ARG NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_local0000000000
ARG NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID=price_local0000000001

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CLOUD_ENABLED=$NEXT_PUBLIC_CLOUD_ENABLED \
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL=$NEXT_PUBLIC_ONLINE_SERVICES_API_URL \
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN=$NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_PUSHER_APP_ID=$NEXT_PUBLIC_PUSHER_APP_ID \
    NEXT_PUBLIC_PUSHER_APP_KEY=$NEXT_PUBLIC_PUSHER_APP_KEY \
    NEXT_PUBLIC_PUSHER_APP_HOST=$NEXT_PUBLIC_PUSHER_APP_HOST \
    NEXT_PUBLIC_PUSHER_APP_PORT=$NEXT_PUBLIC_PUSHER_APP_PORT \
    NEXT_PUBLIC_PUSHER_APP_TLS=$NEXT_PUBLIC_PUSHER_APP_TLS \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID=$NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID \
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID=$NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID \
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID=$NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID

RUN pnpm run build:web

FROM base AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

USER nextjs

COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

ENV NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

EXPOSE 3000

CMD ["node", "./web/server.js"]
