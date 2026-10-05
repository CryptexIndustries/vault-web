## Cryptex Vault Extension (MVP)

The browser extension has its own popup UI tailored to the small surface area,
while sharing libraries (vault, encryption, linking, online services) with the
web client.

### Popup flow

1. **No vault present:** the popup explains that a vault can be created on the
   mobile app or the web app at [cryptex-vault.com](https://cryptex-vault.com),
   then linked here. The primary action is "Link this device".
   Clicking it opens [`extension/link.html`](link.html) as a full browser tab so
   the QR scanner, mnemonic input, and progress view get the room they need.
   The tab renders [`extension/src/components/popup-receive-link.tsx`](src/components/popup-receive-link.tsx);
   on success the link tab closes itself and the popup picks the new vault up
   via Dexie's `useLiveQuery`. When the link package includes Online Services
   credentials, the link tab mirrors the web client and establishes a premium
   session in the background before the WebRTC handshake.
2. **Vault present, session locked:** the popup renders the unlock view
   ([`extension/src/components/popup-unlock.tsx`](src/components/popup-unlock.tsx))
   with a vault picker (when multiple) and an encryption details accordion.
   Unlock requests still flow through the service worker
   ([`extension/src/background.ts`](src/background.ts)).
3. **Session unlocked:** the credential dashboard
   ([`extension/src/vault-view.tsx`](src/vault-view.tsx)) is rendered.

The popup styling shares CSS variables with the web client via
[`web/src/styles/globals.css`](../web/src/styles/globals.css), imported through
[`extension/src/popup.css`](src/popup.css).

### Logging

All extension code routes log records through
[`extension/src/utils/ext-logging.ts`](src/utils/ext-logging.ts), which wraps
the shared web `vaultLogger` and additionally persists each entry to
`chrome.storage.local` for internal diagnostics.

The unlocked dashboard can also be opened as a full browser tab from its
top-bar action. The tab reuses `popup.html` with a full-viewport layout rather
than maintaining a separate dashboard entry point.

### Configuration

Vite loads values from the build environment and per-mode env files. Existing
environment variables take precedence over files.

- Copy [`extension/.env.development.example`](.env.development.example) to
  `.env.development.local` for `pnpm dev` and `vite build --mode development`.
  The example points at `http://localhost:3000`. Optional values include
  `VITE_ONLINE_SERVICES_API_URL` for a separate cloud tRPC origin and
  `VITE_CLOUD_ENABLED=false` for a local-only vault.
- Copy [`extension/.env.production.example`](.env.production.example) to
  `.env.production.local` for `vite build`, then replace the `REPLACE_ME`
  values. CI supplies production values directly through its environment.

Files named `.env.{mode}.local` are gitignored.

The Vite config validates production values before building. The shim at
[`extension/src/env.ts`](src/env.ts) also validates them when loaded and
re-exports values under the `NEXT_PUBLIC_*` names that web/ expects:

- Required values are present, contain no whitespace, and are non-placeholder.
- `VITE_APP_URL` and an optional `VITE_ONLINE_SERVICES_API_URL` are valid HTTPS
  origins without credentials, a path, query, or fragment. A trailing `/` is allowed.
- `VITE_PUSHER_APP_HOST` is a hostname without a scheme, port, or path.
- `VITE_PUSHER_APP_PORT` is an integer from `1` to `65535`.
- `VITE_PUSHER_APP_TLS` is explicitly `true` or `false`. CI defaults to `true`;
  local production builds must supply it. Optional `VITE_CLOUD_ENABLED` also
  accepts only `true` or `false`. Boolean values are case-insensitive.

The Vite config ([`extension/vite.config.ts`](vite.config.ts)) additionally
rewrites `manifest.json` at build time:

- `VITE_EXTENSION_NAME_PREFIX` prepends to `name` and `action.default_title`
  (defaults to `[DEV]` in `.env.development`; unset in production).
- On production builds, `host_permissions` is narrowed to the API host
  (derived from `VITE_APP_URL`) and the Pusher host (derived from
  `VITE_PUSHER_APP_HOST` + `VITE_PUSHER_APP_TLS` + `VITE_PUSHER_APP_PORT`)
  instead of the broad `https://*/*` allowed in development.

### Dev

```
pnpm i
pnpm --filter extension dev
```

### Build & load

- Build: `pnpm --filter extension build`
- Load unpacked: load `extension/dist` in `chrome://extensions`.

### CI extension packages

Pushing a Git tag beginning with `extension-` runs the `Chromium extension package` job in
[`CI`](../.github/workflows/ci.yml), after lockfile and extension quality checks
pass. Other tags, branch pushes, and pull requests skip extension packaging.

Before the first tag build, add repository variables under **Settings >
Secrets and variables > Actions > Variables**:

| Variable                       | Required or CI default | Purpose                                                            |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------ |
| `VITE_APP_URL`                 | Required               | Production web app origin, starting with `https://`.               |
| `VITE_PUSHER_APP_ID`           | Required               | Public Pusher application ID.                                      |
| `VITE_PUSHER_APP_KEY`          | Required               | Public Pusher application key.                                     |
| `VITE_PUSHER_APP_HOST`         | Required               | Pusher hostname, without a scheme or port.                         |
| `VITE_PUSHER_APP_PORT`         | `443`                  | Pusher port.                                                       |
| `VITE_PUSHER_APP_TLS`          | `true`                 | Whether Pusher uses TLS.                                           |
| `VITE_ONLINE_SERVICES_API_URL` | Empty                  | Separate cloud tRPC origin, if needed. Defaults to the app origin. |
| `VITE_CLOUD_ENABLED`           | `true`                 | Set to `false` to disable cloud UI.                                |
| `VITE_EXTENSION_NAME_PREFIX`   | Empty                  | Optional prefix for the extension name and toolbar title.          |

These values are public and embedded in the extension bundle. Do not supply a
Pusher server secret or other private credentials. See
[Vite's environment variable documentation](https://vite.dev/guide/env-and-mode).
Missing required values and `REPLACE_ME` placeholders fail the build.

For example, after merging the workflow and configuring variables:

```sh
git tag extension-v1.4.2
git push origin extension-v1.4.2
```

The job builds in production mode and creates
`cryptex-vault-chromium-extension-v1.4.2.zip` with `manifest.json` at the archive
root and no source maps. The filename uses `cryptex-vault-chromium-{tag}.zip`,
preserving the full tag and its case. Characters outside letters, digits, `.`,
`_`, and `-` become `-` in the filename, so tags containing `/` still produce a
single filename.

Download `cryptex-vault-chromium-extension-v1.4.2` from the Actions run's
**Artifacts** section. GitHub wraps the extension ZIP in an artifact download;
extract that download to obtain the extension ZIP. Artifacts expire after 30
days. This workflow does not create a GitHub Release or submit to the Web Store.

The tag names the archive. The extension version still comes from
[`extension/manifest.json`](manifest.json); update it before tagging a new
Web Store version.

### Shipping checklist (Web Store)

Before submitting to the Chrome Web Store:

1. Set production build variables through CI or
   `extension/.env.production.local`, replacing every `REPLACE_ME` value from
   the [production example](.env.production.example).
2. Bump `version`, finalize `name` / `description` in
   [`extension/manifest.json`](manifest.json) so the values match the Web
   Store listing.
3. Run `pnpm --filter extension build` and inspect
   `extension/dist/manifest.json`:
    - `host_permissions` should only contain the production API + Pusher
      hosts.
    - No `*.map` files in `extension/dist`.
4. Smoke-test the production bundle against the staging API (load unpacked
   `dist/` in Chrome, link a vault, unlock it).
