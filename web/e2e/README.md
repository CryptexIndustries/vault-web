# Web app E2E tests

This Playwright project runs through `compose.e2e.yaml`. Compose builds the real
production Next.js app with cloud integrations disabled, waits for its health
check, and then runs Chromium from the version-matched Playwright image on the
same private network. Additional backing services can be added to that Compose
stack as coverage grows.

The runner exposes the app to its own browser through a loopback proxy. That
keeps Web Crypto available (browsers treat loopback as a trustworthy origin)
while the proxy reaches the app through Compose service DNS.

The specs in `tests/` cover the main vault journey (create, edit, search,
lock and unlock), importing, SSH keys and the SSH agent, the purchase journey,
device linking between two browsers, the vault's server settings, and backup
destinations.

The backup destination specs run against a real Garage. Each test makes its
own bucket and keys, then checks the bucket directly. They cover a refused key,
uploads after changes, pausing and removing, retention and "Keep every backup",
a password change that deletes older backups, restoring from the bucket, and a
linked browser that backs up to its own folder. Further tests cover
virtual-hosted addresses (`<bucket>.garage.e2e`), a key that loses its
permissions next to a destination that keeps working, a network outage, a
restore list of more than 1,000 backups, and restoring the backups the Android
app and the extension made (`e2e/fixtures/backups/`).

The web app only connects to `https:` addresses, so the browser reaches Garage
through a Caddy proxy. Its certificate comes from the fixed test CA in
`e2e/garage/tls/`, and the tests ignore certificate errors. Chromium starts
with `--host-resolver-rules` so that `garage.e2e` and its bucket subdomains
reach the proxy.

## Run

```sh
pnpm test:e2e:install # once per machine/CI image
pnpm test:e2e:web
```

Every run gets the self-hosted signaling (soketi) and TURN (coturn) servers
and Garage with its TLS proxy from `compose.e2e.yaml`. The Docker command
starts them in its stack. Runs on the host start the same containers from
`global-setup.ts`, publish them on loopback (`E2E_SIGNALING_PORT`, default
6001, `E2E_TURN_PORT`, default 3478, and `E2E_GARAGE_PORT`,
`E2E_GARAGE_ADMIN_PORT` and `E2E_GARAGE_TLS_PORT`, default 3910, 3913 and
3943), and stop them when Playwright exits. Host runs need Docker for this.

The Docker command downloads its own browser, so `test:e2e:install` is only
needed for local debugging. Use `pnpm test:e2e:web:local` for a fast host run or
`pnpm test:e2e:web:headed` to watch it. Failure traces, screenshots, and videos
are written below `test-results/web-e2e`; the Compose run writes its HTML report
below `playwright-report/web-e2e`. The command tears down its containers and
network after Playwright exits while preserving the test exit code.

The suite deliberately uses the public UI and a fresh IndexedDB database. It
does not seed vault state or enable test-only code in the web bundle.

To run the purchase journey against a web server with Online Services enabled
on port 3000:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 E2E_EXTERNAL_SERVER=1 \
  pnpm exec playwright test --config web/e2e/playwright.config.ts purchase-onboarding.spec.ts
```

This test uses a real browser and local vault creation. It intercepts the
Online Services API on port 3001, Turnstile, and Stripe, so it creates no real
account or checkout session.
