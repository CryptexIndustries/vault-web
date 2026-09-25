import Link from "next/link";

import { Label, Section, Site, s } from "@/components/marketing/site";
import p from "@/styles/Privacy.module.css";

export default function TermsOfService() {
    return (
        <Site
            title="Terms of service"
            description="Terms for Cryptex Vault and the optional paid Online Services."
        >
            <section className={s.pageHero}>
                <Label>TERMS</Label>
                <h1>Terms of service</h1>
                <p>
                    These terms cover Cryptex Vault and the optional Online
                    Services operated by Cryptex Industries d.o.o., Croatia.
                </p>
                <p>Last updated: 25 September 2026</p>
            </section>

            <Section
                className={p.content}
                id="product"
                number="01"
                label="THE PRODUCT"
            >
                <h2>Cryptex Vault and Online Services</h2>
                <p>
                    The application stores your vault on your device. You can
                    use it without an Online Services account, export your data,
                    create encrypted backups and configure your own
                    synchronization servers. The software licences supplied with
                    the application and its components remain applicable. These
                    terms do not replace them.
                </p>
                <p>
                    Online Services is an optional subscription for managed
                    signaling and STUN/TURN services and encrypted backup
                    storage. Devices must be online at the same time to
                    synchronize. Backup storage does not synchronize changes to
                    offline devices.
                </p>
            </Section>

            <Section
                className={p.content}
                id="account"
                number="02"
                label="YOUR ACCOUNT AND RECOVERY"
            >
                <h2>Account security and recovery</h2>
                <p>
                    Keep your recovery information safe and revoke Online
                    Services access for lost devices. Cryptex Industries d.o.o.
                    cannot decrypt your vault or replace missing vault
                    credentials.
                </p>
                <p>
                    An Online Services Recovery Kit lets you retrieve an
                    available encrypted backup. To decrypt it, you need either
                    the vault password with any applicable additional key
                    protection, or the vault recovery code valid for that
                    backup. See the{" "}
                    <Link href="/docs/recovery">recovery guide</Link>.
                </p>
                <p>
                    Do not interfere with the service, bypass access controls or
                    rate limits, access accounts or devices without permission,
                    or store or transmit material unlawfully. Security research
                    is covered by our{" "}
                    <Link href="/security/responsible-disclosure">
                        responsible disclosure policy
                    </Link>
                    .
                </p>
            </Section>

            <Section
                className={p.content}
                id="billing"
                number="03"
                label="SUBSCRIPTION AND BILLING"
            >
                <h2>Prices, renewal and cancellation</h2>
                <p>
                    See the <Link href="/pricing">pricing page</Link> for
                    monthly and annual subscription prices, including VAT.
                    Checkout shows the amount, currency and billing interval
                    before you pay. A subscription renews at that interval until
                    cancelled.
                </p>
                <p>
                    Price increases apply only from a future renewal, after
                    advance notice in the application. They do not change the
                    price of a billing period you have already paid for. You can
                    cancel renewal before the new price takes effect.
                </p>
                <p>
                    Link is the merchant of record through Stripe Managed
                    Payments. It handles payment support, receipts, invoices,
                    payment methods and transaction disputes. Purchases are
                    subject to <a href="https://link.com/terms">Link's terms</a>
                    . Cryptex Industries d.o.o. provides product support.
                </p>
                <p>
                    To cancel renewal, open <strong>Manage billing</strong> in
                    your Online Services account. Cancellation takes effect at
                    the end of your paid billing period. You retain the paid
                    service until then and will not be charged for another
                    period.
                </p>
            </Section>

            <Section
                className={p.content}
                id="refunds"
                number="04"
                label="REFUNDS AND CONSUMER RIGHTS"
            >
                <h2>Refunds and the cooling-off period</h2>
                <p>
                    Cancelling renewal does not itself refund the current
                    billing period. We do not offer voluntary refunds for
                    non-use or a change of mind beyond refunds available under
                    Link's terms or applicable law.
                </p>
                <p>
                    Under{" "}
                    <a href="https://link.com/terms#sold-through-link-terms">
                        Link's terms
                    </a>
                    , EU consumers can cancel their purchase within 14 days of
                    receiving access. To use this cooling-off right, contact{" "}
                    <a href="https://support.link.com/topics/sold-through-link">
                        Link support
                    </a>{" "}
                    and give "cooling off period" as the reason for your refund
                    request.
                </p>
                <p>
                    Follow{" "}
                    <a href="https://support.link.com/questions/requesting-a-refund-for-a-sold-through-link-payment">
                        Link's refund instructions
                    </a>
                    . Your statutory consumer rights remain unaffected,
                    including remedies if the service does not meet the
                    contract.
                </p>
            </Section>

            <Section
                className={p.content}
                id="backups"
                number="05"
                label="MANAGED BACKUPS"
            >
                <h2>Storage and retention</h2>
                <p>
                    Each account has 150 MB of backup storage, including pending
                    uploads. Each backup may be up to 10 MB. Uploads that would
                    exceed the allowance are rejected; older backups are not
                    deleted to make room.
                </p>
                <p>
                    Each completed backup is retained for its first 24 hours.
                    After that, we keep the newest backup per UTC day through 30
                    days, then the newest per calendar month through 366 days.
                    The newest backup from each current{" "}
                    <Link href="/docs/online-services#devices">
                        root device
                    </Link>{" "}
                    is protected from routine pruning.
                </p>
                <p>
                    When backup entitlement ends, uploads stop. For 90 days, you
                    can download or delete remaining backups, subject to normal
                    retention. After that, backups are queued for deletion.
                    Deleting your account skips this grace period and queues its
                    backups for deletion.
                </p>
                <p>
                    Keep a separate encrypted backup and the recovery
                    information needed to open it. The{" "}
                    <Link href="/docs/online-services#limits">
                        Online Services documentation
                    </Link>{" "}
                    explains upload limits and retention in detail.
                </p>
            </Section>

            <Section
                className={p.content}
                id="changes"
                number="06"
                label="SERVICE CHANGES AND AVAILABILITY"
            >
                <h2>Changes to the service or these terms</h2>
                <p>
                    We may update the application and Online Services to fix
                    faults, address security issues, meet legal requirements or
                    improve the service.
                </p>
                <p>
                    We will notify you in the application before material
                    changes take effect. This includes changes to subscription
                    prices, storage allowances, retention, paid features or
                    these terms. The notice will explain what is changing, when
                    it takes effect, and any cancellation or other rights that
                    apply.
                </p>
                <p>
                    Where the law requires a notice on a durable medium, we will
                    provide it in a form you can save and refer to later. Your
                    statutory rights to end the contract or obtain a refund for
                    qualifying changes remain unaffected.
                </p>
                <h3>Availability</h3>
                <p>
                    Maintenance, network problems and device or server failures
                    can interrupt Online Services. We do not guarantee
                    uninterrupted or error-free availability. This does not
                    exclude liability or remedies that cannot be excluded under
                    applicable law.
                </p>
                <h3>Suspension</h3>
                <p>
                    We may restrict Online Services access to address a security
                    threat, unlawful use, a breach of these terms or a legal
                    requirement. Where possible, we will explain the reason and
                    give notice before restricting access. Urgent security
                    issues or legal restrictions may prevent advance notice.
                </p>
                <p>
                    If you believe a restriction is mistaken, contact{" "}
                    <a href="mailto:support@cryptex-vault.com">
                        support@cryptex-vault.com
                    </a>{" "}
                    to ask us to review it. Do not send your vault password,
                    recovery codes or Recovery Kit.
                </p>
                <p>
                    A restriction may interrupt managed connections and backup
                    access. It does not remotely erase your local vault or
                    downloaded backups. The retention rules above and any
                    mandatory consumer remedies still apply, unless a legal
                    requirement prevents us from retaining or providing access
                    to particular data.
                </p>
            </Section>

            <Section
                className={p.content}
                id="contact"
                number="07"
                label="PRIVACY AND CONTACT"
            >
                <h2>Contact and privacy</h2>
                <p>
                    The <Link href="/privacy">Privacy policy</Link> explains how
                    we process data when you use the website and Online
                    Services.
                </p>
                <p>
                    For product support or legal notices, contact{" "}
                    <a href="mailto:support@cryptex-vault.com">
                        support@cryptex-vault.com
                    </a>
                    . Cryptex Industries d.o.o. is based in Croatia. Its
                    Croatian personal identification number, OIB, is
                    55912170784.
                </p>
            </Section>
        </Site>
    );
}
