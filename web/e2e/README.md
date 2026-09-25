# Web app E2E tests

This Playwright project runs through `compose.e2e.yaml`. Compose builds the real
production Next.js app with cloud integrations disabled, waits for its health
check, and then runs Chromium from the version-matched Playwright image on the
same private network. Additional backing services can be added to that Compose
stack as coverage grows.

The runner exposes the app to its own browser through a loopback proxy. That
keeps Web Crypto available (browsers treat loopback as a trustworthy origin)
while the proxy reaches the app through Compose service DNS.

The initial journey covers local vault creation, recovery-code acknowledgement,
credential create, search, edit and delete, encrypted persistence, and
lock/re-unlock.

## Run

```sh
pnpm test:e2e:install # once per machine/CI image
pnpm test:e2e:web
```

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
