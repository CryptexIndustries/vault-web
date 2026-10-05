# Docker Swarm deployment

The Swarm stack runs the web client as a single service and publishes it on
port `3000`. It includes a health check, rolling updates, and automatic rollback
when an update fails.

## Before you start

You need:

- A Docker Swarm manager
- TCP port `3000` reachable by a HTTPS-capable proxy, but not exposed directly to the internet
- An exact image tag to deploy
- GHCR credentials if the image package is private

The vault must be served to users over HTTPS. Besides protecting application
traffic, HTTPS provides the secure browser context required by features such as
WebAuthn. The stack intentionally leaves certificate management to the ingress
or reverse-proxy layer.

## Image tags

Production images are built and published only when you push a `web-v*` Git tag.
Use `web-vMAJOR.MINOR.PATCH`, such as `web-v1.4.2`, or a prerelease tag such as
`web-v1.4.2-rc1`. Each release publishes both the full commit SHA tag and the
matching release tag. Branch pushes and `extension-*` tags do not publish web
images.

After checking out the commit you want to release, create and push its tag:

```bash
git tag -a web-v1.4.2 -m "Web release 1.4.2"
git push origin web-v1.4.2
```

The CI lockfile and web quality checks must pass before the image is published.

```text
ghcr.io/cryptexindustries/vault-web:<commit-sha-or-release-tag>
```

Choose the exact version you want and set it through the `APP_IMAGE` environment
variable. The stack refuses to render when `APP_IMAGE` is missing or empty.

## Configuration

The same image can be used for local-only and cloud-connected deployments. The
web client reads its public settings from the container environment at startup.
The runtime configuration is validated and is also used to build the Content
Security Policy.

| Variable                                      | What it controls                                    |
| --------------------------------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                         | Public URL of the web client                        |
| `NEXT_PUBLIC_CLOUD_ENABLED`                   | Enables the online-services UI; defaults to `false` |
| `NEXT_PUBLIC_ONLINE_SERVICES_API_URL`         | API origin; falls back to the app URL when empty    |
| `NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN`           | Origin used for direct backup transfers             |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`              | Cloudflare Turnstile site key                       |
| `NEXT_PUBLIC_PUSHER_APP_ID`                   | Pusher application ID                               |
| `NEXT_PUBLIC_PUSHER_APP_KEY`                  | Pusher public application key                       |
| `NEXT_PUBLIC_PUSHER_APP_HOST`                 | Pusher host                                         |
| `NEXT_PUBLIC_PUSHER_APP_PORT`                 | Pusher port                                         |
| `NEXT_PUBLIC_PUSHER_APP_TLS`                  | Enables TLS for Pusher connections                  |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`          | Stripe publishable key                              |
| `NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID`       | Stripe premium product ID                           |
| `NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID` | Stripe monthly price ID                             |
| `NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID`  | Stripe yearly price ID                              |

For a local-only deployment, the defaults in `compose.swarm.yaml` are enough.
For a cloud-connected deployment, set the real Turnstile, Pusher, Stripe, API,
and storage values before deploying.

### Secrets

Anything prefixed with `NEXT_PUBLIC_` is sent to the browser. These values are
configuration, not secrets. Never put credentials or private keys in them.

The web client currently has no server-side secrets, so this stack does not
declare any Docker secrets. If that changes, add the credential as an external
Swarm secret and read it from `/run/secrets`; please do not bake it into the image
or commit a secret file.

## GHCR login

Public image packages can be pulled without logging in. For a private package,
create a classic personal access token with `read:packages`, then log in on the
Swarm manager:

```bash
read -rsp "GHCR token: " GHCR_TOKEN
echo

printf '%s' "$GHCR_TOKEN" |
  docker login ghcr.io \
    --username <github-username> \
    --password-stdin

unset GHCR_TOKEN
```

Use the same operating-system account for `docker login` and
`docker stack deploy`. The `--with-registry-auth` flag passes those credentials
to the worker nodes.

## Deploy the stack

### 1. Choose an image

```bash
export APP_IMAGE="ghcr.io/cryptexindustries/vault-web:<commit-sha>"
```

### 2. Set the application configuration

This example enables online services:

```bash
export NEXT_PUBLIC_APP_URL="https://vault.example.com"
export NEXT_PUBLIC_CLOUD_ENABLED="true"
export NEXT_PUBLIC_ONLINE_SERVICES_API_URL="https://cloud.example.com"
export NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN="https://objects.example.com"
export NEXT_PUBLIC_TURNSTILE_SITE_KEY="<turnstile-site-key>"
export NEXT_PUBLIC_PUSHER_APP_ID="<pusher-app-id>"
export NEXT_PUBLIC_PUSHER_APP_KEY="<pusher-app-key>"
export NEXT_PUBLIC_PUSHER_APP_HOST="<pusher-host>"
export NEXT_PUBLIC_PUSHER_APP_PORT="443"
export NEXT_PUBLIC_PUSHER_APP_TLS="true"
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="<stripe-publishable-key>"
export NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID="<stripe-product-id>"
export NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID="<stripe-monthly-price-id>"
export NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID="<stripe-yearly-price-id>"
```

### 3. Validate and deploy

```bash
docker stack config -c compose.swarm.yaml >/dev/null
docker stack deploy --with-registry-auth -c compose.swarm.yaml cryptex-vault-web
```

For a local test with a local image, make sure the image exists on every node
and replace `--with-registry-auth` with `--resolve-image never`.

The app is available at `http://<swarm-node>:3000` once the service is healthy.

### 4. Check the rollout

```bash
docker stack services cryptex-vault-web
docker service ps cryptex-vault-web_web --no-trunc
docker service logs cryptex-vault-web_web
```

## Deploy an update

Point `APP_IMAGE` at the new SHA or release tag, then run the same
`docker stack deploy` command again. Swarm updates one task at a time and starts
the replacement before stopping the old task. A failed update rolls back
automatically.
