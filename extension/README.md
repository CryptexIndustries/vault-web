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

Release builds read one committed public configuration per profile:

| Profile      | Configuration                                                | Name prefix |
| ------------ | ------------------------------------------------------------ | ----------- |
| `production` | [`extension/release-config.json`](release-config.json)       | none        |
| `preprod`    | [`extension/prerelease-config.json`](prerelease-config.json) | `PRE-PROD`  |

Each file sets every value the build reads, and the build script passes them to
Vite ahead of any `.env` file or shell variable, so a release build depends only
on the committed file. The values are public and end up in the extension
bundle. Never put a Pusher server secret or other credentials in them.

| Value                          | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `VITE_APP_URL`                 | HTTPS origin of the app.                                   |
| `VITE_ONLINE_SERVICES_API_URL` | Separate cloud tRPC origin, or `""` to use the app origin. |
| `VITE_CLOUD_ENABLED`           | `"false"` disables the Online Services UI.                 |
| `VITE_PUSHER_APP_ID`           | Public Pusher application ID.                              |
| `VITE_PUSHER_APP_KEY`          | Public Pusher application key.                             |
| `VITE_PUSHER_APP_HOST`         | Pusher hostname, without a scheme or port.                 |
| `VITE_PUSHER_APP_PORT`         | Pusher port.                                               |
| `VITE_PUSHER_APP_TLS`          | Whether Pusher uses TLS.                                   |
| `VITE_EXTENSION_NAME_PREFIX`   | Prefix for the extension name and toolbar title, or `""`.  |
| `VITE_FIREFOX_EXTENSION_ID`    | Firefox add-on ID. Never change it after publishing.       |

Development builds still use env files. Copy
[`extension/.env.development.example`](.env.development.example) to
`.env.development.local` for `pnpm dev` and `vite build --mode development`.
The example points at `http://localhost:3000`. Optional values include
`VITE_ONLINE_SERVICES_API_URL` for a separate cloud tRPC origin and
`VITE_CLOUD_ENABLED=false` for a local-only vault. Files named
`.env.{mode}.local` are gitignored.

The Vite config validates production values before building. The shim at
[`extension/src/env.ts`](src/env.ts) also validates them when loaded and
re-exports values under the `NEXT_PUBLIC_*` names that web/ expects:

- Required values are present, contain no whitespace, and are non-placeholder.
- `VITE_APP_URL` and an optional `VITE_ONLINE_SERVICES_API_URL` are valid HTTPS
  origins without credentials, a path, query, or fragment. A trailing `/` is allowed.
- `VITE_PUSHER_APP_HOST` is a hostname without a scheme, port, or path.
- `VITE_PUSHER_APP_PORT` is an integer from `1` to `65535`.
- `VITE_PUSHER_APP_TLS` is explicitly `true` or `false`. Optional
  `VITE_CLOUD_ENABLED` also accepts only `true` or `false`. Boolean values are
  case-insensitive.

The Vite config ([`extension/vite.config.ts`](vite.config.ts)) additionally
rewrites `manifest.json` at build time:

- `VITE_EXTENSION_NAME_PREFIX` prepends to `name` and `action.default_title`
  (defaults to `[DEV]` in `.env.development`; unset in production).
- On production builds, `host_permissions` is narrowed to the API host
  (derived from `VITE_APP_URL`) and the Pusher host (derived from
  `VITE_PUSHER_APP_HOST` + `VITE_PUSHER_APP_TLS` + `VITE_PUSHER_APP_PORT`)
  instead of the broad `https://*/*` allowed in development.
- Firefox builds (`CRYPTEX_BROWSER=firefox`) get a Firefox background entry
  and add-on settings, described in
  [build-and-release.md](docs/platform/build-and-release.md#firefox-build).

### Dev

```
pnpm i
pnpm --filter extension dev           # Chromium, into extension/dist
pnpm --filter extension dev-firefox   # Firefox, into extension/dist-firefox
```

Development Firefox builds use the ID `extension-dev@cryptex-vault.com`
unless `VITE_FIREFOX_EXTENSION_ID` is set, so the add-on keeps its storage
across reloads.

### Build & load

- Production: `pnpm build:ext`
- Preproduction: `pnpm build:ext -- --profile preprod`
- Another configuration: `pnpm build:ext -- --config /path/to/config.json`
- Firefox: add `--browser firefox` to any of the above. The build goes to
  `extension/dist-firefox`.
- Load unpacked in Chrome: load `extension/dist` in `chrome://extensions`. The
  extension has no fixed ID, so production and preproduction builds can be
  installed side by side.
- Load in Firefox: open `about:debugging#/runtime/this-firefox`, click **Load
  Temporary Add-on** and pick `extension/dist-firefox/manifest.json`. Firefox
  removes it on restart; only an add-on signed by addons.mozilla.org stays.
  Production and preproduction have different IDs, so both can be installed.

### CI extension packages

The [`Browser extension`](../.github/workflows/extension.yml) workflow packages
the extension from the committed configurations. No repository variables or
environments are involved.

- Pushing a Git tag that starts with `extension-` builds the production
  profile.
- In the Actions tab, **Browser extension** > **Run workflow** builds the branch
  you pick with the profile you choose. GitHub offers **Run workflow** only once
  the workflow file is on the default branch.

Chromium and Firefox each run the end-to-end tests and then build their own
package, side by side, so a failure in one browser doesn't stop the other. The
package jobs run the extension lint, type and configuration checks before
building. The Firefox package also goes through `addons-linter`, the linter
addons.mozilla.org runs on upload. The draft release waits for both packages.

For example:

```sh
git tag extension-v1.4.2
git push origin extension-v1.4.2
```

A tag build creates `cryptex-vault-chromium-extension-v1.4.2.zip` and
`cryptex-vault-firefox-extension-v1.4.2.zip`, each with `manifest.json` at the
archive root and no source maps. The filenames use
`cryptex-vault-{browser}-{tag}.zip`, preserving the full tag and its case.
Characters outside letters, digits, `.`, `_`, and `-` become `-` in the
filename, so tags containing `/` still produce a single filename. A manual run
names the archives `cryptex-vault-{browser}-{profile}-{branch}-{short commit}.zip`.

Download the ZIPs from the Actions run's **Artifacts** section. Each download
is the extension ZIP itself, ready to upload. Artifacts expire after 30 days.
This workflow does not create a GitHub Release or submit to either store.

The tag names the archives. The extension version still comes from
[`extension/manifest.json`](manifest.json); update it before tagging a new
Web Store version.

### Shipping checklist (Web Store)

Before submitting to the Chrome Web Store:

1. Check the values in [`extension/release-config.json`](release-config.json).
2. Bump `version`, finalize `name` / `description` in
   [`extension/manifest.json`](manifest.json) so the values match the Web
   Store listing.
3. Run `pnpm build:ext` and inspect
   `extension/dist/manifest.json`:
    - `host_permissions` should only contain the production API + Pusher
      hosts.
    - No `*.map` files in `extension/dist`.
4. Smoke-test the production bundle against the staging API (load unpacked
   `dist/` in Chrome, link a vault, unlock it).

### Shipping checklist (Firefox Add-ons)

1. Bump `version` in [`extension/manifest.json`](manifest.json) as for the
   Web Store. Firefox uses the same manifest.
2. Run `pnpm build:ext -- --browser firefox` and inspect
   `extension/dist-firefox/manifest.json`. `browser_specific_settings.gecko.id`
   must be `extension@cryptex-vault.com`, the ID of the published add-on.
3. Smoke-test the build in Firefox (load it from `about:debugging`, link a
   vault, unlock it, autofill a login).
4. Upload `cryptex-vault-firefox-extension-v1.4.2.zip` to addons.mozilla.org.
   The bundle is minified, so the site also asks for the source code. Upload
   the release's **Source code (zip)** from GitHub and give these build steps:
   Node 24.22.2, pnpm 11.28.9, `pnpm install --frozen-lockfile`, then
   `pnpm build:ext -- --browser firefox`. The output is `extension/dist-firefox`.
5. On the first upload, keep Firefox for Android unchecked. Testing so far
   covers desktop Firefox only.
