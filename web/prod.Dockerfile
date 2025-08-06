# syntax=docker.io/docker/dockerfile:1

FROM node:22-alpine AS base

# Step 1. Rebuild the source code only when needed
FROM base AS builder

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY ./web ./web
COPY ./packages ./packages

RUN corepack enable pnpm && pnpm i --frozen-lockfile

# Environment variables must be present at build time
# https://github.com/vercel/next.js/discussions/14030
# ARG ENV_VARIABLE
# ENV ENV_VARIABLE=${ENV_VARIABLE}
# ARG NEXT_PUBLIC_ENV_VARIABLE
# ENV NEXT_PUBLIC_ENV_VARIABLE=${NEXT_PUBLIC_ENV_VARIABLE}

# Disable NextJS telemetry
ENV NEXT_TELEMETRY_DISABLED 1

# Build Next.js based on the preferred package manager
RUN pnpm run build:web

# Note: It is not necessary to add an intermediate step that does a full copy of `node_modules` here

# Step 2. Production image, copy all the files and run next
FROM base AS runner

WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN apk add openssl

USER nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static

# Copy over the public files
COPY --from=builder /app/web/public ./web/public

# Environment variables must be redefined at run time
# ARG ENV_VARIABLE
# ENV ENV_VARIABLE=${ENV_VARIABLE}
# ARG NEXT_PUBLIC_ENV_VARIABLE
# ENV NEXT_PUBLIC_ENV_VARIABLE=${NEXT_PUBLIC_ENV_VARIABLE}

# Disable telemetry at run time
ENV NEXT_TELEMETRY_DISABLED 1

# Note: Don't expose ports here, Compose will handle that for us

CMD ["node", "./web/server.js"]
