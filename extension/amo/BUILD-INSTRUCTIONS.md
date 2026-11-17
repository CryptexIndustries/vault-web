# Building the Cryptex Vault Firefox extension

This archive holds the source for version @VERSION@, commit @COMMIT@. It
contains the extension and the workspace packages it imports. The build doesn't
use the mobile apps, server code, tests or documentation, so the archive leaves
them out.

## Requirements

- Linux x86_64. Our release pipeline rebuilds both add-ons from this archive on
  Ubuntu and checks that the output matches the uploaded packages.
- Node.js 24.22.2
- pnpm 11.28.9, for example `npm install --global pnpm@11.28.9`
- Internet access for the dependency install

## Steps

Run these from the folder that holds this file:

```bash
pnpm install --frozen-lockfile
pnpm build:ext -- --profile preprod --browser firefox
```

The build writes the extension to `extension/dist-firefox/`. Compare that
folder with the contents of the uploaded package.

For the production add-on, replace the second command with:

```bash
pnpm build:ext -- --browser firefox
```

## How the build works

`extension/scripts/build.mjs` runs Vite three times: the main build, the
content script and the passkey page bridge. It reads public configuration from
`extension/prerelease-config.json` for preprod and
`extension/release-config.json` for production. The build needs no secrets or
private environment variables.

The extension imports shared code from `web/src` and `packages/`, so those
folders are part of the source.

`web/public/wasm-libs/zxing_reader.wasm` is the unmodified WebAssembly build
from the `zxing-wasm` npm package. libsodium also ships as WebAssembly inside
its npm package.
