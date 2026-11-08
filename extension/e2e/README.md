# Browser extension E2E tests

The Playwright harness launches the bundled Chromium build with
`extension/dist` loaded as an unpacked MV3 extension in a fresh persistent
profile. It uses a local relying-party fixture and exercises the real extension
service worker, encrypted message envelopes, extension IndexedDB, unlock flow,
in-page save iframe, credential persistence, lock/re-unlock, and vault UI.

The same specs run on Firefox with `extension/dist-firefox` installed as a
temporary add-on. Playwright can't drive Firefox's extension pages, so
`firefox/` is a WebDriver BiDi driver with the part of Playwright's API the
specs use. A spec that needs more of that API may need it added there. Specs
keep opening `chrome-extension://${extensionId}/` URLs; on Firefox the
driver opens them as `moz-extension://`.

## Run

```sh
pnpm test:e2e:install  # once per machine/CI image
pnpm test:e2e:extension
```

Use `pnpm test:e2e:extension:headed` to watch the flow. Failure traces,
screenshots, and videos are written below `test-results/e2e`. The aggregate
`pnpm test:e2e` command runs both the extension and web projects.

For Firefox:

```sh
pnpm test:e2e:install:firefox  # once per machine
pnpm test:e2e:extension:firefox
```

The install script downloads the pinned Firefox release into
`~/.cache/cryptex-vault-e2e` and checks its SHA-512. It only downloads for
Linux x64; elsewhere, set `CRYPTEX_FIREFOX_PATH` to a Firefox executable. A
failed Firefox test attaches the browser's console output instead of a trace.

The backup destination tests upload to a real Garage. Global setup starts it
from `compose.e2e.yaml` on loopback and stops it when Playwright exits, so the
run needs Docker. It listens on `E2E_GARAGE_PORT` (default 3910),
`E2E_GARAGE_ADMIN_PORT` (3913) and `E2E_GARAGE_TLS_PORT` (3943). Each test
makes its own bucket and keys. Both browsers resolve `garage.e2e` and its
bucket subdomains to Garage for the virtual-hosted test, which uses the https port
because the extension allows plain http only on loopback. Several tests wait
out the 30-second upload delay, so the file takes about five minutes.

The E2E build uses `CRYPTEX_E2E=1` and development mode to add the private
`e2e-bootstrap.html` seed page; it is absent from production builds. The relying
party uses a real `navigator.credentials.create({ publicKey })` request. The
suite therefore exercises the production main-world detector, ES256 software
authenticator, save decision, encrypted vault persistence, vault-password user
verification, assertion generation, RP hash/flag validation, server-side ES256
signature verification, lock, and re-unlock.

**NOTE:** An external smoke test covers Autofill.me's SimpleWebAuthn registration flow:

```sh
CRYPTEX_LIVE_E2E=1 pnpm test:e2e:extension
```

- It is skipped by default so the normal suite remains deterministic offline.
