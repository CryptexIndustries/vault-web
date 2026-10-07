# Cryptex Vault

Cryptex Vault is an open source password manager that keeps an encrypted vault on each of your devices. Use the web app and Chromium Extension to manage and fill passwords, then sync between linked devices. You can run the connection services yourself or use optional Online Services for managed connections and encrypted backups.

The web app, extension, and shared vault and sync cryptography are in this repository under the [AGPL-3.0 license](LICENSE.md). You can inspect the code and build the software yourself. The hosted Online Services backend is private and lives in a separate repository.

## Start here

- **Exploring?** [See how Cryptex Vault works](https://cryptex-vault.com/) or [open a local vault](https://cryptex-vault.com/app). Local use needs no account.
- **Setting up your own server?** Follow the [self-hosting guide](https://cryptex-vault.com/docs/self-hosting). The [deployment files](deploy/self-hosting/) include the web app, signaling, and STUN/TURN services.
- **Checking the design?** Read the [architecture](https://cryptex-vault.com/docs/architecture), [web app threat model](web/threat-model.md), or [security overview](https://cryptex-vault.com/security).
- **Want to contribute?** Read the [contributor guide](CONTRIBUTING.md), then jump to [local development](#develop-locally).
- **Have a question or idea?** Join [GitHub Discussions](https://github.com/CryptexIndustries/vault-web/discussions).

New links connect and sync automatically by default when both vaults are open, unlocked, and reachable. You can change those settings or sync manually. Devices connect directly where possible; otherwise a TURN server relays end-to-end encrypted traffic. The self-hosted stack does not include managed backups, so keep a separate encrypted backup of your vault.

## What's in this repository

- [`web/`](web/) contains the web vault, public website, and user guides.
- [`extension/`](extension/) contains the Chromium Extension and its [developer notes](extension/README.md).
- [`mobile/`](mobile/) contains the Android app and its [build and development notes](mobile/README.md).
- [`packages/vault-core/`](packages/vault-core/) holds the shared vault format, encryption, imports and exports, device linking, and synchronization code.
- [`packages/api-contract/`](packages/api-contract/) and [`packages/shared-ui/`](packages/shared-ui/) hold client API types and shared interface code.
- [`deploy/self-hosting/`](deploy/self-hosting/) has the Compose stack and configuration for running the web app and connection services yourself. The root `compose.*.yaml` files cover client development and deployment; [Docker Swarm instructions](docs/swarm-deployment.md) live in `docs/`.
- [`docs/`](docs/) and [`web/docs/`](web/docs/) contain deployment and implementation notes. The [website documentation](https://cryptex-vault.com/docs) covers day-to-day use and the security model.

## Contributing

Bug reports, documentation fixes, and code changes are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to file a useful issue and what to include in a pull request. Bring questions, self-hosting help, and early ideas to [GitHub Discussions](https://github.com/CryptexIndustries/vault-web/discussions). Please report security problems privately through the [security policy](SECURITY.md).

## Develop locally

Run the web app directly with Node.js 24.16 or later and pnpm 11.25 or later:

```bash
pnpm install
cp web/.env.default web/.env
pnpm dev:web
```

Or use the development container. It mounts `web/` and `packages/` so your changes reload without rebuilding:

```bash
docker compose -f compose.dev.yaml --profile local --env-file web/.env.client.default up --build
```

Both options open the local vault at [http://localhost:3000/app](http://localhost:3000/app) without Online Services. To work on the extension, run `pnpm dev:ext` in another terminal and see its [setup notes](extension/README.md).

When you run `pnpm install` in a Git checkout, the `prepare` script installs [Lefthook](lefthook.yml). It runs two Git hooks:

- `pre-commit` formats supported staged files in `web/`, `extension/`, and `packages/` with oxfmt and stages any fixes. It also runs `verify-lockfile` if `package.json`, `pnpm-workspace.yaml`, or `pnpm-lock.yaml` is staged.
- `pre-push` runs `verify-lockfile` on every push.

Despite its name, `verify-lockfile` currently only invokes pnpm and updates the lockfile timestamp. It does not check whether the lockfile matches the manifests. Run `pnpm lint` and `pnpm test` before contributing changes; the hooks do not run them.
