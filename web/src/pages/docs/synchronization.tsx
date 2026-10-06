import Link from "next/link";
import {
    DocArticle,
    DocCallout,
    DocSection,
} from "@/components/marketing/doc-article";
import t from "@/styles/TechnicalDocs.module.css";

const sourceRoot =
    "https://github.com/CryptexIndustries/vault-web/blob/42085796a717d1852b5ae6ae4685985695eca0dd";

export default function Synchronization() {
    return (
        <DocArticle
            title="Synchronization"
            description="How linked devices compare vault state, resolve concurrent edits, and carry deletions without a cloud copy of your vault."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#model", label: "The sync model" },
                { href: "#session", label: "Session establishment" },
                { href: "#exchange", label: "Record exchange" },
                { href: "#changes", label: "Changes and conflicts" },
                { href: "#many-devices", label: "Three or more devices" },
                { href: "#references", label: "Implementation references" },
            ]}
            related={[
                {
                    href: "/docs/linking-devices",
                    title: "Linking devices user guide",
                },
                {
                    href: "/docs/troubleshooting#linking",
                    title: "Troubleshoot synchronization",
                },
                {
                    href: "/docs/architecture",
                    title: "Architecture",
                    description: "Where each part of the system runs.",
                },
                {
                    href: "/docs/online-services",
                    title: "Online Services",
                    description: "What managed signaling and relay provide.",
                },
            ]}
        >
            <DocSection id="model" title="The sync model">
                <p>
                    Synchronization is a live, pairwise exchange between two
                    linked vault installations. Signaling helps the devices find
                    each other.{" "}
                    <a href="https://www.rfc-editor.org/info/rfc8831/">
                        WebRTC data channels
                    </a>{" "}
                    carry the data directly when possible; a{" "}
                    <a href="https://www.rfc-editor.org/info/rfc8656/">TURN</a>{" "}
                    server can relay the same encrypted traffic when a direct
                    route cannot be established.
                </p>
                <ol className={t.protocolFlow}>
                    <li>
                        <strong>Find the peer</strong>
                        <p>
                            Signaling exchanges connection details; WebRTC opens
                            a direct or relayed data channel.
                        </p>
                    </li>
                    <li>
                        <strong>Establish an authenticated session</strong>
                        <p>
                            Keys exchanged during linking authenticate the peer
                            and establish encryption for sync messages.
                        </p>
                    </li>
                    <li>
                        <strong>Compare and transfer records</strong>
                        <p>
                            Both peers exchange record summaries and request the
                            missing or newer records.
                        </p>
                    </li>
                </ol>
                <DocCallout title="No offline mailbox" tone="warning">
                    <p>
                        The signaling or TURN service does not keep changes for
                        an absent device. Both vaults must be open, unlocked,
                        and reachable at the same time. Managed backups are
                        restore points; they do not provide asynchronous sync.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="session" title="Session establishment">
                <p>
                    Linking stores the peer's signing and key-encapsulation
                    public keys, a shared sync identifier, and connection-server
                    configuration. Subsequent synchronization sessions use that
                    saved relationship to locate and authenticate the peer.
                </p>
                <p>
                    Signaling carries WebRTC connection negotiation.{" "}
                    <a href="https://www.rfc-editor.org/info/rfc8489/">STUN</a>{" "}
                    helps discover network addresses, and TURN provides a relay
                    when a direct route is unavailable. A successful signaling
                    connection does not guarantee that a WebRTC data channel can
                    be established.
                </p>
                <p>
                    Over that channel,{" "}
                    <a href="https://csrc.nist.gov/pubs/fips/203/final">
                        ML-KEM-768
                    </a>{" "}
                    establishes shared secret material and{" "}
                    <a href="https://csrc.nist.gov/pubs/fips/204/final">
                        ML-DSA-65
                    </a>{" "}
                    authenticates the handshake using the saved peer keys.{" "}
                    <a href="https://datatracker.ietf.org/doc/html/rfc5869">
                        HKDF-SHA-256
                    </a>{" "}
                    derives a session key bound to the handshake transcript.{" "}
                    <a href="https://csrc.nist.gov/pubs/sp/800/38/d/final">
                        AES-256-GCM
                    </a>{" "}
                    protects subsequent messages with authenticated context and
                    ordered sequence numbers. See the{" "}
                    <Link href="/docs/cryptography#sync">
                        cryptographic protocol reference
                    </Link>{" "}
                    for the encryption details.
                </p>
            </DocSection>

            <DocSection id="exchange" title="Record exchange">
                <p>
                    The initiating peer sends <code>SyncHello</code> with
                    summaries of its credentials and directories. The other peer
                    returns its summaries in <code>SyncHelloEcho</code>. Each
                    side independently compares the remote summaries with its
                    local records.
                </p>
                <p>
                    A <code>SyncDataRequest</code> identifies the records needed
                    by item type and ID. The peer returns those records in{" "}
                    <code>SyncDataResponse</code>, and the receiving client
                    applies them to its local vault. Unchanged records do not
                    need to be transferred in full.
                </p>
                <p>
                    Synchronization exchanges vault records over the encrypted
                    session. Each installation keeps its own local encryption
                    and unlock settings.
                </p>
                <h3>What completion means</h3>
                <p>
                    Each device records completion after saving the records it
                    requested, or after comparing summaries and finding nothing
                    it needs to request. A failed local save does not advance
                    that device's last-sync status.
                </p>
                <p>
                    Completion describes that device's comparison with one peer
                    at that time. It is not an acknowledgement that the peer has
                    saved changes sent in the other direction, or that every
                    linked device has received them. Later edits require another
                    exchange.
                </p>
            </DocSection>

            <DocSection id="changes" title="Changes, conflicts, and deletions">
                <p>
                    Each credential and directory carries an ID, version,
                    modified timestamp, hash, and deletion flag. Peers first
                    exchange these summaries. A device requests a full record
                    when it is missing locally or when the remote record wins
                    the comparison.
                </p>
                <div className={t.tableWrap}>
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th>Situation</th>
                                <th>Result implemented by the client</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Different versions</td>
                                <td>The larger version wins.</td>
                            </tr>
                            <tr>
                                <td>Same version, different content</td>
                                <td>The later modified timestamp wins.</td>
                            </tr>
                            <tr>
                                <td>Same version and timestamp</td>
                                <td>
                                    The lexicographically smaller hash is the
                                    deterministic tie-breaker.
                                </td>
                            </tr>
                            <tr>
                                <td>Credential deleted</td>
                                <td>
                                    A tombstone remains so the deletion can
                                    propagate to another device.
                                </td>
                            </tr>
                            <tr>
                                <td>Directory deleted</td>
                                <td>
                                    Its record is tombstoned and contained
                                    credentials are scrubbed and tombstoned.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    A tombstone is a retained deletion record. It keeps the
                    item's identity and version information so other devices can
                    apply the deletion. For a deleted credential, its sensitive
                    contents are removed.
                </p>
                <p>
                    Conflict resolution is record-wide. It does not merge the
                    username from one edit with the notes from another. Device
                    clocks participate when equal-version records differ, so
                    badly skewed clocks can affect which concurrent edit wins.
                </p>
            </DocSection>

            <DocSection id="many-devices" title="Three or more devices">
                <p>
                    Sync is pairwise, not a broadcast transaction. If device A
                    syncs with B while C is offline, C remains unchanged. Later,
                    B can carry the winning records to C, or A can sync with C
                    directly. A change has reached every device only after a
                    chain of successful pairwise sessions covers them all.
                </p>
                <p>
                    When several devices edit the same record before meeting,
                    each pair applies the same version, timestamp, and hash
                    ordering. This gives them a deterministic result as those
                    sessions complete.
                </p>
            </DocSection>
            <DocSection id="references" title="Implementation references">
                <p>
                    These links point to the source revision used for this
                    description, so the references remain stable as the code
                    changes.
                </p>
                <p>
                    <a
                        href={`${sourceRoot}/packages/vault-core/src/proto/vault.proto#L360`}
                    >
                        Message definitions
                    </a>
                    : the encrypted envelope, record summaries, requests, and
                    responses exchanged by peers.
                </p>
                <p>
                    <a
                        href={`${sourceRoot}/packages/vault-core/src/synchronization.ts`}
                    >
                        Synchronization engine
                    </a>
                    : session authentication, message ordering, record
                    comparison, and completion handling.
                </p>
                <p>
                    <a
                        href={`${sourceRoot}/packages/vault-core/src/vault-utils/vault.ts#L908`}
                    >
                        Deletion and conflict rules
                    </a>
                    : credential tombstones and the version, timestamp, and hash
                    comparison used when accepting records.
                </p>
                <p>
                    <a
                        href={`${sourceRoot}/web/src/components/vault-dashboard/sync-controller.ts#L108`}
                    >
                        Web vault persistence
                    </a>
                    : applying received records and propagating save failures to
                    the synchronization engine.
                </p>
            </DocSection>
        </DocArticle>
    );
}
