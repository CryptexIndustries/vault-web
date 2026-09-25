import Link from "next/link";
import {
    Site,
    Label,
    Section,
    Plans,
    FinalCTA,
    s,
} from "@/components/marketing/site";
export default function Pricing() {
    return (
        <Site
            title="Pricing"
            description="Cryptex Vault is free forever. Optional Online Services include managed P2P infrastructure, encrypted backups, and device management."
        >
            <section className={s.pageHero}>
                <Label>PRICING / A SIMPLE CHOICE</Label>
                <h1>
                    Your vault is free.
                    <br />
                    <em>The extra help is optional.</em>
                </h1>
                <p>
                    Use Cryptex Vault on your own. Subscribe when you want us
                    <br />
                    to run the supporting infrastructure and store encrypted
                    backups.
                </p>
            </section>
            <Section number="01" label="CHOOSE HOW YOU RUN IT">
                <Plans detailed />
            </Section>
            <Section number="02" label="WHAT YOU’RE PAYING FOR">
                <div className={s.twoColumns}>
                    <article>
                        <h2>
                            Infrastructure.
                            <br />
                            Storage. Continued work.
                        </h2>
                        <p>
                            Online Services fund managed infrastructure, backup
                            storage, security work and continued development.
                            Local use, autofill, imports, exports and manual
                            encrypted backups remain free.
                        </p>
                    </article>
                    <article>
                        <h3>Managed sync is still peer-to-peer.</h3>
                        <p>
                            Cryptex Industries d.o.o. operates the signaling and
                            relay infrastructure that helps devices connect.
                            Both vaults must be open, unlocked, and reachable.
                            New links sync after connecting by default, and you
                            can change that setting. There is no central vault
                            serving changes to an offline device.
                        </p>
                        <h3>Backups are a separate service.</h3>
                        <p>
                            Managed backups keep an encrypted copy so you can
                            retrieve it if your devices are lost. Your Online
                            Services Recovery Kit contains the User ID and
                            phrase needed to find available backups from your
                            root devices. Your vault password or vault recovery
                            code unlocks the restored copy.
                        </p>
                    </article>
                </div>
            </Section>
            <Section
                id="service-terms"
                number="03"
                label="SERVICE TERMS AT A GLANCE"
            >
                <div className={s.sectionHeading}>
                    <h2>
                        Know the limits.
                        <br />
                        Keep a way out.
                    </h2>
                    <p>
                        Managed backups are an extra copy of your vault. We
                        recommend keeping a separate manual backup as well.
                    </p>
                </div>
                <dl className={s.serviceTerms}>
                    <div>
                        <dt>Price &amp; refunds</dt>
                        <dd>
                            We recommend starting with monthly billing. We do
                            not offer voluntary subscription refunds; your
                            statutory consumer rights are unaffected. For
                            purchases through Stripe Managed Payments,
                            Stripe/Link may also issue refunds under its own
                            terms.
                        </dd>
                    </div>
                    <div>
                        <dt>Backup storage</dt>
                        <dd>
                            150 MB total per account, including pending uploads.
                            Each backup is limited to 10 MB and must fit within
                            your remaining account allowance. There is no
                            separate fixed backup-count limit: the number you
                            can keep depends on backup sizes and retention.
                        </dd>
                    </div>
                    <div>
                        <dt>Room for your backups</dt>
                        <dd>
                            For context, a vault with around 340 items can be
                            about 100 KB, though sizes vary with the contents.
                            That leaves room for many backup versions within 150
                            MB. If you run out of space, download any copies you
                            want to keep, then delete unneeded backups to resume
                            uploads. We do not delete older backups just to make
                            an upload fit. We are open to expanding storage
                            through future plan tiers as needs grow.
                        </dd>
                    </div>
                    <div>
                        <dt>Version history</dt>
                        <dd>
                            Every snapshot is kept for 24 hours. After that,
                            retention keeps the newest snapshot per UTC day
                            through 30 days, then the newest per calendar month
                            through 366 days. The latest backup from each
                            current root device is protected from routine
                            retention pruning.
                        </dd>
                    </div>
                    <div>
                        <dt>Managing cancellation</dt>
                        <dd>
                            Manage your subscription through Stripe’s billing
                            portal, accessible from the app. Cancellation takes
                            effect at the end of the current paid period.
                        </dd>
                    </div>
                    <div>
                        <dt>After subscription access ends</dt>
                        <dd>
                            New uploads stop. For 90 days, you can download or
                            delete remaining backups, subject to normal
                            retention pruning. After that, backup access ends
                            and backups are queued for deletion.
                        </dd>
                    </div>
                    <div>
                        <dt>Deleting your account</dt>
                        <dd>
                            Hosted backups are queued for deletion without the
                            90-day grace period. Download any backups you want
                            to keep before deleting your account.
                        </dd>
                    </div>
                </dl>
            </Section>
            <Section number="04" label="BEFORE YOU SUBSCRIBE">
                <div className={s.faqLayout}>
                    <h2>
                        Know what
                        <br />
                        you’re choosing.
                    </h2>
                    <div className={s.faq}>
                        <details>
                            <summary>
                                Can I use my own infrastructure?<span>+</span>
                            </summary>
                            <p>
                                Yes. Run the signaling, STUN and TURN
                                infrastructure yourself. The synchronization
                                model is unchanged: sync can start automatically
                                after connecting or manually, and it remains
                                end-to-end encrypted. Both vaults must be open
                                and unlocked.
                            </p>
                        </details>
                        <details>
                            <summary>
                                Does a subscription unlock more vault features?
                                <span>+</span>
                            </summary>
                            <p>
                                The subscription currently covers managed P2P
                                infrastructure, managed encrypted backups, and
                                Online Services device management. You can
                                manage registered devices, view and control
                                their linking relationships, and revoke their
                                access to Online Services.
                            </p>
                        </details>
                        <details>
                            <summary>
                                Are there upload limits?<span>+</span>
                            </summary>
                            <p>
                                Your account includes 150 MB of backup storage,
                                with a maximum of 10 MB per backup. You can
                                start up to 120 uploads per day, resetting at
                                midnight UTC, with up to 5 in progress at once.
                                Uploads in progress count toward your storage
                                allowance.
                            </p>
                        </details>
                        <details>
                            <summary>
                                Are all my backups kept for a year?
                                <span>+</span>
                            </summary>
                            <p>
                                No. We keep every backup for 24 hours, then the
                                newest from each day for 30 days. Beyond that,
                                only the newest backup from each calendar month
                                is kept, until it is 366 days old. The latest
                                backup from each current root device is exempt
                                from this cleanup. Cancellation and account
                                deletion follow the access periods above.
                            </p>
                        </details>
                        <details>
                            <summary>
                                Where can I review security and recovery?
                                <span>+</span>
                            </summary>
                            <p>
                                Visit the{" "}
                                <Link href="/security">Security page</Link> for
                                audit status, threat boundaries and
                                infrastructure visibility. The{" "}
                                <Link href="/docs/recovery">
                                    recovery guide
                                </Link>{" "}
                                explains how to restore your vault and use your
                                recovery information.
                            </p>
                        </details>
                    </div>
                </div>
            </Section>
            <FinalCTA />
        </Site>
    );
}
