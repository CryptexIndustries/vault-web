# Build and Release

## Build pipeline

```bash
pnpm run clean && vite build --config vite.config.ts && vite build --config vite.config.content.ts
```

| Build                              | Output                       | Entries                                         |
| ---------------------------------- | ---------------------------- | ----------------------------------------------- |
| Main (`vite.config.ts`)            | `dist/`                      | popup, background SW, link, autofill HTML pages |
| Content (`vite.config.content.ts`) | `dist/assets/autofill-cs.js` | Single IIFE, `inlineDynamicImports: true`       |

`emptyOutDir: false` on both — `clean` script wipes `dist/` once before the sequence.

Watch dev: parallel `dev:main` + `dev:content`.

## Production hardening

| Setting         | Dev    | Production                      |
| --------------- | ------ | ------------------------------- |
| `sourcemap`     | `true` | `false`                         |
| `minify`        | none   | `terser`                        |
| `drop_debugger` | —      | `true`                          |
| `drop_console`  | —      | `["log", "info", "debug"]` only |

`warn` and `error` console calls remain in production builds.

## Manifest rewrite (production only)

On `mode === "production"` in `vite.config.ts`:

- `host_permissions` narrowed to the Online Services API host (`VITE_ONLINE_SERVICES_API_URL`, or `VITE_APP_URL` when that is empty) + Pusher host. The app origin only serves the share API, which allows any origin, so it gets no permission of its own.
- `VITE_EXTENSION_NAME_PREFIX` prepended to `name` / `action.default_title`
- Build fails if `VITE_APP_URL` missing, contains `REPLACE_ME`, or is not `https://`

Dev manifest keeps wildcard `https://*/*` and `http://*/*` host permissions.
Managed backup object-store PUT/GET is a CORS `fetch` from the popup. It does
not need the object-store host in production `host_permissions` when the
bucket already allows `chrome-extension://<id>` or `*`.

## Firefox build

`CRYPTEX_BROWSER=firefox` (or `pnpm build:ext -- --browser firefox`) runs the
same three Vite builds into `dist-firefox/` and rewrites the manifest for
Firefox:

- `background.scripts: ["background.js"]` with `type: "module"` instead of
  `service_worker`. Firefox has no MV3 service workers and runs the script as
  a non-persistent event page.
- `browser_specific_settings.gecko`: the add-on ID from
  `VITE_FIREFOX_EXTENSION_ID`, `strict_min_version` 140 and
  `data_collection_permissions: { required: ["none"] }`, which
  addons.mozilla.org requires for new add-ons.
- The build drops `minimum_chrome_version`.
- A build with a name prefix uses the prefixed toolbar title as its name,
  because Firefox rejects names over 45 characters.

Firefox behaves differently in a few places the code relies on:

- `chrome.action.openPopup()` needs Firefox 149 or later to work without a
  user gesture. Older versions reject the call, and the code treats it as
  best-effort, as it does in older Chrome versions.
- Firefox's idle API never reports `locked`, so a screen lock doesn't lock
  the vault. Only the 30-minute idle timeout does.
- Firefox grants MV3 host permissions, content script matches included, at
  install time. The user can revoke them in `about:addons`. The content scripts
  then stop running and autofill disappears on those sites.
- Firefox never exposes `chrome.storage.session` to content scripts and has
  no `setAccessLevel`. `session-dek-store.ts` calls it with optional
  chaining, so Firefox skips the call.
- Content scripts see page data and WebCrypto results from the page's realm.
  `instanceof ArrayBuffer` is false for those values, and their views throw
  "Permission denied to access property constructor" on `subarray()` or
  `slice()`. Copy such bytes with `copyBytes()` from `src/utils/bytes.ts`
  before using them.

## Aliases

| Alias          | Target                      |
| -------------- | --------------------------- |
| `@`            | `../web/src`                |
| `@/env/public` | `extension/src/env.ts`      |
| `@/utils/trpc` | `extension/src/trpc-ext.ts` |
| `pusher-js`    | `pusher-js/worker`          |

Shared vault, encryption, sync, and UI code come from the web package.

## Env validation

`extension/src/env.ts` + `vite.config.ts` enforce required vars in production.
Release builds take their values from `release-config.json` (production) or
`prerelease-config.json` (preprod) through `scripts/build.mjs`; development
builds use `.env.development.example`.

## Shipping checklist

1. Check `release-config.json`: HTTPS `VITE_APP_URL` and Pusher config.
2. Run the release build (`pnpm build:ext` from the repository root).
3. Load `dist/` as unpacked extension or publish to store. For Firefox, build
   with `--browser firefox` and check `dist-firefox/` the same way.
4. Verify `dist/manifest.json` has narrowed `host_permissions`.
5. Confirm no `*.map` files in production artifact.
6. Confirm `dist/wasm-libs/zxing_reader.wasm` is present and no `jsdelivr.net/npm/zxing-wasm` URL remains in JS.
