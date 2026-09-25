import Link from "next/link";
import { DocArticle, DocSection } from "@/components/marketing/doc-article";
import {
    ArchitectureOverview,
    ClientArchitecture,
} from "@/components/marketing/architecture-diagrams";
import t from "@/styles/TechnicalDocs.module.css";

const sourceRoot =
    "https://github.com/CryptexIndustries/vault-web/blob/a01ac684cea1491814f2ede553c32dffc82b64bd";

export default function Architecture() {
    return (
        <DocArticle
            title="Architecture"
            description="Where the vault lives, how devices connect, and how the web application and Chromium Extension run the same vault core."
            eyebrow="TECHNICAL GUIDE"
            toc={[
                { href: "#system", label: "System overview" },
                { href: "#core", label: "Shared vault core" },
                { href: "#web", label: "Web application" },
                { href: "#extension", label: "Chromium Extension" },
                { href: "#references", label: "Implementation references" },
            ]}
            related={[
                {
                    href: "/docs/cryptography",
                    title: "Cryptography",
                    description:
                        "Algorithms, vault encryption, and key handling.",
                },
                {
                    href: "/docs/threat-model",
                    title: "Threat model",
                    description:
                        "Security assumptions and protection boundaries.",
                },
                {
                    href: "/docs/synchronization",
                    title: "Synchronization",
                    description: "Session establishment and record exchange.",
                },
                {
                    href: "/docs/online-services",
                    title: "Online Services",
                    description: "Account authorization and backup lifecycle.",
                },
            ]}
        >
            <DocSection id="system" title="System overview">
                <p>
                    Each installation keeps its own encrypted vault on the
                    device. The web application and extension can work locally,
                    synchronize through your own servers, or use Online Services
                    for managed connections and encrypted backups.
                </p>
                <ArchitectureOverview />
                <p>
                    The server hosting the web application delivers its code and
                    assets. Vault operations run in the browser. Hosting the
                    application and providing synchronization services are
                    separate responsibilities; the{" "}
                    <Link href="/docs/self-hosting">self-hosting guide</Link>{" "}
                    covers deploying both.
                </p>
                <p>
                    See <Link href="/docs/cryptography">Cryptography</Link> for
                    encryption and key details, and the{" "}
                    <Link href="/docs/threat-model">Threat model</Link> for
                    security assumptions.
                </p>
            </DocSection>
            <DocSection id="core" title="Shared vault core">
                <p>
                    Both applications use{" "}
                    <code>@cryptex-industries/vault-core</code>. It defines the
                    vault records and serialized format, implements vault
                    encryption and import/export, and handles device linking and
                    synchronization.
                </p>
                <p>
                    The core runs inside each client, not as a central server.
                    Platform adapters supply browser-specific facilities such as
                    session handling, logging, local key storage, and access to
                    Online Services. The web application and extension provide
                    their own interfaces and decide where those operations run.
                </p>
                <p>
                    Sharing the format and protocol lets a web vault synchronize
                    with an extension vault. They still have separate local
                    storage and unlocked sessions, even when installed in the
                    same browser. Linking connects those installations; it does
                    not give them a shared database.
                </p>
            </DocSection>
            <DocSection id="web" title="Inside the web application">
                <p>
                    The web application runs its vault interface and operations
                    in the browser page. It uses IndexedDB, through Dexie, to
                    persist encrypted vault records in <code>vaultDB</code>.
                    This database belongs to the web application's origin and
                    browser profile.
                </p>
                <ClientArchitecture variant="web" />
                <dl>
                    <div className={t.definition}>
                        <dt>Unlock</dt>
                        <dd>
                            The client reads the encrypted record and opens it
                            locally. The unlocked vault and active
                            data-encryption key remain in page memory for the
                            session.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Edit and save</dt>
                        <dd>
                            A write coordinator queues mutations, including
                            incoming synchronization changes. Each operation
                            reads the latest local state, applies its change,
                            and persists the encrypted result before publishing
                            the new state to the interface.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Lock</dt>
                        <dd>
                            Locking joins the same queue after pending writes.
                            After saving, it closes synchronization connections
                            and clears the active vault and key from application
                            state.
                        </dd>
                    </div>
                </dl>
                <p>
                    The write coordinator belongs to one page context. Separate
                    tabs have separate queues, so it does not coordinate
                    concurrent edits to the same vault across tabs.
                </p>
                <p>
                    The page also runs the connection controller for linked
                    devices. With Online Services enabled, a backup coordinator
                    prepares encrypted snapshots for upload. Those are separate
                    paths: synchronization exchanges records with another live
                    client, while a backup stores a snapshot for restoration.
                </p>
            </DocSection>
            <DocSection id="extension" title="Inside the Chromium Extension">
                <p>
                    The extension uses Manifest V3 and divides work between its
                    service worker, extension pages, and scripts on visited
                    websites. The service worker handles vault operations; the
                    popup and linking page send it requests rather than writing
                    the vault database themselves.
                </p>
                <ClientArchitecture variant="extension" />
                <dl>
                    <div className={t.definition}>
                        <dt>Service worker</dt>
                        <dd>
                            Processes vault reads and writes, manages the
                            unlocked session, and handles privileged requests
                            such as autofill and account operations. Encrypted
                            vault records are persisted in the extension's
                            IndexedDB storage.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Session storage</dt>
                        <dd>
                            The unlocked vault and active key material use{" "}
                            <code>chrome.storage.session</code>. This
                            browser-managed, memory-backed state lets a
                            restarted worker resume the session. Closing the
                            popup is therefore different from locking the vault.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Extension pages</dt>
                        <dd>
                            The popup displays the vault interface. Extension
                            pages also run linking and live peer connections,
                            forwarding vault changes to the worker for
                            persistence. An unlocked worker session alone is not
                            a continuously running synchronization connection.
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Website integration</dt>
                        <dd>
                            Content scripts detect input fields, and autofill
                            frames display credential choices. They send
                            messages to the worker, which checks the requesting
                            context and permitted operation. Autofill inserts
                            the selected username and password into the
                            website's fields.
                        </dd>
                    </div>
                </dl>
                <p>
                    The visited website is outside the extension's own pages and
                    storage. For the detailed message checks and website
                    interaction boundaries, see the{" "}
                    <Link href="/docs/threat-model">Threat model</Link>. For
                    autofill instructions, see the{" "}
                    <Link href="/docs/browser-extension">
                        extension user guide
                    </Link>
                    .
                </p>
            </DocSection>
            <DocSection id="references" title="Implementation references">
                <dl>
                    <div className={t.definition}>
                        <dt>Shared core</dt>
                        <dd>
                            <a
                                href={
                                    sourceRoot +
                                    "/packages/vault-core/src/proto/vault.proto"
                                }
                            >
                                Vault schema
                            </a>
                            ,{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "/packages/vault-core/src/runtime.ts"
                                }
                            >
                                platform runtime
                            </a>
                            , and{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "/packages/vault-core/src/vault-utils/vault-write-coordinator.ts"
                                }
                            >
                                write coordinator
                            </a>
                            .
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Web application</dt>
                        <dd>
                            <a
                                href={
                                    sourceRoot +
                                    "/web/src/app_lib/vault-utils/storage.ts"
                                }
                            >
                                Local storage
                            </a>
                            ,{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "/web/src/utils/vault-mutations.ts"
                                }
                            >
                                mutation persistence
                            </a>
                            , and{" "}
                            <a
                                href={
                                    sourceRoot + "/web/src/utils/vault-lock.ts"
                                }
                            >
                                lock lifecycle
                            </a>
                            .
                        </dd>
                    </div>
                    <div className={t.definition}>
                        <dt>Extension</dt>
                        <dd>
                            <a
                                href={
                                    sourceRoot + "/extension/src/background.ts"
                                }
                            >
                                Service worker
                            </a>
                            ,{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "/extension/src/background/session-dek-store.ts"
                                }
                            >
                                session key storage
                            </a>
                            , and{" "}
                            <a
                                href={
                                    sourceRoot +
                                    "/extension/src/background/autofill-router.ts"
                                }
                            >
                                autofill routing
                            </a>
                            .
                        </dd>
                    </div>
                </dl>
            </DocSection>
        </DocArticle>
    );
}
