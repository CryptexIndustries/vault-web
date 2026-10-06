import Link from "next/link";
import {
    Site,
    Label,
    Section,
    Action,
    REPO,
    s,
} from "@/components/marketing/site";
export default function Security() {
    return (
        <Site
            title="Security and its limits"
            description="Cryptex Vault’s security architecture, audit status, threat boundaries, infrastructure visibility and responsible disclosure policy."
        >
            <section className={s.pageHero}>
                <Label>SECURITY / TRUST THROUGH TRANSPARENCY</Label>
                <h1>
                    Trust needs
                    <br />
                    <em>something to stand on.</em>
                </h1>
                <p>
                    See how Cryptex Vault protects your data, where that
                    protection ends, and what we&apos;re doing to improve its
                    security.
                </p>
                <div className={s.actions}>
                    <Action href="/docs/architecture" secondary>
                        Read the architecture
                    </Action>
                    <Link href="#disclosure" className={s.textLink}>
                        Report a vulnerability
                    </Link>
                </div>
            </section>
            <Section id="source-release" number="01" label="SECURITY STATUS">
                <div className={s.sectionHeading}>
                    <h2>The current picture.</h2>
                    <p>
                        Algorithm names are only part of the story.
                        Implementation, protocol design and independent scrutiny
                        matter.
                    </p>
                </div>
                <div className={s.statusTable}>
                    {[
                        [
                            "Independent security audit",
                            "Not yet completed",
                            "Independent review is part of the security roadmap.",
                            undefined,
                        ],
                        [
                            "Internal red-team testing",
                            "Performed",
                            "We have conducted thorough internal red-team testing, and we recognize that it does not replace an independent audit.",
                            undefined,
                        ],
                        [
                            "Source code",
                            "Public repository - AGPL-3.0",
                            "The source code is public. You can inspect the implementation, build the software, and follow development on GitHub.",
                            REPO,
                        ],
                        [
                            "Threat model",
                            "Web app and extension documented",
                            "Read the published threat model for product-wide threats, trust boundaries, and assumptions.",
                            "/docs/threat-model",
                        ],
                        [
                            "Responsible disclosure",
                            "Public policy",
                            "Private reports receive a first response within 3 working days.",
                            "/security/responsible-disclosure",
                        ],
                    ].map(([label, status, text, href]) => (
                        <div key={label}>
                            <h3>{label}</h3>
                            <strong>
                                {href ? (
                                    <Link href={href}>{status}</Link>
                                ) : (
                                    status
                                )}
                            </strong>
                            <p>{text}</p>
                        </div>
                    ))}
                </div>
            </Section>
            <Section number="02" label="THE SECURITY BOUNDARY">
                <div className={s.sectionHeading}>
                    <h2>
                        Encryption has a boundary.
                        <br />
                        Your device is part of it.
                    </h2>
                    <p>
                        Cryptex Vault protects stored and synchronized data. It
                        cannot secure an unlocked vault on a compromised device.
                    </p>
                </div>
                <div className={s.twoColumns}>
                    <article>
                        <Label>WHAT THE DESIGN PROTECTS</Label>
                        <h3>Vault storage and data in transit.</h3>
                        <p>
                            Your vault is encrypted on your device before it is
                            stored or backed up. When linked devices sync,
                            post-quantum cryptography helps them confirm each
                            other&apos;s identity and establish a secure
                            session. Vault data then travels between them in
                            end-to-end encrypted messages, even when a TURN
                            server relays the connection.
                        </p>
                        <p>
                            Cryptex Vault&apos;s signaling servers and TURN
                            relays help devices connect. Managed backup storage
                            holds encrypted vault copies. None of these services
                            receives plaintext passwords, plaintext vault
                            contents or decryption keys.
                        </p>
                        <p className={s.referenceLinks}>
                            Read the{" "}
                            <Link href="/docs/synchronization">sync guide</Link>{" "}
                            for the connection flow and the{" "}
                            <Link href="/docs/cryptography">
                                cryptography guide
                            </Link>{" "}
                            for the algorithms and keys.
                        </p>
                    </article>
                    <article className={s.boundary}>
                        <Label>WHAT IT DOES NOT PROTECT</Label>
                        <h3>A compromised, unlocked device.</h3>
                        <p>
                            While the vault is unlocked, your browser and
                            operating system need access to its data. A
                            compromised device may expose that unlocked data, so
                            keeping your device, browser and extensions up to
                            date remains important.
                        </p>
                        <p>
                            Revoking Online Services permissions does not
                            remotely erase a local vault. Keep a backup and its
                            recovery information somewhere safe and separate
                            from your devices. If every device is lost or wiped,
                            you will need both to restore your vault.
                        </p>
                    </article>
                </div>
                <Link className={s.textLink} href="/docs/threat-model">
                    Read the product threat model
                </Link>
            </Section>
            <Section number="03" label="INFRASTRUCTURE VISIBILITY">
                <div className={s.sectionHeading}>
                    <h2>
                        Encrypted content.
                        <br />
                        Observable connections.
                    </h2>
                    <p>
                        If you use only the local vault, Cryptex Industries does
                        not receive connection setup metadata. If you choose
                        Online Services, its synchronization, backup and account
                        systems process the limited service data listed below.
                    </p>
                </div>
                <div className={s.statusTable}>
                    {[
                        [
                            "Signaling",
                            "Connection setup",
                            "Opaque SyncIDs, channel names, presence identifiers, connection timing and WebRTC SDP/ICE information, including IP addresses, ports and network paths.",
                        ],
                        [
                            "STUN / TURN",
                            "Network metadata",
                            "Network addresses, connection metadata and, for relayed connections, encrypted traffic.",
                        ],
                        [
                            "Managed backups",
                            "Encrypted copies",
                            "An encrypted vault copy in managed storage. Backup retrieval and vault recovery are separate mechanisms.",
                        ],
                        [
                            "Business operations",
                            "Service-related data",
                            "Payment, subscription, support and operational data are handled separately from encrypted vault contents.",
                        ],
                    ].map(([label, status, text]) => (
                        <div key={label}>
                            <h3>{label}</h3>
                            <strong>{status}</strong>
                            <p>{text}</p>
                        </div>
                    ))}
                </div>
                <Link className={s.textLink} href="/privacy">
                    Read the Privacy Policy
                </Link>
            </Section>
            <Section id="disclosure" number="04" label="RESPONSIBLE DISCLOSURE">
                <div className={s.twoColumns}>
                    <div>
                        <h2>
                            Found something?
                            <br />
                            Tell us privately.
                        </h2>
                        <p>
                            Send a summary, affected version, reproduction steps
                            and a minimal proof of concept using your own test
                            data. Please don’t publish vulnerabilities in GitHub
                            Issues.
                        </p>
                        <Action
                            href="mailto:security@cryptex-vault.com"
                            secondary
                        >
                            Email the security team
                        </Action>
                    </div>
                    <div className={s.disclosure}>
                        <h3>security@cryptex-vault.com</h3>
                        <p>
                            First response within 3 working days. The full
                            policy describes scope, safe harbor, coordinated
                            disclosure and recognition.
                        </p>
                        <Link href="/security/responsible-disclosure">
                            Full disclosure policy
                        </Link>
                        <a href={REPO}>Inspect the source code on GitHub</a>
                    </div>
                </div>
            </Section>
        </Site>
    );
}
