# Platform Layer

Manifest configuration, content script injection, persistence, logging, and
build hardening.

## Documents

- [persistence.md](persistence.md) — Storage key catalog and lifetimes
- [content-scripts.md](content-scripts.md) — Injection model and field detection
- [build-and-release.md](build-and-release.md): Dual Vite build, prod manifest and Firefox build

## Manifest attack surface

| Surface            | Dev                                           | Production                  |
| ------------------ | --------------------------------------------- | --------------------------- |
| `host_permissions` | `https://*/*`, `http://*/*`                   | API host + Pusher host only |
| `permissions`      | `storage`, `idle`, `activeTab`, `alarms`      | Same                        |
| CSP                | `script-src 'self' 'wasm-unsafe-eval'`        | Same                        |
| Content scripts    | `autofill-cs.js` on all http/https, top frame | Same                        |
| WAR                | Three autofill panel pages + `assets/*`       | Same                        |

`activeTab` is declared but unused in extension source. `alarms` schedules the
managed-backup job that follows a committed vault-security change.

No `externally_connectable` — external websites cannot message the extension
directly.

### Web-accessible resources

Host pages can load:

- `autofill-menu.html`, `autofill-generator.html`, and `autofill-save.html`
- Any hashed bundle under `assets/`

Extension pages (`popup.html`, `link.html`) are
**not** web-accessible.

WAR enables extension-origin panels in host DOM but exposes bundle fingerprints
to pages that probe `chrome.runtime.getURL()`.

## Content script (summary)

Single bundled IIFE: `assets/autofill-cs.js`

- Manifest: `all_frames: false`, `document_idle`
- Runtime: `isTopFrame()` + http/https protocol check
- SW: `frameId === 0` for `autofill-cs` origin

Orchestrates field detection, iframe injection, SW messaging, fill, and
save-on-submit. See [content-scripts.md](content-scripts.md) and
[autofill/README.md](../autofill/README.md).

## Persistence (summary)

| Layer                              | Key examples                                        | Lifetime                                  |
| ---------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| IndexedDB `vaultDB`                | `vaults`, `keyPairs`                                | Persistent                                |
| IndexedDB `cryptex-backup-staging` | one-shot `.cryx` blobs                              | Until take / next create / lock           |
| IndexedDB `vaultKeyStore`          | `deviceAdditionalKeyProtections`                    | Persistent; replaced on protection change |
| `chrome.storage.session`           | `UV`, `OS_SESSION`, `PENDING_SAVE`, `SESSION_DEK:*` | Browser session                           |
| `chrome.storage.local`             | `cryptex:local-backup-receipt:*`                    | Persistent until cleared                  |
| `localStorage`                     | `extension-last-selected-vault`                     | Persistent; non-secret                    |

See [persistence.md](persistence.md).

## Logging

`ext-logging.ts` forwards to the shared in-memory `vaultLogger` (500 entries
per group). Each extension page and the SW keeps its own logs until it closes or
stops. An extension update deletes the `extLogs` key that older versions kept in
`chrome.storage.local`.

While unlocked, Vault actions > Diagnostic logs shows the page's and the
worker's logs. See [../ui/README.md](../ui/README.md).

Channels: `uiLog`, `vaultLog`, `signalingLog`, `webrtcLog`, `onlineServicesLog`,
`importLog`, `generalLog`, `syncLog`.

Optional `data` fields may hold a device ID, a vault ID or error details. Policy
keeps credential secrets out of them, but nothing enforces that at runtime.

`vaultLogger` prints to the console only in development builds. In release
builds `ext-logging.ts` prints warnings and errors itself, and production Terser
keeps `console.warn` and `console.error` while it drops `console.log`, `info` and
`debug`. Report through these channels instead of calling `console.warn` or
`console.error` directly. The log viewer only shows what goes through them.
`sw-envelope-client.ts` is the exception, because content scripts load it too.

## Idle lock

`chrome.idle.setDetectionInterval(30 min)` locks on **system** idle, not
extension inactivity. Closing popup alone does not lock.

## File map

| Path                            | Role                               |
| ------------------------------- | ---------------------------------- |
| `manifest.json`                 | Source manifest                    |
| `vite.config.ts`                | Main build + prod manifest rewrite |
| `vite.config.content.ts`        | Content script IIFE                |
| `src/env.ts`                    | Env shim                           |
| `src/utils/ext-logging.ts`      | Log adapter                        |
| `src/content/autofill-cs.ts`    | Content script entry               |
| `src/content/field-detector.ts` | Field heuristics                   |
| `src/content/origin-utils.ts`   | Origin helpers                     |
