# syntax=docker.io/docker/dockerfile:1.24.0@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

# Production image: Next.js vault UI, no Postgres/Prisma/API server.
# Public client settings are validated and served from the container environment
# at runtime, so the same image can run locally or against Cryptex Online Services.

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

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN NEXT_PUBLIC_APP_URL=https://BUILD_ONLY_RUNTIME_CONFIG.invalid \
    NEXT_PUBLIC_CLOUD_ENABLED=true \
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL=https://BUILD_ONLY_RUNTIME_CONFIG-api.invalid \
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN=https://BUILD_ONLY_RUNTIME_CONFIG-storage.invalid \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=BUILD_ONLY_RUNTIME_CONFIG \
    NEXT_PUBLIC_PUSHER_APP_ID=BUILD_ONLY_RUNTIME_CONFIG \
    NEXT_PUBLIC_PUSHER_APP_KEY=BUILD_ONLY_RUNTIME_CONFIG \
    NEXT_PUBLIC_PUSHER_APP_HOST=BUILD_ONLY_RUNTIME_CONFIG.invalid \
    NEXT_PUBLIC_PUSHER_APP_PORT=BUILD_ONLY_RUNTIME_CONFIG_PORT \
    NEXT_PUBLIC_PUSHER_APP_TLS=false \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_BUILD_ONLY_RUNTIME_CONFIG \
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID=prod_BUILD_ONLY_RUNTIME_CONFIG \
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID=price_BUILD_ONLY_RUNTIME_CONFIG_monthly \
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID=price_BUILD_ONLY_RUNTIME_CONFIG_yearly \
    pnpm run build:web

RUN leaked_files="$(grep -R -F -l BUILD_ONLY_RUNTIME_CONFIG \
        /app/web/.next/standalone /app/web/.next/static || true)"; \
    test -z "$leaked_files" || { \
        printf 'Build-only runtime configuration leaked into:\n%s\n' "$leaked_files"; \
        exit 1; \
    }

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
    PORT=3000 \
    NEXT_PUBLIC_CLOUD_ENABLED=false

EXPOSE 3000

CMD ["node", "./web/server.js"]
