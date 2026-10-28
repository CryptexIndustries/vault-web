import Link from "next/link";
import { useState } from "react";
import { REPO } from "@/components/marketing/site";
import {
    DocArticle,
    DocCallout,
    DocSection,
    DocScreenshot,
} from "@/components/marketing/doc-article";
import { DocCode } from "@/components/marketing/doc-code";
import t from "@/styles/TechnicalDocs.module.css";
import d from "@/styles/Docs.module.css";

const files = `${REPO}/tree/master/deploy/self-hosting`;
const sourceSetup = `# Download the source and select the release to build
git clone https://github.com/CryptexIndustries/vault-web.git
cd vault-web
git checkout REPLACE_WITH_RELEASE_TAG_OR_COMMIT
# Record this revision with your deployment notes
git rev-parse HEAD
cd deploy/self-hosting`;
const imageSetup = `# Stop this block if any command fails, without closing your terminal
(
set -e
# Create a directory for this deployment
mkdir -p cryptex-self-hosted
cd cryptex-self-hosted
# Replace this placeholder before running the download loop
RELEASE=REPLACE_WITH_RELEASE_TAG_OR_COMMIT
# Download the configuration templates and certificate hook from the same release
for file in compose.yaml Caddyfile .env.example turnserver.conf.example deploy-turn-certificate.sh; do
  curl --fail --show-error --location --output "$file" \\
    "https://raw.githubusercontent.com/CryptexIndustries/vault-web/$RELEASE/deploy/self-hosting/$file" || {
      echo "Download failed: $file. Check the release and connection before continuing." >&2
      exit 1
    }
done
echo "All deployment files downloaded."
) && cd cryptex-self-hosted`;
const prepare = `# Create editable configuration files
cp .env.example .env
cp turnserver.conf.example turnserver.conf
# Allow only the owner to read and write these files
chmod 600 .env turnserver.conf
# Copy this output into SOKETI_APP_KEY in .env
openssl rand -hex 32
# Copy this output into SOKETI_APP_SECRET in .env
openssl rand -hex 32
# Copy this output after your username in turnserver.conf
openssl rand -hex 32
# Copy this output into RELAY_ACCESS_TOKEN in .env
openssl rand -hex 32`;

export default function SelfHosting() {
    const [method, setMethod] = useState<"image" | "source">("image");
    const [turnTls, setTurnTls] = useState(true);
    const [serverTab, setServerTab] = useState<"signaling" | "stun" | "turn">(
        "signaling",
    );
    const fromSource = method === "source";
    return (
        <DocArticle
            title="Self-hosting"
            description="Set up the web application, signaling, STUN/TURN, and the SSH agent relay on your own server."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#scope", label: "Before you start" },
                { href: "#client", label: "Get the files" },
                { href: "#production", label: "DNS and firewall" },
                { href: "#configure", label: "Configure the services" },
                { href: "#start", label: "Start the stack" },
                { href: "#sync", label: "Configure Cryptex Vault" },
                { href: "#verify", label: "Test synchronization and TURN" },
                { href: "#share-server", label: "One-time share links" },
                { href: "#agent-relay", label: "SSH agent relay" },
                { href: "#operations", label: "Updates and troubleshooting" },
            ]}
            related={[
                { href: "/docs/linking-devices", title: "Linking devices" },
                { href: "/docs/backups", title: "Backups" },
                { href: "/docs/ssh-agent", title: "SSH agent" },
            ]}
        >
            <DocSection id="scope" title="1. Before you start">
                <div
                    className={d.platformSelector}
                    role="group"
                    aria-label="Deployment method"
                >
                    <button
                        type="button"
                        aria-pressed={!fromSource}
                        aria-controls="deployment-setup deployment-start deployment-update"
                        onClick={() => setMethod("image")}
                    >
                        Published image
                    </button>
                    <button
                        type="button"
                        aria-pressed={fromSource}
                        aria-controls="deployment-setup deployment-start deployment-update"
                        onClick={() => setMethod("source")}
                    >
                        Build from source
                    </button>
                </div>
                <p>
                    {fromSource
                        ? "Clone a release and build the web application on your server. Complete the checks below before downloading the files."
                        : "Deploy a published image using the supplied configuration files. Complete the checks below before downloading the files."}
                </p>
                <p>
                    Deploy the web application with Caddy for HTTPS, Soketi for
                    signaling, and coturn for STUN/TURN. The stack also runs the
                    share server for one-time links and the relay for the SSH
                    agent. You do not need an Online Services subscription. Use
                    manual vault backups with this setup; it does not include
                    managed backups.
                </p>
                <h3>Prepare your server and domain</h3>
                <ul className={d.requirements}>
                    <li>
                        Provision an Ubuntu 24.04 LTS server with a public IPv4
                        address. Sign in with an unprivileged user that has
                        administrator access through <code>sudo</code>.
                        {fromSource &&
                            " Allow extra memory for the production build. Start with 4 GB and increase it if the build runs out of memory."}
                    </li>
                    <li>
                        Install{" "}
                        <a href="https://docs.docker.com/engine/install/ubuntu/">
                            Docker Engine and the Compose plugin
                        </a>
                        , {fromSource && "Git, "}
                        <code>curl</code>, and OpenSSL. Verify with{" "}
                        <code>docker compose version</code>. Confirm your user
                        can run Docker before continuing.
                    </li>
                    <li>
                        Choose a domain you can edit and locate the server's
                        firewall settings. Ports <code>80</code>,{" "}
                        <code>443</code>, and <code>5349</code> must not already
                        belong to another service.
                    </li>
                    <li>
                        Set aside two devices for the final test. Connect one to
                        your home network and the other to mobile data.
                    </li>
                </ul>
                <DocCallout title="Your vaults stay on your devices">
                    <p>
                        Export an encrypted <code>.cryx</code> backup before
                        moving an existing vault to this deployment. Store it
                        separately from the server. Changing the web
                        application's hostname, scheme, or port creates a
                        different browser storage origin; existing vaults do not
                        move with it.
                    </p>
                </DocCallout>
                <p>
                    Use the recommended TLS TURN setup below. It encrypts the
                    connection between each client and coturn on TCP{" "}
                    <code>5349</code>. Vault synchronization is also end-to-end
                    encrypted between devices. Use the{" "}
                    <a href="#start">regular TURN alternative in step 5</a> only
                    if you deliberately want a setup without TURN TLS. Run these
                    steps on Linux, not Docker Desktop, and keep coturn's host
                    networking enabled.
                </p>
            </DocSection>
            <DocSection id="client" title="2. Get the deployment files">
                <div id="deployment-setup">
                    <p>
                        Choose a release tag or commit from the{" "}
                        <a href={`${REPO}/releases`}>releases</a> and replace
                        the placeholder below before running these commands on
                        the VPS. Inspect the files in the{" "}
                        <a href={files}>deployment directory</a> if needed.
                        {fromSource
                            ? " Save the printed revision with your deployment notes."
                            : " Use the same release for the configuration files and the image."}
                    </p>
                    <DocCode>{fromSource ? sourceSetup : imageSetup}</DocCode>
                    {!fromSource && (
                        <p>
                            Continue only after you see "All deployment files
                            downloaded." If a download fails, check the release
                            and connection, then rerun the block from the same
                            directory.
                        </p>
                    )}
                    <p>
                        Prepare your local settings and generate four separate
                        credentials:
                    </p>
                    <DocCode>{prepare}</DocCode>
                </div>
                <p>
                    Use the four generated values for the Soketi key, Soketi
                    secret, TURN password, and SSH agent relay access token
                    respectively. Do not reuse the example placeholders. The
                    real <code>.env</code> and <code>turnserver.conf</code>{" "}
                    files contain credentials and must remain outside the web
                    application's public directory.
                </p>
            </DocSection>
            <DocSection
                id="production"
                title="3. Set DNS and open the firewall"
            >
                <p>
                    Create these DNS-only <code>A</code> records pointing to the
                    VPS's public IPv4 address. Replace <code>example.com</code>{" "}
                    with your domain. Do not publish <code>AAAA</code> records
                    for this IPv4-only setup or put these names behind a CDN
                    proxy.
                </p>
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th>DNS name</th>
                                <th>Purpose</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>vault.example.com</code>
                                </td>
                                <td>Web application over HTTPS</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>signal.example.com</code>
                                </td>
                                <td>
                                    Secure WebSocket signaling through Caddy
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <code>turn.example.com</code>
                                </td>
                                <td>TURN TLS and certificate validation</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Allow these inbound ports in both the VPS provider's
                    firewall and the host firewall. Secure SSH using{" "}
                    <a href="https://ubuntu.com/server/docs/how-to/security/openssh-server/">
                        Ubuntu’s OpenSSH guide
                    </a>{" "}
                    and configure the host firewall using{" "}
                    <a href="https://ubuntu.com/server/docs/how-to/security/firewalls/">
                        Ubuntu’s UFW guide
                    </a>
                    . Verify a second SSH session works before closing the first
                    or changing access rules. Follow{" "}
                    <a href="https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw">
                        Docker’s UFW guidance
                    </a>
                    : published container ports can bypass UFW. Use the provider
                    firewall to enforce the public allowlist.
                </p>
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th>Port</th>
                                <th>Protocol</th>
                                <th>Purpose</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>80</code>
                                </td>
                                <td>TCP</td>
                                <td>Certificate issuance and HTTPS redirect</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>443</code>
                                </td>
                                <td>TCP</td>
                                <td>Web application and signaling</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>5349</code>
                                </td>
                                <td>TCP</td>
                                <td>Recommended TURN over TLS</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>3478</code>
                                </td>
                                <td>UDP and TCP</td>
                                <td>Optional STUN and regular TURN only</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>49160-49260</code>
                                </td>
                                <td>UDP</td>
                                <td>TURN relay allocations</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Leave <code>3478</code> closed for the TLS-only setup. Keep
                    the UDP relay range open even when clients connect over TLS.
                    Allow outbound DNS, HTTPS, and traffic to peers on arbitrary
                    UDP ports. Do not expose ports <code>3000</code> or{" "}
                    <code>6001</code>. Caddy reaches those services over the
                    private Docker network.
                </p>
            </DocSection>
            <DocSection
                id="configure"
                title="4. Fill in two configuration files"
            >
                <h3>Environment settings</h3>
                <p>
                    Edit <code>.env</code>. Set <code>VAULT_DOMAIN</code>,{" "}
                    <code>SIGNAL_DOMAIN</code>, <code>TURN_DOMAIN</code>, and{" "}
                    <code>ACME_EMAIL</code>. Leave{" "}
                    <code>SOKETI_APP_ID=cryptex-self-hosted</code> and replace{" "}
                    <code>SOKETI_APP_KEY</code> and{" "}
                    <code>SOKETI_APP_SECRET</code> with your generated values.{" "}
                    {fromSource ? (
                        <>
                            Set{" "}
                            <code>
                                VAULT_IMAGE=cryptex-vault-self-hosted:initial
                            </code>{" "}
                            and{" "}
                            <code>
                                SHARE_IMAGE=cryptex-vault-share-server:initial
                            </code>
                            , and{" "}
                            <code>
                                RELAY_IMAGE=cryptex-vault-relay-server:initial
                            </code>
                            , and uncomment{" "}
                            <code>
                                COMPOSE_FILE=compose.yaml:compose.build.yaml
                            </code>
                            . This enables the source-build override.
                        </>
                    ) : (
                        <>
                            Set <code>VAULT_IMAGE</code> to{" "}
                            <code>
                                ghcr.io/cryptexindustries/vault-web@sha256:YOUR_VERIFIED_DIGEST
                            </code>{" "}
                            and <code>SHARE_IMAGE</code> to{" "}
                            <code>
                                ghcr.io/cryptexindustries/vault-web/share-server@sha256:YOUR_VERIFIED_DIGEST
                            </code>
                            , and <code>RELAY_IMAGE</code> to{" "}
                            <code>
                                ghcr.io/cryptexindustries/vault-web/relay-server@sha256:YOUR_VERIFIED_DIGEST
                            </code>
                            . The share server and the relay have their own
                            releases, tagged <code>share-server-v*</code> and{" "}
                            <code>relay-server-v*</code>. Resolve all three
                            digests from the{" "}
                            <a href="https://github.com/CryptexIndustries/vault-web/pkgs/container/vault-web">
                                published images
                            </a>
                            . Use the command below. Leave{" "}
                            <code>COMPOSE_FILE</code> commented out.
                        </>
                    )}{" "}
                    Replace <code>SHARE_CREATION_TOKENS</code> with one{" "}
                    <code>openssl rand -hex 32</code> value per person who may
                    create <a href="#share-server">one-time share links</a>,
                    separated by commas.
                </p>
                {!fromSource && (
                    <div id="image-pinning">
                        <DocCode>{`# Replace the tag with the release you chose in step 2
docker buildx imagetools inspect ghcr.io/cryptexindustries/vault-web:YOUR_PUBLISHED_TAG
# Copy the top-level Digest into VAULT_IMAGE in .env
# VAULT_IMAGE=ghcr.io/cryptexindustries/vault-web@sha256:YOUR_VERIFIED_DIGEST
# Same for the share server release you chose
docker buildx imagetools inspect ghcr.io/cryptexindustries/vault-web/share-server:YOUR_SHARE_SERVER_TAG
# SHARE_IMAGE=ghcr.io/cryptexindustries/vault-web/share-server@sha256:YOUR_VERIFIED_DIGEST
# Same for the relay release you chose
docker buildx imagetools inspect ghcr.io/cryptexindustries/vault-web/relay-server:YOUR_RELAY_SERVER_TAG
# RELAY_IMAGE=ghcr.io/cryptexindustries/vault-web/relay-server@sha256:YOUR_VERIFIED_DIGEST`}</DocCode>
                        <p>
                            Use the top-level manifest digest. This pins the
                            image contents even if its tag changes. It does not
                            verify that the publisher or image is trustworthy.
                            The supplied Caddy, Soketi, and coturn images are
                            already pinned. See{" "}
                            <a href="https://docs.docker.com/dhi/explore/security-concepts/digests/">
                                Docker's image digest guide
                            </a>
                            .
                        </p>
                    </div>
                )}
                <p>
                    Leave <code>NEXT_PUBLIC_CLOUD_ENABLED=false</code> and{" "}
                    <code>SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES=true</code>{" "}
                    in the Compose file. These settings disable the account
                    backend and allow device-linking messages. Enter the Soketi
                    app secret in the client at <a href="#sync">step 6</a>; you
                    do not need to deploy a separate authentication API.
                </p>
                <h3>TURN settings</h3>
                <p>
                    Set <code>TURN_DOMAIN=turn.example.com</code> in{" "}
                    <code>.env</code>, using your own hostname. Use that same
                    name for the certificate, coturn's <code>realm</code>, and
                    the client URL.
                </p>
                <p>
                    In <code>.env</code>, set <code>TURN_UID</code> and{" "}
                    <code>TURN_GID</code> to the output of <code>id -u</code>{" "}
                    and <code>id -g</code> for the unprivileged user who owns
                    the configuration file. This lets coturn read the protected
                    file without running as root.
                </p>
                <p>
                    Edit <code>turnserver.conf</code>. Set <code>realm</code>{" "}
                    and <code>server-name</code> to{" "}
                    <code>turn.example.com</code>. Replace the password in{" "}
                    <code>
                        user=REPLACE_WITH_USERNAME:REPLACE_WITH_RANDOM_HEX
                    </code>
                    . Choose your own username and replace both placeholders.
                    Use those same credentials in the client.
                </p>
                <p>
                    Run <code>ip -4 addr</code>. Set <code>listening-ip</code>{" "}
                    and <code>relay-ip</code> to the VPS interface address. If
                    the provider assigns a private interface address behind a
                    public IP, also set{" "}
                    <code>external-ip=PUBLIC_IPV4/PRIVATE_INTERFACE_IPV4</code>.
                    That NAT must forward the listener and relay ports without
                    changing their port numbers.
                </p>
                <p>
                    Keep the template's authentication, blocked peer ranges,
                    allocation limits, and bandwidth limits enabled. Share TURN
                    credentials only with the devices using your deployment.
                </p>
                <DocCallout title="Share these credentials only with trusted devices">
                    <p>
                        The custom Soketi secret and TURN password are stored in
                        the encrypted linked-device configuration and shared
                        with receiving devices. They are not per-device
                        credentials. Removing a link does not revoke them.
                        Rotate them if a device is no longer trusted, then
                        update the remaining devices' server settings.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="start" title="5. Start the services">
                <div
                    className={d.platformSelector}
                    role="group"
                    aria-label="TURN transport"
                >
                    <button
                        type="button"
                        aria-pressed={turnTls}
                        aria-controls="turn-startup"
                        onClick={() => setTurnTls(true)}
                    >
                        TLS (recommended)
                    </button>
                    <button
                        type="button"
                        aria-pressed={!turnTls}
                        aria-controls="turn-startup"
                        onClick={() => setTurnTls(false)}
                    >
                        Regular TURN
                    </button>
                </div>
                <p>
                    TLS encrypts the connection to coturn and requires a trusted
                    certificate. Regular TURN skips certificate setup. Vault
                    synchronization remains end-to-end encrypted with either
                    option.
                </p>
                <div id="turn-startup">
                    {turnTls ? (
                        <>
                            <div id="deployment-start">
                                <p>
                                    From the directory{" "}
                                    <code>
                                        {fromSource
                                            ? "deploy/self-hosting"
                                            : "cryptex-self-hosted"}
                                    </code>
                                    , start the web application and signaling
                                    first. Leave coturn stopped until its
                                    certificate is installed.
                                </p>
                                <DocCode>{`# Install Certbot on the Ubuntu host
sudo apt update
sudo apt install -y certbot
# Prepare the HTTP challenge directory and protected certificate directory
sudo install -d -m 0755 /var/lib/cryptex-acme
# Use the same group ID you set as TURN_GID in .env
sudo install -d -o root -g "$(id -g)" -m 0750 /etc/cryptex-turn/tls
# Validate settings without printing credentials
docker compose config --quiet
${fromSource ? "docker compose pull caddy soketi coturn\ndocker compose build web share relay" : "docker compose pull"}
# Start HTTPS and signaling; coturn starts after certificate installation
docker compose up -d --no-build web soketi caddy`}</DocCode>
                            </div>
                            <h3>Obtain and install the TURN certificate</h3>
                            <p>
                                Confirm the <code>TURN_DOMAIN</code> DNS record
                                points to this server and TCP <code>80</code> is
                                reachable. Replace the hostname and email below.
                                Certbot uses Caddy's HTTP challenge route, so it
                                does not need to stop Caddy or take over its
                                ports.
                            </p>
                            <DocCode>{`# Request a trusted certificate for your TURN hostname
sudo certbot certonly --webroot -w /var/lib/cryptex-acme \\
  --cert-name cryptex-turn -d turn.example.com \\
  --email you@example.com --agree-tos --non-interactive
# Review the supplied hook, then install it as root-owned
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -o root -g root -m 0755 deploy-turn-certificate.sh \\
  /etc/letsencrypt/renewal-hooks/deploy/cryptex-turn
# Copy the first certificate and key into coturn's protected directory
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/cryptex-turn \\
  /etc/letsencrypt/renewal-hooks/deploy/cryptex-turn
# Start coturn and inspect the TLS listener logs
docker compose up -d --no-build coturn
docker compose ps
docker compose logs --tail=100 coturn`}</DocCode>
                            <p>
                                Keep the template's <code>cert</code>,{" "}
                                <code>pkey</code>, and
                                <code> tls-listening-port=5349</code> settings.
                                Do not add
                                <code> no-tls</code>. Compose mounts the
                                certificate directory read-only; the private key
                                is readable only by root and coturn's configured
                                group. Do not copy private keys into the
                                repository or make them world-readable.
                            </p>
                            <h3>Enable renewal and check TLS</h3>
                            <DocCode>{`# Enable Ubuntu's scheduled Certbot renewal
sudo systemctl enable --now certbot.timer
sudo systemctl status certbot.timer --no-pager
# Test renewal and the deploy hook using the active certificate
sudo certbot renew --cert-name cryptex-turn --dry-run --run-deploy-hooks
# Check certificate trust and hostname; replace both hostnames
openssl s_client -connect turn.example.com:5349 \\
  -servername turn.example.com -verify_hostname turn.example.com \\
  -verify_return_error </dev/null`}</DocCode>
                            <p>
                                Expect <code>Verify return code: 0 (ok)</code>{" "}
                                and no certificate errors. After each successful
                                renewal, the hook copies the new certificate and
                                sends <code>SIGUSR2</code> to coturn. It reloads
                                the certificate without restarting or closing
                                existing connections. Check{" "}
                                <code>journalctl -u certbot.service</code> if
                                renewal fails. Caddy separately renews the web
                                and signaling certificates. See{" "}
                                <a href="https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates">
                                    Certbot's renewal documentation
                                </a>
                                .
                            </p>
                            <p>
                                Check that all containers stay running and the
                                web service reports <code>healthy</code>. Open
                                your web application:
                            </p>
                            <DocCode>{`curl -I https://vault.example.com/app`}</DocCode>
                        </>
                    ) : (
                        <div id="deployment-start">
                            <h3>Start with regular TURN</h3>
                            <p>
                                No Certbot setup is needed. In{" "}
                                <code>turnserver.conf</code>, remove{" "}
                                <code>no-udp</code>,<code> no-tcp</code>,{" "}
                                <code>tls-listening-port</code>,
                                <code> cert</code>, <code>pkey</code>,{" "}
                                <code>no-tlsv1</code>, and{" "}
                                <code>no-tlsv1_1</code>. Add <code>no-tls</code>{" "}
                                and keep
                                <code> no-dtls</code>. Leave authentication and
                                peer restrictions enabled.
                            </p>
                            <p>
                                Open UDP/TCP <code>3478</code> and UDP{" "}
                                <code>49160-49260</code>. Leave{" "}
                                <code>5349</code> closed. From the directory{" "}
                                <code>
                                    {fromSource
                                        ? "deploy/self-hosting"
                                        : "cryptex-self-hosted"}
                                </code>
                                , run:
                            </p>
                            <DocCode>{`# Create the directories required by the Compose mounts
sudo install -d -m 0755 /var/lib/cryptex-acme
sudo install -d -o root -g "$(id -g)" -m 0750 /etc/cryptex-turn/tls
# Validate settings and prepare the images
docker compose config --quiet
${fromSource ? "docker compose pull caddy soketi coturn\ndocker compose build web share relay" : "docker compose pull"}
# Start all services
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 coturn
# Replace the hostname with yours
curl -I https://vault.example.com/app`}</DocCode>
                            <p>
                                All containers should stay running and the web
                                service should report <code>healthy</code>. If
                                you changed an existing coturn configuration,
                                run <code>docker compose restart coturn</code>{" "}
                                to apply it.
                            </p>
                            <p>
                                Use the regular <code>turn:</code> URLs in step
                                6. They do not use TLS between the client and
                                relay; the vault synchronization payload remains
                                end-to-end encrypted. Do not add them as
                                automatic fallback entries if you intend to
                                require TLS.
                            </p>
                        </div>
                    )}
                </div>
                <p>
                    Do not point <code>turns:</code> at Caddy's HTTPS port. TURN
                    is not HTTP. Using TLS TURN on <code>443</code> requires a
                    separate public IP or a purpose-built TCP routing setup.
                    This guide keeps coturn on <code>5349</code>.
                </p>
            </DocSection>
            <DocSection id="sync" title="6. Add the servers in Cryptex Vault">
                <p>
                    In the sending vault, select the gear beside{" "}
                    <strong>Linked Devices</strong> to open{" "}
                    <strong>Vault signaling</strong>. It has a tab for each
                    server type. On each tab, choose the add button, such as{" "}
                    <strong>Add TURN server</strong>, fill in the fields below
                    and choose <strong>Save server</strong>. Each server is
                    saved in the vault on its own.
                </p>
                <DocScreenshot
                    src="/images/docs/self-hosting-open-servers.png"
                    alt="Top of the web application sidebar, with the Configure linking gear beside Linked Devices highlighted"
                    caption="Web application: select the gear beside Linked Devices."
                    width={1036}
                    height={1056}
                />
                <p>
                    Names are labels of your choice, and each name can be used
                    once per tab. The signaling Host is only the host name,
                    without <code>https://</code>, <code>wss://</code>, a port
                    or a path. Put an IPv6 address in brackets, like{" "}
                    <code>[2001:db8::1]</code>. STUN accepts a host and port or
                    a <code>stun:</code> or <code>stuns:</code> URL. TURN
                    accepts a host and port or a full <code>turn:</code> or{" "}
                    <code>turns:</code> URL.
                </p>

                <div
                    className={d.platformSelector}
                    role="group"
                    aria-label="Server configuration"
                >
                    {(["signaling", "stun", "turn"] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            aria-pressed={serverTab === tab}
                            aria-controls="server-instructions"
                            onClick={() => setServerTab(tab)}
                        >
                            {tab === "signaling"
                                ? "Signaling"
                                : tab.toUpperCase()}
                        </button>
                    ))}
                </div>
                <div id="server-instructions">
                    <h3>
                        {serverTab === "signaling"
                            ? "Add your signaling server"
                            : serverTab === "stun"
                              ? "Optional: add STUN for regular TURN"
                              : "Add your TURN servers"}
                    </h3>
                    {serverTab === "stun" && (
                        <p>
                            Skip this entry for the recommended TLS-only setup.
                            It applies only when you enable regular STUN/TURN on{" "}
                            <code>3478</code>.
                        </p>
                    )}
                    <DocScreenshot
                        src={`/images/docs/self-hosting-${serverTab}.png`}
                        alt={`Add ${serverTab === "signaling" ? "signaling" : serverTab.toUpperCase()} server form in the web application, filled in with the values from the table`}
                        caption={`Web application: the ${serverTab === "signaling" ? "signaling" : serverTab.toUpperCase()} server form.`}
                        width={1024}
                        height={
                            serverTab === "signaling"
                                ? 1468
                                : serverTab === "stun"
                                  ? 628
                                  : 964
                        }
                    />
                    <div className={t.tableWrap}>
                        <table className={t.table}>
                            <thead>
                                <tr>
                                    <th>Field</th>
                                    <th>Enter</th>
                                </tr>
                            </thead>
                            <tbody>
                                {serverTab === "signaling" ? (
                                    <>
                                        <tr>
                                            <td>Name</td>
                                            <td>
                                                A label such as{" "}
                                                <code>My signaling server</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Host</td>
                                            <td>
                                                <code>signal.example.com</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>App ID</td>
                                            <td>
                                                Your <code>SOKETI_APP_ID</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Key</td>
                                            <td>
                                                Your <code>SOKETI_APP_KEY</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Secret</td>
                                            <td>
                                                Your{" "}
                                                <code>SOKETI_APP_SECRET</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>WS port</td>
                                            <td>
                                                <code>80</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>WSS port</td>
                                            <td>
                                                <code>443</code>, which enables
                                                TLS. Enter <code>0</code> or
                                                leave it empty to turn WSS off
                                            </td>
                                        </tr>
                                    </>
                                ) : serverTab === "stun" ? (
                                    <>
                                        <tr>
                                            <td>Name</td>
                                            <td>
                                                A label such as{" "}
                                                <code>My STUN server</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Host</td>
                                            <td>
                                                <code>
                                                    turn.example.com:3478
                                                </code>
                                            </td>
                                        </tr>
                                    </>
                                ) : (
                                    <>
                                        <tr>
                                            <td>Name</td>
                                            <td>
                                                Use a label such as{" "}
                                                <code>
                                                    My TURN server (TLS)
                                                </code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>
                                                Recommended / Host or TURN URL
                                            </td>
                                            <td>
                                                <code>
                                                    turns:turn.example.com:5349?transport=tcp
                                                </code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>
                                                Regular alternative / Host or
                                                TURN URL
                                            </td>
                                            <td>
                                                <code>
                                                    turn:turn.example.com:3478?transport=udp
                                                    <br />
                                                    turn:turn.example.com:3478?transport=tcp
                                                </code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Username</td>
                                            <td>
                                                The username you chose in{" "}
                                                <code>turnserver.conf</code>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Password</td>
                                            <td>
                                                The password from{" "}
                                                <code>
                                                    user=USERNAME:PASSWORD
                                                </code>
                                            </td>
                                        </tr>
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
                <p>
                    Before you save, choose <strong>Test connection</strong> to
                    check the server from this browser. For signaling, the test
                    connects and signs in to a presence channel with your key
                    and secret. For TURN, it asks the relay for an address with
                    your username and password. For STUN, it waits for the
                    server to report your public address.
                </p>
                <DocScreenshot
                    src="/images/docs/self-hosting-server-list.png"
                    alt="Vault signaling dialog on the TURN tab listing three saved TURN servers, each with a delete button"
                    caption="Web application: saved servers are listed on their tab. Select a server to edit it, or its trash icon to delete it."
                    width={1024}
                    height={960}
                />
                <p>
                    Before you delete a server that a linked device uses, the
                    dialog names that device. It may stop syncing until you
                    choose another server for it.
                </p>
                <p>
                    Close the dialog, start linking a device and expand{" "}
                    <strong>Advanced connection</strong>. Select the custom
                    signaling server and the TLS TURN entry for the link. Leave
                    STUN unselected for the TLS-only setup. For regular TURN,
                    select the two alternative TURN entries and optionally the
                    STUN entry. With Online Services disabled, a custom TURN
                    selection is required. Complete the{" "}
                    <Link href="/docs/linking-devices">linking flow</Link>. The
                    encrypted invitation carries the server configuration to the
                    receiver.
                </p>
            </DocSection>
            <DocSection id="verify" title="7. Test the complete connection">
                <ol>
                    <li>
                        Use two devices on different networks, such as home
                        Wi-Fi and mobile data. Keep both vaults unlocked and
                        online.
                    </li>
                    <li>
                        Create a test entry on one device and synchronize.
                        Confirm it appears on the other, then edit it there and
                        synchronize back.
                    </li>

                    <li>
                        In the web app, open <strong>Vault signaling</strong>,
                        select a TURN entry and choose{" "}
                        <strong>Test connection</strong>. Look for{" "}
                        <strong>TURN relay allocation succeeded.</strong> Test
                        the TLS entry for the recommended setup. For regular
                        TURN, test the UDP and TCP entries one at a time. Repeat
                        on your other network.
                    </li>
                </ol>
                <p>
                    A successful TURN test means the relay gave this device a
                    relay address. It does not prove data can pass between two
                    devices through that relay. Complete the synchronization
                    test above as well; a direct connection alone does not
                    verify the relay data path.
                </p>
            </DocSection>
            <DocSection id="share-server" title="8. Use one-time share links">
                <p>
                    The stack includes the open-source share server behind{" "}
                    <Link href="/docs/sharing">one-time share links</Link>.
                    Links look like{" "}
                    <code>https://vault.example.com/s/&lt;id&gt;</code>, and the
                    web container forwards <code>/share-api/</code> requests to
                    the share server, so no extra domain or firewall rule is
                    needed. The server stores encrypted contents and token
                    hashes in a SQLite file in the <code>share_data</code>{" "}
                    volume. It never receives the decryption key.
                </p>
                <ol>
                    <li>
                        Give each person one of the tokens you put in{" "}
                        <code>SHARE_CREATION_TOKENS</code> in step 4. Anyone can
                        open a link; only token holders can create one.
                    </li>
                    <li>
                        Each person opens <strong>Shared Links</strong> in their
                        vault, chooses the server icon, and enters their token.
                        In the extension and on Android they also enter{" "}
                        <code>https://vault.example.com</code> as the share
                        server.
                    </li>
                </ol>
                <p>
                    To add or withdraw access, edit{" "}
                    <code>SHARE_CREATION_TOKENS</code> in <code>.env</code> and
                    run <code>docker compose up -d --force-recreate share</code>
                    . <code>docker compose restart</code> keeps the old tokens.
                    Links someone already created keep working until they are
                    opened or expire.
                </p>
                <DocCallout title="Keep the client address header honest">
                    The share server rate-limits per client using{" "}
                    <code>X-Forwarded-For</code>. Caddy replaces that header
                    with the address it saw, and the web container passes it
                    through, so the server uses the last entry. If a CDN or
                    another proxy sits in front of Caddy, add its address ranges
                    to Caddy&apos;s <code>trusted_proxies</code> option so Caddy
                    keeps the client address, and set{" "}
                    <code>SHARE_TRUSTED_PROXY_HOPS</code> in <code>.env</code>{" "}
                    to the number of proxies, Caddy included. Behind Cloudflare
                    you can set{" "}
                    <code>SHARE_CLIENT_IP_HEADER=CF-Connecting-IP</code>{" "}
                    instead, but only if the server accepts connections from
                    Cloudflare alone. Anyone who reaches Caddy directly can set
                    that header.
                </DocCallout>
                <DocCode>{`# Caddyfile global options, with your CDN's address ranges
{
	email {$ACME_EMAIL}
	servers {
		trusted_proxies static 203.0.113.0/24 2001:db8::/32
	}
}`}</DocCode>
                <p>
                    Caddy negotiates the hybrid post-quantum key exchange
                    X25519MLKEM768 with current browsers by default. Someone who
                    records traffic to <code>/share-api/</code> today can&apos;t
                    decrypt it later by breaking only the classical key exchange
                    with a quantum computer. Keep Caddy up to date and leave
                    that key exchange on.
                </p>
                <p>
                    The share server also serves Prometheus metrics at{" "}
                    <code>/metrics</code> on port <code>9090</code>. The port
                    isn&apos;t published, so only containers on the Compose
                    network reach it; add your Prometheus or Alloy container to
                    that network to scrape it. Metrics hold counts only, never
                    share IDs or client addresses. Set{" "}
                    <code>SHARE_METRICS_ADDR=off</code> to turn them off.
                </p>
            </DocSection>
            <DocSection id="agent-relay" title="9. Run the SSH agent relay">
                <p>
                    The stack includes the relay for the{" "}
                    <Link href="/docs/ssh-agent">SSH agent</Link>. It carries
                    encrypted signing requests between{" "}
                    <code>cryptex-agent</code> on a Linux machine and the device
                    that approves them. Caddy sends <code>/v1/connect</code>,{" "}
                    <code>/v1/pair</code> and <code>/v1/revoke</code> on your
                    vault domain to the relay, so its URL is{" "}
                    <code>https://vault.example.com</code> and it needs no extra
                    domain or firewall rule. The relay can&apos;t read requests
                    or sign anything. It keeps the public keys of paired agents
                    and devices in a SQLite file in the <code>relay_data</code>{" "}
                    volume.
                </p>
                <ol>
                    <li>
                        On the Linux machine, pair with your relay instead of
                        the hosted one:{" "}
                        <code>
                            cryptex-agent pair --relay https://vault.example.com
                        </code>
                        . Use exactly <code>https://</code> and your{" "}
                        <code>VAULT_DOMAIN</code>: sign-ins are checked against
                        that address. The agent and the apps accept a relay only
                        over <code>https://</code>, which Caddy already
                        provides. Plain <code>http://</code> works only for a
                        relay on the same machine.
                    </li>
                    <li>
                        When the Android app or the web app reads the code, it
                        asks for the relay&apos;s access token. Enter your{" "}
                        <code>RELAY_ACCESS_TOKEN</code>. Each device saves it in
                        the vault for that device only, under{" "}
                        <strong>Agent relays</strong>.
                    </li>
                </ol>
                <p>
                    Anyone with the token can pair agents with this relay, up to{" "}
                    <code>RELAY_MAX_AGENTS</code> agents on the whole relay, 25
                    by default. Give it only to people you trust. To change it,
                    edit <code>RELAY_ACCESS_TOKEN</code> in <code>.env</code>,
                    run <code>docker compose up -d --force-recreate relay</code>
                    , update the token under <strong>Agent relays</strong> on
                    each approving device, and pair every agent again with{" "}
                    <code>cryptex-agent pair --force</code>. Agents keep the
                    token they were paired with.
                </p>
                <p>
                    Back up <code>relay_data</code> with Caddy&apos;s volume. If
                    it is lost, every agent has to pair again. To revoke an
                    agent on this relay, use the device that approves it or run{" "}
                    <code>cryptex-agent unpair</code> on the machine.
                </p>
                <DocCallout title="Behind Cloudflare or another proxy">
                    This guide&apos;s DNS records skip CDN proxies. If you put
                    the vault domain behind Cloudflare&apos;s proxy anyway, it
                    closes WebSockets that stay idle for 100 seconds. Set{" "}
                    <code>RELAY_KEEPALIVE_SECONDS=90</code> in <code>.env</code>{" "}
                    so clients ping before that. The relay rate-limits per
                    client address like the share server, so set{" "}
                    <code>RELAY_TRUSTED_PROXY_HOPS</code> to the number of
                    proxies, Caddy included, as described for{" "}
                    <code>SHARE_TRUSTED_PROXY_HOPS</code> above.
                </DocCallout>
                <p>
                    The relay serves Prometheus metrics on port{" "}
                    <code>9090</code>, which isn&apos;t published. Set{" "}
                    <code>RELAY_METRICS_ADDR=off</code> to turn them off.{" "}
                    {fromSource ? (
                        <>
                            To update it, check out a newer release, run{" "}
                            <code>docker compose build relay</code>
                        </>
                    ) : (
                        <>
                            To update it, pin the digest of a newer{" "}
                            <code>relay-server-v*</code> release in{" "}
                            <code>RELAY_IMAGE</code>, run{" "}
                            <code>docker compose pull relay</code>
                        </>
                    )}{" "}
                    and <code>docker compose up -d --no-build relay</code>. The{" "}
                    <a
                        href={`${REPO}/blob/master/services/cmd/relay-server/threat-model.md`}
                    >
                        relay threat model
                    </a>{" "}
                    describes what it stores and checks.
                </p>
            </DocSection>
            <DocSection id="operations" title="10. Maintain the deployment">
                <h3>Update and roll back</h3>
                <div id="deployment-update">
                    {fromSource ? (
                        <>
                            <p>
                                Export a vault backup first. Record the current
                                Git revision and <code>VAULT_IMAGE</code> tag.
                                From the repository root, fetch releases with{" "}
                                <code>git fetch --tags origin</code> and check
                                out the intended tag or commit. Review
                                deployment-file changes, then return to{" "}
                                <code>deploy/self-hosting</code>. Give{" "}
                                <code>VAULT_IMAGE</code> a new tag in{" "}
                                <code>.env</code>.
                            </p>
                            <DocCode>{`# Validate settings, then build the new local image
docker compose config --quiet
docker compose build web
# Replace only the web container and check its status
docker compose up -d --no-build web
docker compose ps`}</DocCode>
                        </>
                    ) : (
                        <>
                            <p>
                                Export a vault backup first. Record the current{" "}
                                <code>VAULT_IMAGE</code> value, then replace its
                                digest in <code>.env</code> with the verified
                                digest of the new published version using the{" "}
                                <a href="#image-pinning">command in step 4</a>.
                                Review that release's configuration changes
                                before updating. Keep your existing credentials.
                            </p>
                            <DocCode>{`# Validate settings, then pull the new pinned image
docker compose config --quiet
docker compose pull web
# Replace only the web container and check its status
docker compose up -d --no-build web
docker compose ps`}</DocCode>
                        </>
                    )}
                    <p>
                        To roll back the client, restore its previous image
                        reference in <code>.env</code> and run{" "}
                        <code>docker compose up -d --no-build web</code>. Keep
                        that old image until verification is complete. Image
                        rollback does not undo changes to browser vault data.
                    </p>
                </div>
                <p>
                    Review upstream security updates for{" "}
                    <a href="https://soketi.app/">Soketi</a>,{" "}
                    <a href="https://github.com/coturn/coturn">coturn</a>, and{" "}
                    <a href="https://caddyserver.com/">Caddy</a>. Update one
                    image reference and its digest at a time in{" "}
                    <code>compose.yaml</code>, pull that service, and recreate
                    it. Repeat the linking and relay tests. Store a protected
                    copy of your configuration and back up Caddy's certificate
                    volume.
                </p>
                <h3>When something fails</h3>
                <dl>
                    <div className={t.definition}>
                        <dt>No HTTPS</dt>
                        <dd>
                            Check DNS <code>A</code> records, remove stale{" "}
                            <code>AAAA</code> records, check ports{" "}
                            <code>80</code> and <code>443</code>, and inspect
                            Caddy logs for certificate errors.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Signaling fails</dt>
                        <dd>
                            Check the Host and WSS port, the key and secret, and
                            Soketi logs. Confirm client messages are enabled.
                            The public proxy must pass <code>/app/*</code>{" "}
                            WebSocket requests.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>No relay candidate</dt>
                        <dd>
                            Check the TURN username/password, inbound TCP{" "}
                            <code>5349</code> for TLS or UDP/TCP{" "}
                            <code>3478</code> for regular TURN and UDP{" "}
                            <code>49160-49260</code>, outbound UDP, and the
                            public/private IP mapping. A running container or a
                            STUN response does not prove relay traffic works.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Works only on some networks</dt>
                        <dd>
                            Check TCP <code>5349</code> for TLS TURN, or test
                            UDP and TCP <code>3478</code> for regular TURN.
                            Networks restricted to <code>443</code> may block
                            this setup.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>No vault after moving hosts</dt>
                        <dd>
                            The new origin has separate browser storage. Restore
                            an encrypted backup or link from a device that still
                            has the vault.
                        </dd>
                    </div>
                </dl>
                <p>
                    Configuration references:{" "}
                    <a href="https://caddyserver.com/docs/automatic-https">
                        Caddy HTTPS
                    </a>
                    , <a href="https://github.com/soketi/soketi">Soketi</a>, and{" "}
                    <a href="https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf">
                        coturn options
                    </a>
                    . For application errors, use the{" "}
                    <Link href="/docs/troubleshooting">
                        troubleshooting guide
                    </Link>
                    .
                </p>
            </DocSection>
        </DocArticle>
    );
}
