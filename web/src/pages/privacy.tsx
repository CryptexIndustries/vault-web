import Link from "next/link";
import { Label, Section, Site, s } from "@/components/marketing/site";
import t from "@/styles/TechnicalDocs.module.css";
import p from "@/styles/Privacy.module.css";

export default function PrivacyPolicy() {
    return (
        <Site
            title="Privacy policy"
            description="How Cryptex Industries d.o.o. uses personal data, how long it keeps it, and how to exercise your privacy rights."
        >
            <section className={s.pageHero}>
                <Label>PRIVACY</Label>
                <h1>Privacy policy</h1>
                <p>
                    How we use personal data when you visit our website or use
                    Cryptex Vault and Online Services.
                </p>
                <p>Last updated: 25 September 2026</p>
            </section>

            <Section
                className={p.content}
                id="controller"
                number="01"
                label="WHO IS RESPONSIBLE"
            >
                <h2>Cryptex Industries d.o.o.</h2>
                <p>
                    Cryptex Industries d.o.o., Croatia, operates Cryptex Vault
                    and Online Services and is the controller for the personal
                    data we process to run them. Our Croatian personal
                    identification number, OIB, is 55912170784. For privacy
                    questions, contact{" "}
                    <a href="mailto:privacy@cryptex-vault.com">
                        privacy@cryptex-vault.com
                    </a>
                    .
                </p>
            </Section>

            <Section
                className={p.content}
                id="vault"
                number="02"
                label="YOUR VAULT"
            >
                <h2>Your vault is encrypted on your device.</h2>
                <p>
                    You can use the local vault without Online Services.
                    Encryption and decryption happen on your device. Device
                    synchronization is end-to-end encrypted, and managed backups
                    are encrypted before upload. Online Services does not
                    receive your plaintext vault contents, master password,
                    vault recovery code, or the keys needed to decrypt your
                    vault.
                </p>
                <p>
                    Loading the hosted application still sends network requests
                    to our servers. For details about local storage, transmitted
                    metadata, and diagnostic logs, read{" "}
                    <Link href="/docs/privacy-and-metadata">
                        Privacy and metadata
                    </Link>
                    .
                </p>
            </Section>

            <Section
                className={p.content}
                id="processing"
                number="03"
                label="DATA AND PURPOSES"
            >
                <h2>What we receive and why</h2>
                <div
                    className={t.tableWrap}
                    role="region"
                    aria-label="Personal data and purposes"
                    tabIndex={0}
                >
                    <table className={t.table}>
                        <thead>
                            <tr>
                                <th scope="col">Activity</th>
                                <th scope="col">Data received</th>
                                <th scope="col">Purpose</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                [
                                    "Website requests and security",
                                    "IP addresses, request details, timestamps, outcomes, and security diagnostics.",
                                    "Deliver the website, investigate failures, and prevent abuse.",
                                ],
                                [
                                    "Managed device connections",
                                    "Device and connection identifiers, network addresses, connection timing, and traffic volume. Relays carry encrypted traffic.",
                                    "Connect your devices and relay their encrypted synchronization when needed.",
                                ],
                                [
                                    "Managed backups",
                                    "Encrypted backup files, their sizes, identifiers, source devices, and upload or deletion timestamps and status.",
                                    "Store and retrieve your backups, enforce storage limits, and apply retention and deletion rules.",
                                ],
                                [
                                    "Subscriptions",
                                    "Payment-provider identifiers, subscription dates, payment status, and cancellation status.",
                                    "Activate and manage access to paid Online Services.",
                                ],
                            ].map(([activity, data, purpose]) => (
                                <tr key={activity}>
                                    <td>{activity}</td>
                                    <td>{data}</td>
                                    <td>{purpose}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <h3>Legal bases</h3>
                <p>
                    We process data necessary to provide the Online Services you
                    request to perform our contract with you, under GDPR Article
                    6(1)(b). This includes managed connections, backups, and
                    subscription access. Without the data needed for a feature,
                    we cannot provide that feature; local vault use remains
                    available.
                </p>
                <p>
                    We rely on legitimate interests under Article 6(1)(f) to
                    deliver and protect the hosted website, diagnose failures,
                    and prevent abuse. Our interests are keeping the service
                    available and protecting users and infrastructure. This
                    processing must be necessary and proportionate, taking your
                    rights into account.
                </p>
            </Section>

            <Section
                className={p.content}
                id="recipients"
                number="04"
                label="RECIPIENTS AND LOCATIONS"
            >
                <h2>Hosting, security, and payments</h2>
                <p>
                    Our production infrastructure, connection servers, and
                    managed encrypted backup storage are hosted in Europe. We
                    use hosting and storage providers to operate these services.
                    If you self-host or configure your own connection servers,
                    the providers and settings you choose apply to those
                    servers.
                </p>
                <p>
                    We use Cloudflare to proxy website traffic and run Turnstile
                    bot checks. These services receive network, browser, and
                    request information. We use Cloudflare's HTTP Traffic
                    analytics to monitor requests and bandwidth handled by its
                    servers. Cloudflare Web Analytics and RUM are not enabled;
                    we do not load their browser analytics script. See{" "}
                    <a href="https://www.cloudflare.com/privacypolicy/">
                        Cloudflare&apos;s privacy policy
                    </a>
                    .
                </p>
                <p>
                    Stripe Managed Payments uses Link as the merchant of record.
                    Stripe and Link collect the contact, billing, and payment
                    details you enter at checkout. We receive the identifiers
                    and status information needed to manage your subscription,
                    not your full card number or security code. See{" "}
                    <a href="https://stripe.com/privacy">
                        Stripe&apos;s privacy policy
                    </a>
                    .
                </p>
                <p>
                    Cloudflare and Stripe may process data outside the European
                    Economic Area, including in the United States. Their
                    transfer arrangements use the EU-US Data Privacy Framework
                    where applicable and EU Standard Contractual Clauses for
                    transfers that require those safeguards. The terms are
                    available in{" "}
                    <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">
                        Cloudflare&apos;s Data Processing Addendum
                    </a>{" "}
                    and{" "}
                    <a href="https://stripe.com/legal/dpa">
                        Stripe&apos;s Data Processing Agreement
                    </a>
                    , including its{" "}
                    <a href="https://stripe.com/legal/dta">
                        Data Transfers Addendum
                    </a>
                    .
                </p>
                <p>
                    We may also disclose information to competent authorities
                    when applicable law requires it.
                </p>
            </Section>

            <Section
                className={p.content}
                id="retention"
                number="05"
                label="RETENTION AND DELETION"
            >
                <h2>How long we keep data</h2>
                <p>
                    Deleting your Online Services account removes its account,
                    device, subscription, and payment-event records from our
                    active database. Copies can remain in database backups until
                    those backups expire, within seven days. These database
                    backups are separate from your encrypted vault backups.
                </p>
                <p>
                    We retain operational and security logs for 30 days. This
                    period applies to our logs, not logs held independently by
                    third parties or on self-hosted servers.
                </p>
                <p>
                    Managed backups are pruned over time, with the latest backup
                    from each current root device protected from routine
                    pruning. The full schedule and the 90-day access period
                    after backup entitlement ends are described in the{" "}
                    <Link href="/docs/online-services#limits">
                        backup retention rules
                    </Link>
                    .
                </p>
                <p>
                    Deleting your Online Services account queues its managed
                    backups for deletion without the 90-day grace period. It
                    does not erase local vaults or downloaded files. See{" "}
                    <Link href="/docs/privacy-and-metadata#control">
                        deletion and your controls
                    </Link>
                    .
                </p>
            </Section>

            <Section
                className={p.content}
                id="rights"
                number="06"
                label="YOUR RIGHTS"
            >
                <h2>Account controls and privacy questions</h2>
                <p>
                    Applicable GDPR rights include access, correction, deletion,
                    restriction, objection, and portability, subject to their
                    legal conditions.
                </p>
                <p>
                    Online Services accounts are not linked to email addresses.
                    We cannot identify your account or verify ownership from an
                    email request. An email address does not authorize access to
                    account data or account deletion.
                </p>
                <p>
                    Use the authenticated controls in the application to manage
                    your Online Services account and delete it from an
                    authorized root device. There is currently no feature to
                    download a package of Online Services account information.
                    Encrypted vault backups are separate from account
                    information.
                </p>
                <p>
                    For general privacy questions, contact{" "}
                    <a href="mailto:privacy@cryptex-vault.com">
                        privacy@cryptex-vault.com
                    </a>
                    . This mailbox is not an account-verification or
                    account-recovery channel. Do not send your master password,
                    recovery secrets, or plaintext vault contents.
                </p>
                <p>
                    Your GDPR rights include lodging a complaint with a
                    competent supervisory authority, such as Croatia&apos;s{" "}
                    <a href="https://azop.hr/data-subject-rights/">
                        Personal Data Protection Agency, AZOP
                    </a>
                    .
                </p>
            </Section>
        </Site>
    );
}
