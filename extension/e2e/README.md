# Browser extension E2E tests

The Playwright harness launches the bundled Chromium build with
`extension/dist` loaded as an unpacked MV3 extension in a fresh persistent
profile. It uses a local relying-party fixture and exercises the real extension
service worker, encrypted message envelopes, extension IndexedDB, unlock flow,
in-page save iframe, credential persistence, lock/re-unlock, and vault UI.

## Run

```sh
pnpm test:e2e:install  # once per machine/CI image
pnpm test:e2e:extension
```

Use `pnpm test:e2e:extension:headed` to watch the flow. Failure traces,
screenshots, and videos are written below `test-results/e2e`. The aggregate
`pnpm test:e2e` command runs both the extension and web projects.

The E2E build uses `CRYPTEX_E2E=1` and development mode to add the private
`e2e-bootstrap.html` seed page; it is absent from production builds. The relying
party uses a real `navigator.credentials.create({ publicKey })` request. The
suite therefore exercises the production main-world detector, ES256 software
authenticator, save decision, encrypted vault persistence, lock, and re-unlock.

**NOTE:** An external smoke test covers Autofill.me's SimpleWebAuthn registration flow:

```sh
CRYPTEX_LIVE_E2E=1 pnpm test:e2e:extension
```

- It is skipped by default so the normal suite remains deterministic offline.
