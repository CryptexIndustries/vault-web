import Link from "next/link";
import { DocArticle, DocSection } from "@/components/marketing/doc-article";
import t from "@/styles/TechnicalDocs.module.css";

const extensionModel =
    "https://github.com/CryptexIndustries/vault-web/blob/master/extension/docs/threat-model.md";
const webModel =
    "https://github.com/CryptexIndustries/vault-web/blob/master/web/threat-model.md";

export default function ThreatModel() {
    return (
        <DocArticle
            title="Threat model"
            description="What Cryptex Vault protects against, what it trusts, and where those protections stop."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#assets", label: "Scope and assumptions" },
                { href: "#limits", label: "Main scenarios" },
                { href: "#controls", label: "Client-specific boundaries" },
                { href: "#practice", label: "Detailed documentation" },
            ]}
            related={[
                { href: "/docs/architecture", title: "Architecture" },
                { href: "/docs/cryptography", title: "Cryptography" },
                {
                    href: "/docs/privacy-and-metadata",
                    title: "Privacy and metadata",
                },
                {
                    href: "/security/responsible-disclosure",
                    title: "Responsible disclosure",
                },
            ]}
        >
            <DocSection id="assets" title="Scope and assumptions">
                <p>
                    This page summarizes the web application, Chromium
                    Extension, linked-device connections, and optional Online
                    Services. Detailed controls, implementation references, and
                    known limitations remain in the repository documents linked
                    below.
                </p>
                <p>
                    The protected data includes vault contents, the keys and
                    recovery material that unlock them, and credentials used to
                    access Online Services. Both clients rely on the browser,
                    operating system, and application code to handle decrypted
                    data during an unlocked session.
                </p>
                <p>
                    Local vault operations do not require Online Services.
                    Loading the hosted web application still contacts its web
                    host. The synchronization and managed-backup scenarios below
                    apply when those features are used.
                </p>
            </DocSection>

            <DocSection id="limits" title="Main scenarios">
                <div
                    className={t.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Attacker access, protections, and remaining capabilities"
                >
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">Attacker access</th>
                                <th scope="col">Protection</th>
                                <th scope="col">Remaining capability</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>A copied encrypted vault or backup</td>
                                <td>
                                    Reading its contents requires a valid unlock
                                    path. Password derivation adds cost to
                                    guessing.
                                </td>
                                <td>
                                    Offline guessing remains possible. A
                                    matching vault recovery code provides a
                                    separate way to decrypt it.
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    Network traffic or a signaling/TURN server
                                </td>
                                <td>
                                    Authenticated, application-encrypted peer
                                    sessions protect synchronized vault
                                    contents.
                                </td>
                                <td>
                                    Connection metadata can be observed. A
                                    server on the connection path can delay or
                                    interrupt communication.
                                </td>
                            </tr>
                            <tr>
                                <td>Control of the managed backup service</td>
                                <td>
                                    Vault snapshots are encrypted on the client
                                    before upload.
                                </td>
                                <td>
                                    The service can see backup metadata and
                                    withhold or delete stored copies. Encryption
                                    does not guarantee availability.
                                </td>
                            </tr>
                            <tr>
                                <td>A website using extension autofill</td>
                                <td>
                                    Credential-matching rules and extension
                                    message permissions limit access to vault
                                    operations.
                                </td>
                                <td>
                                    The website can read credentials filled into
                                    its fields. It can also interfere with the
                                    autofill interface.
                                </td>
                            </tr>
                            <tr>
                                <td>An authorized linked device</td>
                                <td>
                                    Peer authentication checks the established
                                    linking relationship.
                                </td>
                                <td>
                                    The device can read records it receives and
                                    send changes. Revoking service access does
                                    not erase its existing local data.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    Access to an entire browser profile is different from
                    possession of a backup file. The profile may also contain
                    locally retained protection-phrase key material. That
                    material does not unlock the vault by itself; the master
                    password is still required. Control of a running, unlocked
                    client can expose decrypted data; encryption at rest does
                    not prevent that access.
                </p>
                <p>
                    Copied passwords, screenshots, and cleartext exports are
                    outside the encrypted vault. Changing a vault secret also
                    leaves older backup copies protected by their original
                    secrets. The{" "}
                    <Link href="/docs/cryptography#changes">
                        key-change comparison
                    </Link>{" "}
                    explains that distinction.
                </p>
            </DocSection>

            <DocSection id="controls" title="Client-specific boundaries">
                <h3>Web application</h3>
                <p>
                    The browser runs code delivered by the application host.
                    That host is therefore trusted to serve the intended
                    application. If the delivered code is compromised, it can
                    access data when the vault is unlocked. Self-hosting changes
                    who controls delivery, but the browser still relies on the
                    code it loads.
                </p>
                <p>
                    Operating a signaling, relay, or backup service does not by
                    itself grant access to the client's decrypted vault.
                </p>
                <h3>Chromium Extension</h3>
                <p>
                    The installed extension and its updates are trusted
                    application code. Visited websites do not receive the
                    extension's full vault privileges. The service worker checks
                    messages from extension contexts, and credential-matching
                    rules govern autofill requests. Filling a credential
                    deliberately makes it available to the destination page.
                </p>
                <p>
                    The <a href={extensionModel}>extension threat model</a>{" "}
                    documents the message permissions, autofill and passkey
                    controls, local-session assumptions, and remaining risks.
                    Its scope does not include the web application.
                </p>
            </DocSection>

            <DocSection id="practice" title="Detailed documentation">
                <dl>
                    <div className={t.definition}>
                        <dt>Chromium Extension</dt>
                        <dd>
                            <a href={extensionModel}>Repository threat model</a>
                            . The detailed reference for extension-specific
                            controls and known limitations.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Web application</dt>
                        <dd>
                            <a href={webModel}>Web application threat model</a>{" "}
                            in <code>web/threat-model.md</code>.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Related technical guides</dt>
                        <dd>
                            <Link href="/docs/cryptography">Cryptography</Link>{" "}
                            describes key protection,{" "}
                            <Link href="/docs/synchronization">
                                Synchronization
                            </Link>{" "}
                            covers peer sessions, and{" "}
                            <Link href="/docs/privacy-and-metadata">
                                Privacy and metadata
                            </Link>{" "}
                            describes service visibility.
                        </dd>
                    </div>
                </dl>
                <p>
                    See the{" "}
                    <Link href="/security#source-release">Security page</Link>{" "}
                    for audit status and the{" "}
                    <Link href="/security/responsible-disclosure">
                        responsible disclosure policy
                    </Link>{" "}
                    for reporting vulnerabilities.
                </p>
            </DocSection>
        </DocArticle>
    );
}
