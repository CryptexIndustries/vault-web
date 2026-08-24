FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/install-lefthook.mjs ./scripts/install-lefthook.mjs

RUN pnpm install \
    --filter cryptex-vault-web \
    --frozen-lockfile \
    --ignore-scripts

CMD ["./node_modules/.bin/playwright", "test", "--config", "web/e2e/playwright.config.ts"]
