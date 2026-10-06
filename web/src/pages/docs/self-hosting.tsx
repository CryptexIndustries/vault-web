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
            description="Set up the web application, signaling, and STUN/TURN services on your own server."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#scope", label: "Before you start" },
                { href: "#client", label: "Get the files" },
                { href: "#production", label: "DNS and firewall" },
                { href: "#configure", label: "Configure the services" },
                { href: "#start", label: "Start the stack" },
                { href: "#sync", label: "Configure Cryptex Vault" },
                { href: "#verify", label: "Test synchronization and TURN" },
                { href: "#operations", label: "Updates and troubleshooting" },
            ]}
            related={[
                { href: "/docs/linking-devices", title: "Linking devices" },
                { href: "/docs/backups", title: "Backups" },
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
                    signaling, and coturn for STUN/TURN. You do not need an
                    Online Services subscription. Use manual vault backups with
                    this setup; it does not include managed backups.
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
                        Prepare your local settings and generate three separate
                        credentials:
                    </p>
                    <DocCode>{prepare}</DocCode>
                </div>
                <p>
                    Use the three generated values for the Soketi key, Soketi
                    secret, and TURN password respectively. Do not reuse the
                    example placeholders. The real <code>.env</code> and{" "}
                    <code>turnserver.conf</code> files contain credentials and
                    must remain outside the web application's public directory.
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
                            and uncomment{" "}
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
                            </code>
                            . Resolve the digest for your chosen release from
                            the{" "}
                            <a href="https://github.com/CryptexIndustries/vault-web/pkgs/container/vault-web">
                                published images
                            </a>
                            . Use the command below. Leave{" "}
                            <code>COMPOSE_FILE</code> commented out.
                        </>
                    )}
                </p>
                {!fromSource && (
                    <div id="image-pinning">
                        <DocCode>{`# Replace the tag with the release you chose in step 2
docker buildx imagetools inspect ghcr.io/cryptexindustries/vault-web:YOUR_PUBLISHED_TAG
# Copy the top-level Digest into VAULT_IMAGE in .env
# VAULT_IMAGE=ghcr.io/cryptexindustries/vault-web@sha256:YOUR_VERIFIED_DIGEST`}</DocCode>
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
${fromSource ? "docker compose pull caddy soketi coturn\ndocker compose build web" : "docker compose pull"}
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
                                Check that all four containers stay running and
                                the web service reports <code>healthy</code>.
                                Open your web application:
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
${fromSource ? "docker compose pull caddy soketi coturn\ndocker compose build web" : "docker compose pull"}
# Start all four services
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 coturn
# Replace the hostname with yours
curl -I https://vault.example.com/app`}</DocCode>
                            <p>
                                All four containers should stay running and the
                                web service should report <code>healthy</code>.
                                If you changed an existing coturn configuration,
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
                    In the sending vault, start linking a device and expand
                    <strong> Advanced connection</strong>. Open the server
                    editor and add the following entries. Names are labels of
                    your choice. Signaling and STUN Host fields do not include{" "}
                    <code>https://</code>, <code>wss://</code>, or{" "}
                    <code>stun:</code>. TURN accepts a host and port or a full{" "}
                    <code>turn:</code> or <code>turns:</code> URL.
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
                        alt={`Web application server editor showing the ${serverTab} settings`}
                        caption={`Web application: ${serverTab === "signaling" ? "Signaling" : serverTab.toUpperCase()} configuration.`}
                        width={672}
                        height={
                            serverTab === "signaling"
                                ? 648
                                : serverTab === "stun"
                                  ? 414
                                  : 492
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
                                                TLS
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
                    Save, then select the custom signaling server and the TLS
                    TURN entry for the link. Leave STUN unselected for the
                    TLS-only setup. For regular TURN, select the two alternative
                    TURN entries and optionally the STUN entry. With Online
                    Services disabled, a custom TURN selection is required.
                    Complete the{" "}
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
                        Open the open-source{" "}
                        <a
                            href="https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
                            target="_blank"
                            rel="noreferrer"
                        >
                            WebRTC Trickle ICE sample
                        </a>
                        . Remove the default server. Enter one TURN URL and your
                        credentials, select <strong>Add Server</strong>, choose{" "}
                        <strong>relay</strong>
                        for IceTransports, then select{" "}
                        <strong>Gather candidates</strong>. Look for a candidate
                        with type <code>relay</code>. Test{" "}
                        <code>turns:turn.example.com:5349?transport=tcp</code>{" "}
                        for the recommended setup and repeat from your other
                        network. For regular TURN, test UDP and TCP separately.
                    </li>
                </ol>
                <p>
                    A <code>relay</code> candidate confirms that TURN allocated
                    a relay address. It does not prove data can pass between two
                    devices through that relay. Complete the synchronization
                    test above as well; a direct connection alone does not
                    verify the relay data path.
                </p>
                <p>
                    Only enter credentials into a tester you trust. The sample
                    is
                    <a href="https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/trickle-ice">
                        {" "}
                        open source
                    </a>{" "}
                    and can be run locally. Remove your server entry after
                    testing, especially on a shared browser.
                </p>
            </DocSection>
            <DocSection id="operations" title="8. Maintain the deployment">
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
