# Docker Swarm deployment

The Swarm stack runs the web client as a single service and publishes it on
port `3000`. It includes a health check, rolling updates, and automatic rollback
when an update fails.

The share server behind one-time share links runs in a stack of its own, so web
releases never restart it. See [Share server stack](#share-server-stack). The
agent relay for the keyless SSH agent is a separate stack too. See
[Agent relay stack](#agent-relay-stack).

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
| `NEXT_PUBLIC_RELAY_URL`                       | Hosted SSH agent relay; empty uses the default      |
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
| `SHARE_SERVER_INTERNAL_URL`                   | Share server address; defaults to the share stack   |
| `STACK_NAME`                                  | Prefix of the shared network name                   |

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

The web stack joins the external overlay network
`${STACK_NAME}_cryptex-vault-network`, which it shares with the share server
stack. `STACK_NAME` defaults to `cryptex-vault-frontend`. Use the same value
for both stacks. If the network doesn't exist yet, create it once:

```bash
docker network create --driver overlay cryptex-vault-frontend_cryptex-vault-network
```

```bash
docker stack config -c compose.swarm.yaml >/dev/null
docker stack deploy --with-registry-auth -c compose.swarm.yaml cryptex-vault-frontend
```

For a local test with a local image, make sure the image exists on every node
and replace `--with-registry-auth` with `--resolve-image never`.

The app is available at `http://<swarm-node>:3000` once the service is healthy.

### 4. Check the rollout

```bash
docker stack services cryptex-vault-frontend
docker service ps cryptex-vault-frontend_web --no-trunc
docker service logs cryptex-vault-frontend_web
```

## Deploy an update

Point `APP_IMAGE` at the new SHA or release tag, then run the same
`docker stack deploy` command again. Swarm updates one task at a time and starts
the replacement before stopping the old task. A failed update rolls back
automatically.

## Share server stack

`services/cmd/share-server/compose.swarm.yaml` runs `share`, the open-source server behind
one-time share links. It holds only encrypted contents and token hashes, in
SQLite on the `share_data` volume. SQLite has one writer, so the stack runs one
replica with `stop-first` updates on a single labelled node.

The web container forwards `/share-api/*` to it over the network both stacks
share, so the share server needs no published port or proxy rule of its own.

### Networks and node

The share stack joins two existing external overlay networks:

| Network                                       | Shared with           | Used for                        |
| --------------------------------------------- | --------------------- | ------------------------------- |
| `${STACK_NAME}_cryptex-vault-network`         | Web stack             | `/share-api/*` from the web app |
| `${METRICS_STACK_NAME}_cryptex-vault-metrics` | Online Services stack | `/metrics` scrapes by Alloy     |

`STACK_NAME` defaults to `cryptex-vault-frontend` and must match the value used
for the web stack. `METRICS_STACK_NAME` defaults to `cryptex`. Without the
Online Services stack, create the metrics network yourself:

```bash
docker network create --driver overlay cryptex_cryptex-vault-metrics
```

Pin the share server to one node, because the volume lives there. Moving it
would start with an empty database and break every open link:

```bash
docker node update --label-add cryptex-vault.share=true <node>
```

### Image tags

The share server is released separately from the web app. Push a
`share-server-v*` tag, such as `share-server-v1.0.0`, and CI publishes:

```text
ghcr.io/cryptexindustries/vault-web/share-server:v1.0.0
ghcr.io/cryptexindustries/vault-web/share-server:<commit-sha>
```

The tag must look like `share-server-v1.2.3` or `share-server-v1.2.3-rc1`. The
job fails on anything else. The Go quality checks must pass first, and `web-v*`
tags don't publish this image.

### Configuration

`docker stack deploy` does not read a `.env` file, so export these before
deploying. Keep them separate from the web stack's variables.

| Variable                     | What it controls                                                       |
| ---------------------------- | ---------------------------------------------------------------------- |
| `SHARE_IMAGE`                | Required. Exact share server image tag                                 |
| `SHARE_AUTH`                 | `token` (default) or `ticket` for Online Services subscriber tickets   |
| `SHARE_CREATION_TOKENS`      | Comma-separated creation tokens, 32+ characters each (`token` mode)    |
| `SHARE_CREATION_TOKENS_FILE` | Path to a file with the tokens, such as a Swarm secret                 |
| `NEXT_PUBLIC_APP_URL`        | Public web origin; tickets must name it (`ticket` mode)                |
| `SHARE_TICKET_AUDIENCE`      | Overrides `NEXT_PUBLIC_APP_URL` as the ticket audience                 |
| `SHARE_TICKET_PUBLIC_KEYS`   | `<kid>:<base64 ML-DSA-65 public key>`, comma-separated (`ticket` mode) |
| `SHARE_CLIENT_IP_HEADER`     | Header with the real client address; defaults to `X-Forwarded-For`     |
| `SHARE_TRUSTED_PROXY_HOPS`   | Proxies that append to that header; defaults to `1`                    |
| `SHARE_METRICS_ADDR`         | Metrics listener; defaults to `:9090`, `off` turns it off              |
| `STACK_NAME`                 | Shared network prefix; same value as the web stack                     |
| `METRICS_STACK_NAME`         | Online Services stack name; defaults to `cryptex`                      |

In `ticket` mode the server reduces the audience to an origin, so a trailing
slash or path doesn't matter, and it refuses to start if neither variable holds
an `http(s)` URL. Use the same value as the web stack's `NEXT_PUBLIC_APP_URL`.

Rate limits are per client address. Each proxy appends the address it saw
to `X-Forwarded-For`, and the web container passes the header through
unchanged. The share server counts `SHARE_TRUSTED_PROXY_HOPS` entries from the
right and ignores anything a client wrote further left. With one HTTPS proxy,
keep the default of `1`, and add one per extra proxy in the chain. Behind
Cloudflare, set `SHARE_CLIENT_IP_HEADER=CF-Connecting-IP`.

The proxy must also offer the hybrid post-quantum key exchange X25519MLKEM768.
Cloudflare, current Caddy and any proxy built with Go 1.24 or later do this by
default.

Prefer a Swarm secret for creation tokens:

```bash
openssl rand -hex 32 | docker secret create share_creation_tokens -
export SHARE_CREATION_TOKENS_FILE=/run/secrets/share_creation_tokens
```

Then add the secret to the `share` service in a local override file. Tickets
need no secret on this side: the share server only holds the API's public key.

### Metrics

The share server serves Prometheus metrics at `/metrics` on port `9090`, a
listener separate from the API. The port is never published, and the web
container only forwards `/share-api/*`, so the endpoint is reachable only from
containers on the share server's two networks. Alloy scrapes it on the metrics
network.

Metrics count requests by route and status, created, opened, revoked, burned
and expired shares, wrong passphrases, rate-limit hits, refused creates by
reason, sweeper runs, stored shares by status and the database size, plus Go
runtime and process metrics. They never include share IDs, account subjects or
client addresses. Set `SHARE_METRICS_ADDR=off` to turn them off.

### Deploy and update

```bash
export SHARE_IMAGE="ghcr.io/cryptexindustries/vault-web/share-server:v1.0.0"
docker stack config -c services/cmd/share-server/compose.swarm.yaml >/dev/null
docker stack deploy --with-registry-auth -c services/cmd/share-server/compose.swarm.yaml cryptex-vault-services
docker service logs cryptex-vault-services_share
```

To update, point `SHARE_IMAGE` at the new tag and run the same deploy command.
Swarm stops the old task before starting the new one, so share links are
unavailable for a few seconds.

## Agent relay stack

`services/cmd/relay-server/compose.swarm.yaml` runs `relay`, the open-source
server between `cryptex-agent` and the device that approves its SSH requests.
It forwards end-to-end encrypted envelopes and never sees private keys or what
is being signed. Registrations (which agents belong to which approver) and
retained envelopes live in SQLite on the `relay_data` volume, so the stack runs
one replica with `stop-first` updates on a single labelled node. Sign requests
wait in memory only.

Unlike the share server, the relay has its own public URL, such as
`https://relay.example.com`. Clients connect to it directly over WebSockets,
not through the web container.

### Networks and node

The relay stack joins two existing external overlay networks:

| Network                                       | Shared with           | Used for                      |
| --------------------------------------------- | --------------------- | ----------------------------- |
| `${RELAY_PROXY_NETWORK}`                      | Your HTTPS proxy      | Client traffic to port `8080` |
| `${METRICS_STACK_NAME}_cryptex-vault-metrics` | Online Services stack | `/metrics` scrapes by Alloy   |

`RELAY_PROXY_NETWORK` defaults to `cryptex-vault-relay-proxy`. Create it once
and attach your proxy to it. The proxy reaches the relay at
`http://cryptex-vault-relay:8080`:

```bash
docker network create --driver overlay cryptex-vault-relay-proxy
```

Without the Online Services stack, create the metrics network as described for
the share server.

Pin the relay to one node, because the volume lives there. Moving it would
start with an empty database, and every agent would have to be paired again:

```bash
docker node update --label-add cryptex-vault.relay=true <node>
```

### Proxy requirements

- Pass WebSocket upgrades through for `/v1/connect` and `/v1/pair`, and plain
  `POST` requests for `/v1/revoke`. Don't publish port `8080` directly.
- Keep idle WebSockets open for longer than `RELAY_KEEPALIVE_SECONDS`. Clients
  ping when they have sent nothing for that long, and the relay closes
  connections silent for twice as long plus 10 seconds. Cloudflare drops
  WebSockets after 100 seconds of silence, so set `RELAY_KEEPALIVE_SECONDS=90`
  behind it. The default of 240 suits proxies you control.
- Offer the hybrid post-quantum key exchange X25519MLKEM768, as for the share
  server.
- Set the client address header. Rate limits on pairing, connections and
  revokes are per address, counted `RELAY_TRUSTED_PROXY_HOPS` entries from the
  right of `RELAY_CLIENT_IP_HEADER`. IPv6 clients count per /64 network. Caps
  on sockets waiting for Auth and on open pairing sockets also count per IPv6
  /48 and IPv4 /24. Without the header every client shares the proxy's
  address, and they hit each other's limits. Behind Cloudflare, set
  `RELAY_CLIENT_IP_HEADER=CF-Connecting-IP`.

### Image tags

The relay is released separately. A `relay-server-v*` tag, such as
`relay-server-v0.1.0`, publishes:

```text
ghcr.io/cryptexindustries/vault-web/relay-server:v0.1.0
ghcr.io/cryptexindustries/vault-web/relay-server:<commit-sha>
```

The tag must look like `relay-server-v1.2.3` or `relay-server-v1.2.3-rc1`.

### Configuration

Export these before deploying. `docker stack deploy` does not read a `.env`
file.

| Variable                        | What it controls                                                            |
| ------------------------------- | --------------------------------------------------------------------------- |
| `RELAY_IMAGE`                   | Required. Exact relay image tag                                             |
| `RELAY_PUBLIC_URL`              | Required. Public URL; clients sign its origin and passes must name it       |
| `RELAY_AUTH_MODE`               | `token` (default, self-hosted) or `ticket` for Online Services relay passes |
| `RELAY_ACCESS_TOKEN`            | Token every client presents, 32+ characters (`token` mode)                  |
| `RELAY_ACCESS_TOKEN_FILE`       | Path to a file with the token, such as a Swarm secret                       |
| `RELAY_PASS_PUBLIC_KEYS`        | `<kid>:<base64 ML-DSA-65 public key>`, comma-separated (`ticket` mode)      |
| `RELAY_PASS_PUBLIC_KEYS_FILE`   | Path to a file with the keys                                                |
| `RELAY_MAX_AGENTS`              | Agents on the whole relay in `token` mode; defaults to `25`                 |
| `RELAY_KEEPALIVE_SECONDS`       | Keep-alive interval announced to clients, 10 to 3600; defaults to `240`     |
| `RELAY_CLIENT_IP_HEADER`        | Header with the real client address; defaults to `X-Forwarded-For`          |
| `RELAY_TRUSTED_PROXY_HOPS`      | Proxies that append to that header; defaults to `1`                         |
| `RELAY_MAX_PAIRING_SLOTS`       | Open pairing sockets on the whole relay; defaults to `1000`                 |
| `RELAY_REGISTRATION_GRACE_DAYS` | Days agents stay registered after the approver's last pass expired; `30`    |
| `RELAY_MAX_PENDING_CONNECTIONS` | Connections allowed to wait for Auth at once, then HTTP 503; `1000`         |
| `RELAY_MAX_QUEUE_BYTES`         | Bytes of messages held in memory, at least 1 MiB; defaults to 64 MiB        |
| `RELAY_MAX_ACCOUNT_QUEUE_BYTES` | The same per account, then `LIMIT_REACHED`; at least 1 MiB; 4 MiB default   |
| `RELAY_GOMEMLIMIT`              | Go memory limit, below the stack's `384M` limit; defaults to `320MiB`       |
| `RELAY_METRICS_ADDR`            | Metrics listener; defaults to `:9090`, `off` turns it off                   |
| `RELAY_PROXY_NETWORK`           | Network shared with the HTTPS proxy                                         |
| `METRICS_STACK_NAME`            | Online Services stack name; defaults to `cryptex`                           |

The relay reduces `RELAY_PUBLIC_URL` to an origin, so a trailing slash or path
doesn't matter, and it refuses to start if the value isn't an `http(s)` URL.

In `token` mode one token is one owner: approvers and agents all present it,
and the agent limit counts every agent on the relay. Approvers receive the
token when you enter it in their settings and hand it to each agent they pair,
so changing it means pairing every agent again. Prefer a Swarm secret:

```bash
openssl rand -hex 32 | docker secret create relay_access_token -
export RELAY_ACCESS_TOKEN_FILE=/run/secrets/relay_access_token
```

Then add the secret to the `relay` service in a local override file. In
`ticket` mode the relay needs no secret: it only holds the API's public keys.

### Metrics

The relay serves Prometheus metrics at `/metrics` on port `9090`, a listener
separate from the API that is never published. Alloy scrapes it on the metrics
network.

Metrics count connections and open connections by role, refused
authentications, client frames by type, sends by result, deliveries, expired
envelopes, open pairing slots and how slots ended, revoked agents by source,
`/v1/revoke` results, rate-limit hits and sweeper runs, plus registered agents
and approvers, retained envelopes, and Go runtime and process metrics. They
never include keys, slot IDs, account subjects or client addresses. Set
`RELAY_METRICS_ADDR=off` to turn them off.

### Deploy and update

```bash
export RELAY_IMAGE="ghcr.io/cryptexindustries/vault-web/relay-server:v0.1.0"
export RELAY_PUBLIC_URL="https://relay.example.com"
docker stack config -c services/cmd/relay-server/compose.swarm.yaml >/dev/null
docker stack deploy --with-registry-auth -c services/cmd/relay-server/compose.swarm.yaml cryptex-vault-relay
docker service logs cryptex-vault-relay_relay
```

To update, point `RELAY_IMAGE` at the new tag and run the same deploy command.
Swarm stops the old task before starting the new one. Clients reconnect on
their own; a sign request in flight during the restart fails and the user runs
the command again. Registrations and retained envelopes stay.
