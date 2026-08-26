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

- `host_permissions` narrowed to API host (`VITE_APP_URL`) + Pusher host
- `VITE_EXTENSION_NAME_PREFIX` prepended to `name` / `action.default_title`
- Build fails if `VITE_APP_URL` missing, contains `REPLACE_ME`, or is not `https://`

Dev manifest keeps wildcard `https://*/*` and `http://*/*` host permissions.
Managed backup object-store PUT/GET is a CORS `fetch` from the popup. It does
not need the object-store host in production `host_permissions` when the
bucket already allows `chrome-extension://<id>` or `*`.

## Aliases

| Alias              | Target                      |
| ------------------ | --------------------------- |
| `@`                | `../web/src`                |
| `@/env/client.mjs` | `extension/src/env.ts`      |
| `@/utils/trpc`     | `extension/src/trpc-ext.ts` |
| `pusher-js`        | `pusher-js/worker`          |

Shared vault, encryption, sync, and UI code come from the web package.

## Env validation

`extension/src/env.ts` + `vite.config.ts` enforce required vars in production.
See `.env.development.example` and `.env.production.example`.

## Shipping checklist

1. Set production `.env` with HTTPS `VITE_APP_URL` and Pusher config.
2. Run full build (`pnpm run build` in `extension/`).
3. Load `dist/` as unpacked extension or publish to store.
4. Verify `dist/manifest.json` has narrowed `host_permissions`.
5. Confirm no `*.map` files in production artifact.
6. Confirm `dist/wasm-libs/zxing_reader.wasm` is present and no `jsdelivr.net/npm/zxing-wasm` URL remains in JS.
