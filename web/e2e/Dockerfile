FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY scripts/install-lefthook.mjs ./scripts/install-lefthook.mjs
COPY web/package.json ./web/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/vault-core/package.json ./packages/vault-core/

# The specs import web dependencies such as jszip.
RUN pnpm install \
    --filter cryptex-vault-web \
    --filter "web..." \
    --frozen-lockfile \
    --ignore-scripts

CMD ["./node_modules/.bin/playwright", "test", "--config", "web/e2e/playwright.config.ts"]
