# Server-side authentication API

Server implementation (tRPC routes, JWT, Redis, Prisma, rate limits, Stripe) lives in the private **`cryptex-vault-cloud`** repository.

Canonical doc: **`cryptex-vault-cloud/web/docs/authentication-api.md`**

## What this repo contains

- Client auth orchestration: [`web/src/app_lib/auth-session.ts`](../src/app_lib/auth-session.ts)
- End-to-end flows (client + API contract): [`authentication.md`](./authentication.md)
- Shared tRPC types and Zod stubs: [`packages/api-contract/`](../../packages/api-contract/)

Regenerate contract stubs after cloud router changes:

```bash
pnpm run generate:api-contract
```
