# Platform Layer

Manifest configuration, content script injection, persistence, logging, and
build hardening.

## Documents

- [persistence.md](persistence.md) — Storage key catalog and lifetimes
- [content-scripts.md](content-scripts.md) — Injection model and field detection
- [build-and-release.md](build-and-release.md) — Dual Vite build and prod manifest

## Manifest attack surface

| Surface            | Dev                                                      | Production                  |
| ------------------ | -------------------------------------------------------- | --------------------------- |
| `host_permissions` | `https://*/*`, `http://*/*`                              | API host + Pusher host only |
| `permissions`      | `storage`, `idle`, `offscreen`, `activeTab`, `scripting` | Same                        |
| CSP                | `script-src 'self' 'wasm-unsafe-eval'`                   | Same                        |
| Content scripts    | `autofill-cs.js` on all http/https, top frame            | Same                        |
| WAR                | `autofill-*.html`, `assets/*` on all http/https          | Same                        |

`activeTab` and `scripting` are declared but unused in extension source.

No `externally_connectable` — external websites cannot message the extension
directly.

### Web-accessible resources

Host pages can load:

- `autofill-icon.html`, `autofill-menu.html`, `autofill-generator.html`,
  `autofill-save.html`
- Any hashed bundle under `assets/`

Extension pages (`popup.html`, `link.html`, `logs.html`, `offscreen.html`) are
**not** web-accessible.

WAR enables extension-origin iframes in host DOM but exposes bundle fingerprints
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

| Layer                     | Key examples                                        | Lifetime                    |
| ------------------------- | --------------------------------------------------- | --------------------------- |
| IndexedDB `vaultDB`       | `vaults`, `keyPairs`                                | Persistent                  |
| IndexedDB `vaultKeyStore` | `deviceSecondFactors`                               | Persistent; cleared on lock |
| `chrome.storage.session`  | `UV`, `OS_SESSION`, `PENDING_SAVE`, `SESSION_DEK:*` | Browser session             |
| `chrome.storage.local`    | `extLogs`                                           | Persistent until cleared    |
| `localStorage`            | `extension-last-selected-vault`                     | Persistent; non-secret      |

See [persistence.md](persistence.md).

## Logging

`ext-logging.ts` forwards to shared `vaultLogger` and persists to
`chrome.storage.local` (`extLogs`, max 2000 entries).

Channels: `uiLog`, `vaultLog`, `signalingLog`, `webrtcLog`, `onlineServicesLog`,
`importLog`, `generalLog`, `syncLog`.

`logs.html` provides filter/search/export/clear. Logs survive popup close and
browser restart until explicitly cleared. Optional `data` field may contain
deviceId, vaultId, or error context — not credential secrets by policy, but not
enforced at runtime.

Production Terser drops `console.log/info/debug` but retains `warn`/`error`.

## Idle lock

`chrome.idle.setDetectionInterval(30 min)` locks on **system** idle, not
extension inactivity. Closing popup alone does not lock.

## Offscreen stub

`ensureOffscreenDocument()` creates `offscreen.html` with `WEB_RTC` reason before
most SW messages. `offscreen.ts` is entirely commented out; `offscreen` origin
allowlist is empty.

## File map

| Path                            | Role                               |
| ------------------------------- | ---------------------------------- |
| `manifest.json`                 | Source manifest                    |
| `vite.config.ts`                | Main build + prod manifest rewrite |
| `vite.config.content.ts`        | Content script IIFE                |
| `src/env.ts`                    | Env shim                           |
| `src/utils/ext-logging.ts`      | Log adapter + persistence          |
| `src/logs.tsx`                  | Log viewer                         |
| `src/content/autofill-cs.ts`    | Content script entry               |
| `src/content/field-detector.ts` | Field heuristics                   |
| `src/content/origin-utils.ts`   | Origin helpers                     |
