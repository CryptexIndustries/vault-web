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

Values are loaded by Vite from per-mode env files:

- [`extension/.env.development`](.env.development) — used by `pnpm dev` and
  `vite build --mode development`. Points at `http://localhost:3000` by
  default. Optional: `VITE_ONLINE_SERVICES_API_URL` (cloud tRPC origin),
  `VITE_CLOUD_ENABLED=false` (local-only vault, no sign-in/sync UI).
- [`extension/.env.production`](.env.production) — used by `vite build`
  (default mode). Ships with `REPLACE_ME` placeholders that fail the build
  until they are replaced.

Per-developer overrides go in `.env.{mode}.local`, which is gitignored.

The shim at [`extension/src/env.ts`](src/env.ts) re-exports the values under
the `NEXT_PUBLIC_*` names that web/ expects, and enforces in production:

- All required keys are present and non-placeholder.
- `VITE_APP_URL` uses `https://`.

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

### Shipping checklist (Web Store)

Before submitting to the Chrome Web Store:

1. Replace every `REPLACE_ME` value in
   [`extension/.env.production`](.env.production) (API URL, Pusher
   credentials).
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
