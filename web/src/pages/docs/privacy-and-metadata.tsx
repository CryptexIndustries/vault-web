import Link from "next/link";
import {
    DocArticle,
    DocCallout,
    DocSection,
} from "@/components/marketing/doc-article";
import t from "@/styles/TechnicalDocs.module.css";

export default function PrivacyAndMetadata() {
    return (
        <DocArticle
            title="Privacy and metadata"
            description="Where your vault data is stored, which services receive metadata, and what happens when you delete it."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#local", label: "Local storage" },
                { href: "#network", label: "External requests" },
                { href: "#backups", label: "Managed backups" },
                { href: "#providers", label: "Providers and logs" },
                { href: "#control", label: "Deletion and your controls" },
            ]}
            related={[
                { href: "/privacy", title: "Privacy policy" },
                { href: "/docs/backups", title: "Backups" },
                { href: "/docs/online-services", title: "Online Services" },
                { href: "/docs/threat-model", title: "Threat model" },
            ]}
        >
            <DocSection id="local" title="Data kept on your device">
                <p>
                    The web application and Chromium Extension each keep a
                    separate encrypted vault in IndexedDB. Unlocking makes vault
                    contents and the data-encryption key available locally. See{" "}
                    <Link href="/docs/architecture">Architecture</Link> for
                    where each client runs these operations.
                </p>
                <div
                    className={t.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Local data and storage lifetime"
                >
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">Data</th>
                                <th scope="col">Location and lifetime</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Encrypted vault</td>
                                <td>
                                    IndexedDB in the web application's origin or
                                    extension storage. Persists across restarts
                                    until the vault or its storage is removed.
                                </td>
                            </tr>
                            <tr>
                                <td>Unlocked web session</td>
                                <td>
                                    Vault contents and active key in page
                                    memory, cleared from application state on
                                    lock, reload, or tab close.
                                </td>
                            </tr>
                            <tr>
                                <td>Unlocked extension session</td>
                                <td>
                                    Vault contents, active key, temporary
                                    credential drafts, and service session in{" "}
                                    <code>chrome.storage.session</code>. Cleared
                                    on vault lock or when Chrome clears the
                                    extension session.
                                </td>
                            </tr>
                            <tr>
                                <td>Protection phrase</td>
                                <td>
                                    Derived protection-phrase material can
                                    persist in local IndexedDB across locks and
                                    restarts. It still requires the master
                                    password to unlock the vault.
                                </td>
                            </tr>
                            <tr>
                                <td>Security-key protection</td>
                                <td>
                                    WebAuthn PRF credential metadata stays on
                                    the device. The authenticator supplies the
                                    additional key material when you unlock.
                                </td>
                            </tr>
                            <tr>
                                <td>Backup receipt and preferences</td>
                                <td>
                                    A local receipt records backup time and an
                                    encrypted-state fingerprint, not the backup
                                    itself. Receipts, vault selection, and
                                    interface settings can persist across
                                    restarts.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    See{" "}
                    <Link href="/docs/cryptography#unlock">unlock factors</Link>{" "}
                    for how the protection phrase and security key are used.
                </p>
                <p>
                    Closing the extension popup does not clear its unlocked
                    session. Chrome clears{" "}
                    <a href="https://developer.chrome.com/docs/extensions/reference/api/storage#property-session">
                        extension session storage
                    </a>{" "}
                    when the extension is disabled, reloaded, or updated, and
                    when the browser restarts.
                </p>
                <DocCallout title="Clearing site data deletes the local web vault">
                    <p>
                        Clearing storage for the web application's site removes
                        its local vault and locally retained protection
                        material.{" "}
                        <Link href="/docs/backups">
                            Save an encrypted <code>.cryx</code> backup
                        </Link>{" "}
                        first. Moving to another hostname, port, or from HTTP to
                        HTTPS creates a different storage origin; it does not
                        move the existing vault.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="network" title="What leaves the device">
                <p>
                    Local vault use does not require an Online Services account.
                    Loading the hosted web application still contacts its web
                    host. Self-hosting changes which host receives those
                    requests; custom synchronization uses the servers you
                    configure.
                </p>
                <div
                    className={t.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Features, recipients, and transmitted data"
                >
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">When</th>
                                <th scope="col">Recipient and data</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Loading the hosted app</td>
                                <td>
                                    The web host and any HTTPS-terminating proxy
                                    receive the requested URL, request headers,
                                    IP address, and timing needed to serve the
                                    application.
                                </td>
                            </tr>
                            <tr>
                                <td>Linking or connecting devices</td>
                                <td>
                                    The signaling server receives channel
                                    identifiers, presence, and
                                    connection-negotiation messages. WebRTC
                                    setup information can include IP addresses
                                    and ports.
                                </td>
                            </tr>
                            <tr>
                                <td>Establishing a device connection</td>
                                <td>
                                    STUN receives network-address information.
                                    If TURN relays the connection, it sees
                                    addresses, timing, and encrypted traffic
                                    volume.
                                </td>
                            </tr>
                            <tr>
                                <td>Synchronizing</td>
                                <td>
                                    The linked device receives encrypted records
                                    and decrypts them locally. A TURN relay
                                    carries the encrypted exchange when a direct
                                    route is unavailable.
                                </td>
                            </tr>
                            <tr>
                                <td>Using Online Services</td>
                                <td>
                                    The API receives device-authentication
                                    messages, identifiers, and the configuration
                                    or operation being requested. Vault
                                    passwords and plaintext vault contents are
                                    not used to authenticate these requests.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    Uploading or downloading a managed backup
                                </td>
                                <td>
                                    The API handles backup metadata and issues a
                                    temporary signed URL. Object storage
                                    transfers the encrypted snapshot directly
                                    with the client.
                                </td>
                            </tr>
                            <tr>
                                <td>Opening a flow with CAPTCHA</td>
                                <td>
                                    Cloudflare Turnstile receives browser and
                                    challenge information for its bot check. The
                                    client sends the resulting token with the
                                    protected request, such as registration or
                                    recovery.
                                </td>
                            </tr>
                            <tr>
                                <td>Opening checkout</td>
                                <td>
                                    Stripe and Link handle checkout requests and
                                    the payment details entered there. The
                                    service receives the resulting subscription
                                    and payment status. See{" "}
                                    <a href="https://docs.stripe.com/payments/managed-payments/how-it-works">
                                        Managed Payments
                                    </a>
                                    .
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    HTTPS encrypts request contents between the browser and the
                    server terminating TLS. A passive network observer can see
                    connection addresses, timing, and traffic volume, but not
                    the HTTP path, headers, or body inside that encrypted
                    connection.
                </p>
                <p>
                    The credential list uses built-in icons rather than
                    requesting favicons for saved websites. Clicking a saved
                    website link opens that destination and makes an ordinary
                    browser request to it.
                </p>
                <p>
                    This table describes what each service receives, not what it
                    keeps in logs. See{" "}
                    <a href="#providers">server-log retention</a> below.
                </p>
            </DocSection>

            <DocSection id="backups" title="Managed backup metadata">
                <p>
                    Managed backups are encrypted locally before upload. The
                    storage provider receives encrypted bytes. The API tracks
                    snapshot and object identifiers, byte size, SHA-256
                    checksum, source device, timestamps, and upload or deletion
                    state.
                </p>
                <p>
                    Device and root-device associations determine which
                    snapshots are eligible for recovery. See{" "}
                    <Link href="/docs/online-services#devices">
                        root-device permissions
                    </Link>
                    . The upload does not send the vault password, vault
                    recovery code, additional protection secret, or plaintext
                    vault contents.
                </p>
                <p>
                    Backup pruning and the subscription grace period follow the{" "}
                    <Link href="/docs/online-services#limits">
                        published retention rules
                    </Link>
                    .
                </p>
            </DocSection>

            <DocSection id="providers" title="Providers, analytics, and logs">
                <p>
                    Our production infrastructure, STUN/TURN servers, and
                    managed encrypted backup storage are hosted in Europe. If
                    you self-host, your chosen providers and logging settings
                    apply to those services.
                </p>
                <p>
                    We use Cloudflare to proxy hosted traffic and run Turnstile
                    bot checks. Its HTTP Traffic analytics reports on requests
                    and bandwidth handled by Cloudflare's servers. Cloudflare
                    Web Analytics and RUM are not enabled, so their browser
                    analytics script is not loaded. Turnstile uses separate
                    browser code for bot checks.
                </p>
                <dl>
                    <div className={t.definition}>
                        <dt>Web diagnostic logs</dt>
                        <dd>
                            Held in memory, with up to 500 entries per category.
                            Cleared when the vault locks or the page session
                            ends.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Extension diagnostic logs</dt>
                        <dd>
                            Stored locally in <code>chrome.storage.local</code>,
                            capped at 2,000 entries. They survive closing the
                            popup and are separate from the unlocked session.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Our operational/security logs</dt>
                        <dd>
                            Retained for 30 days. These hosted-service logs can
                            include request identifiers, IP addresses,
                            timestamps, outcomes, and diagnostic information.
                        </dd>
                    </div>
                </dl>
                <p>
                    Diagnostic logs are not uploaded automatically. You can
                    export them to a file and choose whether to share it. Check
                    it for device identifiers, connection details, and errors
                    before sharing. The 30-day retention period applies to our
                    operational/security logs, not third-party provider logs or
                    logs on self-hosted servers.
                </p>
            </DocSection>

            <DocSection id="control" title="Deletion and your controls">
                <dl>
                    <div className={t.definition}>
                        <dt>Lock the vault</dt>
                        <dd>
                            Clears the active unlocked vault and key from
                            application state. Keeps the encrypted vault,
                            locally retained protection material, and existing
                            backups.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Delete a local vault</dt>
                        <dd>
                            Removes that installation's local vault. It does not
                            erase copies on linked devices, downloaded files, or
                            managed backups. Clearing the web app's site data
                            removes its local storage as well.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Pause managed backups</dt>
                        <dd>
                            Stops new uploads. Existing snapshots remain subject
                            to the retention rules.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Delete managed backups</dt>
                        <dd>
                            Requests deletion of selected stored snapshots
                            within your device's permissions. It does not delete
                            the live local vault or copies already downloaded.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Delete your Online Services account</dt>
                        <dd>
                            Revokes service sessions and queues managed backup
                            objects for deletion without the subscription grace
                            period. It does not remotely erase local vaults. See{" "}
                            <Link href="/docs/online-services#ending">
                                service deletion
                            </Link>
                            .
                        </dd>
                    </div>
                </dl>
                <p>
                    Downloaded backups, exported logs, and JSON exports remain
                    wherever you saved or shared them. JSON exports are not
                    encrypted. For backup instructions, see{" "}
                    <Link href="/docs/backups">Backups</Link>; for privacy
                    requests, see the{" "}
                    <Link href="/privacy">privacy policy</Link>.
                </p>
            </DocSection>
        </DocArticle>
    );
}
