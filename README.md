# Note

This repository contains the **auditable Cryptex Vault client**: browser extension, web vault UI, and all vault/sync **cryptography**. It is open source under the [GNU Affero General Public License v3.0](LICENSE.md) (`AGPL-3.0-only`).

The **hosted Cryptex Cloud backend** (auth, device linking, billing, signaling/TURN infra) lives in the private **`cryptex-vault-cloud`** repository and is not part of this tree.

## What you can verify here

- Vault encryption, envelopes, device signing keys, import/export (`web/src/app_lib/vault-utils/`)
- End-to-end sync crypto and linking (`sync-crypto.ts`, `linking.ts`)
- Serialized vault mutation and persistence rules ([web/docs/vault-persistence.md](web/docs/vault-persistence.md))
- Extension background/content scripts
- Client behavior and API contract types (`packages/api-contract/`)

This repo ships **client-only** Docker (`compose.prod.yaml` / `compose.dev.yaml`) — vault UI with no backend containers.

See [THREAT_MODEL.md](THREAT_MODEL.md) for what the cloud service can and cannot learn.

# Setting up a development environment

## Required steps

- Install NodeJS >= 24 (`nodejs-lts-iron` or newer)
- Install pnpm (`pacman -S pnpm` on Arch)
- `pnpm install`
- Copy `web/.env.default` → `web/.env` and set client variables

## Local vault only (no cloud)

Set in `web/.env`:

```env
NEXT_PUBLIC_CLOUD_ENABLED=false
```

Run the web UI:

```bash
pnpm run dev:web
```

## Docker (client only, no server stack)

Run the vault UI in a container. Vault data stays in **your browser** (IndexedDB); no Postgres or API is started.

**Local-only vault** (default):

```bash
docker compose -f compose.prod.yaml --profile local --env-file web/.env.client.default up --build
```

Open [http://localhost:3000/app](http://localhost:3000/app).

**Self-hosted UI + external Cryptex Cloud API** (`cloud` profile):

```bash
cp web/.env.client.cloud-ui.default web/.env.client.cloud-ui
# Set NEXT_PUBLIC_ONLINE_SERVICES_API_URL and cloud client keys in that file
docker compose -f compose.prod.yaml --profile cloud --env-file web/.env.client.cloud-ui up --build
```

Image build: `web/prod.Dockerfile`

## Docker dev (hot reload, no server stack)

Run the vault UI in a container with Next.js dev server and bind-mounted sources, so edits to `web/` and `packages/` reload without rebuilding the image. No Postgres, Redis, or API is started - same client-only constraints as the prod client compose.

**Local-only vault** (default):

```bash
docker compose -f compose.dev.yaml --profile local --env-file web/.env.client.default up --build
```

**Self-hosted UI + external Cryptex Cloud API** (`cloud` profile):

```bash
cp web/.env.client.cloud-ui.default web/.env.client.cloud-ui
# Set NEXT_PUBLIC_ONLINE_SERVICES_API_URL and cloud client keys in that file
docker compose -f compose.dev.yaml --profile cloud --env-file web/.env.client.cloud-ui up --build
```

**LAN** (`lan` / `lan-cloud` — phone or other devices on the same network):

```bash
export LAN_HOST=$(hostname -I | awk '{print $1}')   # host LAN IP
docker compose -f compose.dev.yaml --profile lan --env-file web/.env.client.default up --build
# or cloud UI on LAN:
# docker compose -f compose.dev.yaml --profile lan-cloud --env-file web/.env.client.cloud-ui up --build
```

Open `https://$LAN_HOST:3000/app`. Allow host firewall TCP `${CLIENT_WEB_PORT:-3000}`. Optional: `ALLOWED_DEV_ORIGINS=100.*.*.*` (etc.) for non-RFC1918 ranges (e.g. Tailscale).

`allowedDevOrigins` defaults to RFC1918 wildcards (`192.168.*.*`, `10.*.*.*`, `172.16–31.*.*`) so HMR works without hardcoding an IP.

Or via pnpm scripts: `pnpm run docker:dev` / `pnpm run docker:dev:cloud-ui` / `pnpm run docker:dev:lan` / `pnpm run docker:dev:lan-cloud`.

Image build: `web/dev.Dockerfile`. `web/node_modules` is a named volume (`cryptex_dev_node_modules`); `pnpm install` re-runs on container start to keep the bind-mounted manifests in sync. Profiles are mutually exclusive: `local`/`cloud` bind `127.0.0.1:3000` (HTTP); `lan`/`lan-cloud` bind `0.0.0.0:3000` (HTTPS).

## With Cryptex Cloud (Online Services)

Run **`cryptex-vault-cloud`** separately (Postgres, Redis, API — see that repo's README).

Point this client at the cloud API:

```env
NEXT_PUBLIC_CLOUD_ENABLED=true
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ONLINE_SERVICES_API_URL=http://localhost:3000
```

When the UI and API run on different ports/origins, set `NEXT_PUBLIC_APP_URL` to the UI and `NEXT_PUBLIC_ONLINE_SERVICES_API_URL` to the cloud service.

Extension builds use the same split via `VITE_APP_URL` and optional `VITE_ONLINE_SERVICES_API_URL` in `extension/.env.development`.

## API contract

After changing tRPC routers in **cryptex-vault-cloud**, regenerate public stub types:

```bash
pnpm run generate:api-contract
pnpm --filter @cryptex-industries/api-contract lint-tsc
```

The generator fails if stubs keep server-only imports or omit output typing.

# Running in a dev environment

```bash
pnpm run dev:web    # web vault UI
pnpm run dev:ext    # browser extension
```

## Useful commands

- Typecheck (watch): `pnpm run lint-tsc:web`
- Lint: `pnpm run lint:web`
- Tests: `pnpm test`
