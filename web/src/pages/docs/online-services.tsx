import Link from "next/link";
import { DocArticle, DocSection } from "@/components/marketing/doc-article";
import t from "@/styles/TechnicalDocs.module.css";

const sourceRoot =
    "https://github.com/CryptexIndustries/vault-web/blob/42085796a717d1852b5ae6ae4685985695eca0dd";

export default function OnlineServices() {
    return (
        <DocArticle
            title="Online Services"
            description="Device authentication, connection authorization, encrypted backup transfers, and recovery sessions."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#included", label: "Service architecture" },
                { href: "#account", label: "Account authentication" },
                { href: "#sync", label: "Managed synchronization services" },
                { href: "#devices", label: "Device authorization" },
                { href: "#backups", label: "Backup lifecycle" },
                { href: "#recovery", label: "Recovery authorization" },
                { href: "#limits", label: "Limits and retention" },
                { href: "#ending", label: "Ending service" },
                { href: "#references", label: "Client implementation" },
            ]}
            related={[
                { href: "/pricing", title: "Pricing" },
                { href: "/docs/synchronization", title: "Synchronization" },
            ]}
        >
            <DocSection id="included" title="Service architecture">
                <p>
                    Online Services authorizes account operations, connects
                    devices, and stores encrypted backups. Clients encrypt and
                    decrypt vault contents locally. Local vaults and manual
                    backups do not require an Online Services account.
                </p>
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th>Connection</th>
                                <th>Purpose and data</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Client ↔ account API</td>
                                <td>
                                    Authentication, device permissions, backup
                                    metadata, and temporary storage access.
                                </td>
                            </tr>
                            <tr>
                                <td>Client ↔ signaling service</td>
                                <td>
                                    Peer presence and connection negotiation for
                                    authorized device pairs.
                                </td>
                            </tr>
                            <tr>
                                <td>Client ↔ linked client</td>
                                <td>
                                    Live encrypted synchronization over WebRTC,
                                    directly or through a TURN relay.
                                </td>
                            </tr>
                            <tr>
                                <td>Client ↔ backup storage</td>
                                <td>
                                    Encrypted snapshot uploads and downloads
                                    using signed URLs issued by the API.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Linked devices exchange encrypted changes and merge them
                    into their local vaults. The servers help establish the
                    connection but do not apply those changes. Managed backups
                    preserve vault contents at the time of upload for later
                    restoration. Devices do not use them to catch up on missed
                    synchronization.
                </p>
            </DocSection>

            <DocSection id="account" title="How the account session works">
                <p>
                    Each enrolled device has an ECDSA P-256 signing key pair.
                    Its private key is stored inside the encrypted vault; the
                    service holds the public key. To authenticate, the API sends
                    a random challenge that can be used only once. The client
                    signs that challenge with its private key using ECDSA with
                    SHA-256 as the hash function. The API verifies the signature
                    against the registered public key, proving that the client
                    holds the corresponding private key. It then issues a
                    short-lived access token and a rotating refresh token.
                </p>
                <p>
                    The master password unlocks the local vault, making the
                    device's private signing key available to the client. Online
                    Services authenticates the device through its signature,
                    without receiving the master password or private key. This
                    account signing key is separate from the{" "}
                    <a href="https://csrc.nist.gov/projects/post-quantum-cryptography">
                        post-quantum keys
                    </a>{" "}
                    used for device synchronization.
                </p>
                <p>
                    Refreshing a session replaces the refresh token. Reuse of a
                    consumed token revokes that device's sessions. Access also
                    depends on an active server-side session and current device
                    permissions, not just the token's signature and expiry.
                    Logout revokes the current session; removing a device
                    revokes its sessions.
                </p>
                <p>
                    The web app keeps the session in its unlocked application
                    state. The extension service worker owns its session and
                    injects authorization only for allowed API routes. Locking
                    or a 30-minute system idle event clears the extension
                    session and attempts remote revocation.
                </p>
            </DocSection>

            <DocSection id="sync" title="Managed synchronization services">
                <p>
                    Managed signaling introduces linked devices and authorizes
                    their presence channel. STUN assists direct connectivity.
                    The API issues short-lived TURN credentials when relay is
                    needed. Once connected, the clients perform their own
                    signed, end-to-end encrypted synchronization protocol. Both
                    vaults must be unlocked and online at the same time; a
                    background window can participate while its client remains
                    running.
                </p>
                <p>
                    The service can observe account/device identifiers,
                    connection timing, addresses and traffic volume needed to
                    operate these network services. Only the linked devices hold
                    the session keys needed to decrypt synchronization traffic.
                    Signaling servers and TURN relays do not receive those keys
                    and cannot read the vault contents exchanged between
                    devices.
                </p>
                <p>
                    The{" "}
                    <Link href="/docs/synchronization">
                        synchronization protocol
                    </Link>{" "}
                    covers key establishment, message protection, and merging in
                    detail.
                </p>
            </DocSection>

            <DocSection id="devices" title="Device management and root access">
                <p>
                    Device registration associates a signing identity with an
                    account. A pairwise link separately authorizes two devices
                    to discover and synchronize with one another. Managed
                    signaling checks both the saved relationship and the
                    account's device-linking entitlement.
                </p>
                <p>
                    A root device has account administration permissions (not
                    operating-system root access). The first registered device
                    is a root device; newly linked devices start without root
                    access. Root permissions govern device enrollment, removal,
                    permission changes, and backup settings. At least one device
                    must retain root access. Demotion revokes the device's
                    existing sessions so subsequent requests use its new
                    permissions.
                </p>
                <p>
                    Unlinking removes a pairwise relationship but keeps both
                    account registrations. Removing a device also removes its
                    account sync relationships. Neither operation remotely
                    erases the device's local vault.
                </p>
                <p>
                    See{" "}
                    <Link href="/docs/linking-devices#manage">
                        Manage devices and links
                    </Link>{" "}
                    for the map, connection statuses, and saved-link cleanup.
                </p>
            </DocSection>

            <DocSection id="backups" title="Encrypted backup lifecycle">
                <p>
                    The client creates a <code>.cryx</code> snapshot and
                    encrypts it before transfer. Managed backup copies omit
                    linked-device and sync configuration but retain the
                    encrypted Online Services device binding needed after
                    restore.
                </p>
                <ol className={t.protocolFlow}>
                    <li>
                        <strong>Create an upload intent</strong>
                        <p>
                            The client submits the ciphertext byte length,
                            SHA-256 checksum, and an idempotency key. The API
                            reserves quota for a pending snapshot and returns a
                            temporary signed upload URL.
                        </p>
                    </li>
                    <li>
                        <strong>Transfer ciphertext</strong>
                        <p>
                            The client uploads directly to storage. Retrying the
                            same snapshot reuses its encrypted bytes and
                            idempotency key rather than creating another backup.
                        </p>
                    </li>
                    <li>
                        <strong>Complete the snapshot</strong>
                        <p>
                            The API checks the stored object's size and checksum
                            metadata before marking the snapshot ready.
                            Incomplete intents expire; a pending upload is not a
                            restore point.
                        </p>
                    </li>
                    <li>
                        <strong>Download and verify</strong>
                        <p>
                            After authorization, the API issues a temporary
                            download URL. The client checks the downloaded byte
                            length and SHA-256 checksum before local decryption.
                            These transfer checks do not replace authenticated
                            encryption.
                        </p>
                    </li>
                </ol>
                <p>
                    Automatic backup runs only while the vault is open and
                    unlocked. Successful changes are grouped for 30 seconds.
                    Transient failures retry during that unlocked session. Lock
                    gives a final attempt up to five seconds; closing the
                    browser or losing power cannot guarantee a final upload.
                </p>
                <p>
                    Root devices can list and download the account's ready
                    snapshots; non-root devices can access their own snapshots.
                    Enabling managed backups requires an eligible entitlement
                    and an existing Online Services Recovery Kit. The{" "}
                    <Link href="/docs/backups">backup user guide</Link> covers
                    setup, downloads, and restoration.
                </p>
            </DocSection>

            <DocSection
                id="recovery"
                title="Recovery authorization and decryption"
            >
                <p>
                    The Online Services Recovery Kit contains an account ID and
                    recovery phrase. It authorizes account recovery; it cannot
                    decrypt a vault. Fresh-device backup recovery exchanges
                    these credentials for a short-lived recovery session that
                    can list and download backups from current root devices.
                </p>
                <p>
                    The service checks that an eligible backup exists before
                    consuming the Kit. Successful session creation invalidates
                    that Kit. Retries using the same client-generated session
                    token can resume the session after a lost response. If no
                    eligible backup exists, the Kit remains valid. Rotating the
                    recovery package invalidates earlier Kits and active backup
                    recovery sessions.
                </p>
                <p>
                    The downloaded snapshot still needs local decryption with
                    its master password and any additional key protection, or
                    its vault recovery code. The encrypted account binding in
                    the snapshot lets the restored root device authenticate
                    again, provided that registration is still valid. After
                    unlock, the client requests a replacement Recovery Kit. See
                    the <Link href="/docs/recovery">recovery guide</Link> for
                    this flow and account recovery from an existing vault.
                </p>
            </DocSection>

            <DocSection id="limits" title="Quota, request limits, and pruning">
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th>Rule</th>
                                <th>Current service behavior</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Per backup</td>
                                <td>
                                    At most 10 MB of ciphertext for one backup.
                                </td>
                            </tr>
                            <tr>
                                <td>Account quota</td>
                                <td>
                                    150 MB total ciphertext, including pending
                                    uploads.
                                </td>
                            </tr>
                            <tr>
                                <td>Pending uploads</td>
                                <td>
                                    At most 5 upload intents can remain pending.
                                </td>
                            </tr>
                            <tr>
                                <td>Upload intents</td>
                                <td>At most 120 per UTC day.</td>
                            </tr>
                            <tr>
                                <td>First 24 hours</td>
                                <td>
                                    All ready snapshots remain eligible for
                                    routine retention.
                                </td>
                            </tr>
                            <tr>
                                <td>Through 30 days</td>
                                <td>
                                    The newest snapshot for each day is
                                    retained.
                                </td>
                            </tr>
                            <tr>
                                <td>Through 366 days</td>
                                <td>
                                    The newest snapshot for each month is
                                    retained.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    The newest completed backup from each current root device is
                    protected from routine pruning. Storage is limited by total
                    size; there is no fixed maximum number of completed backups.
                    Each backup must also fit within the 10 MB per-backup limit
                    and the account&apos;s 150 MB total allowance.
                </p>
            </DocSection>

            <DocSection id="ending" title="Entitlement loss and deletion">
                <dl>
                    <div className={t.definition}>
                        <dt>Pause backups</dt>
                        <dd>
                            Stops automatic uploads. Existing restore points
                            remain available and continue under normal retention
                            rules.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Cancel subscription</dt>
                        <dd>
                            Paid access continues to the end of the paid period.
                            After entitlement ends, new uploads stop.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>After entitlement</dt>
                        <dd>
                            Remaining snapshots can be downloaded or deleted for
                            90 days, subject to normal pruning, then they are
                            queued for deletion.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Delete account</dt>
                        <dd>
                            Deletes active account records and queues hosted
                            backups for deletion, without the 90-day grace
                            period.
                        </dd>
                    </div>
                </dl>
                <p>
                    Hosted backup deletion is asynchronous. Queued cleanup
                    removes stored objects and retries failures. Ending Online
                    Services does not erase local vaults or downloaded backups.
                </p>
            </DocSection>

            <DocSection id="references" title="Public client implementation">
                <p>
                    These links pin the client revision used for this guide.
                    They document client behavior and request contracts, not the
                    private service implementation.
                </p>
                <ul>
                    <li>
                        <a
                            href={`${sourceRoot}/packages/vault-core/src/vault-utils/device-signing-key.ts`}
                        >
                            Device signing keys
                        </a>{" "}
                        and{" "}
                        <a
                            href={`${sourceRoot}/packages/vault-core/src/online-services-session/protocol.ts`}
                        >
                            session protocol
                        </a>
                        : challenge signatures, token refresh, and session
                        expiry.
                    </li>
                    <li>
                        <a
                            href={`${sourceRoot}/web/src/app_lib/managed-backups.ts`}
                        >
                            Backup transfer client
                        </a>
                        : upload intents, signed transfers, download
                        verification, and recovery sessions.
                    </li>
                    <li>
                        <a
                            href={`${sourceRoot}/web/src/app_lib/managed-backup-coordinator.ts`}
                        >
                            Backup coordinator
                        </a>
                        : change grouping, retry behavior, and the lock-time
                        upload attempt.
                    </li>
                    <li>
                        <a
                            href={`${sourceRoot}/web/src/app_lib/vault-utils/storage.ts`}
                        >
                            Snapshot serialization
                        </a>
                        : encrypted backup contents and removal of saved sync
                        links.
                    </li>
                </ul>
            </DocSection>
        </DocArticle>
    );
}
