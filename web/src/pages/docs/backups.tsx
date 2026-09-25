import Link from "next/link";

import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function Backups() {
    return (
        <DocArticle
            title="Backups"
            description="Save an encrypted backup in a separate, secure location, restore it as a new vault, or keep managed restore points with Online Services."
            toc={[
                { href: "#manual", label: "Download a backup" },
                { href: "#restore", label: "Restore a file" },
                { href: "#managed", label: "Managed backups" },
                { href: "#security-changes", label: "After security changes" },
                { href: "#test", label: "Test recovery" },
            ]}
            related={[
                { href: "/docs/recovery", title: "Recovery secrets explained" },
                { href: "/docs/online-services", title: "Online Services" },
            ]}
        >
            <DocSection id="manual" title="Download an encrypted backup">
                <DocSteps
                    items={[
                        <p key="unlock">
                            Unlock the web vault and open{" "}
                            <strong>Backup Center</strong> from the sidebar.
                        </p>,
                        <p key="download">
                            Under <strong>Local encrypted backup</strong>,
                            choose <strong>Download backup</strong>.
                        </p>,
                        <p key="store">
                            Move the downloaded <code>.cryx</code> file to a
                            separate, secure location.
                        </p>,
                    ]}
                />
                <p>
                    The file remains encrypted with the vault's protection. To
                    unlock it, use either the vault recovery code, or the vault
                    master password together with any required protection phrase
                    or security key. A browser download receipt does not prove
                    the file still exists, so check your storage yourself.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/backup.png"
                    alt="Backup Center with Download backup and active managed restore points"
                    caption="Download backup creates a local encrypted file. Managed restore points are a separate, optional Online Services feature."
                />
            </DocSection>

            <DocSection id="restore" title="Restore a backup file">
                <DocSteps
                    items={[
                        <p key="tab">
                            Open <Link href="/app">Cryptex Vault</Link> and
                            select the <strong>Restore</strong> tab.
                        </p>,
                        <p key="file">
                            Drop the <code>.cryx</code> file in the file area,
                            or choose it from the device.
                        </p>,
                        <p key="name">
                            Give the restored copy a vault name and choose{" "}
                            <strong>Restore Vault</strong>.
                        </p>,
                        <p key="unlock">
                            Go to <strong>Unlock</strong>, select the restored
                            vault, and unlock it with the original vault secret.
                        </p>,
                    ]}
                />
                <p>
                    Restore creates a separate local vault and does not
                    overwrite an existing one. This makes it safe to test a
                    backup before you depend on it.
                </p>
                <DocScreenshot
                    src="/images/docs/restore.png"
                    alt="Restore tab with an encrypted file drop area and managed backup recovery option"
                    caption="Choose a .cryx file to restore a local backup. The separate Managed Backups action retrieves eligible online restore points."
                />
            </DocSection>

            <DocSection id="managed" title="Use managed restore points">
                <p>
                    Managed encrypted backups are an optional{" "}
                    <Link href="/pricing">Online Services</Link> feature. Create
                    the Online Services account and save its Recovery Kit first.
                    In <strong>Backup Center</strong>, enable managed backups
                    and confirm the prompt. The first upload starts immediately;
                    later automatic backups run while the web vault is open and
                    unlocked. Use <strong>Backup Now</strong> when you want a
                    restore point immediately.
                </p>
                <p>
                    You can pause uploads without deleting existing history, or
                    download a retained restore point as an encrypted file.
                    Creating or rotating the Recovery Kit and some backup
                    controls require a{" "}
                    <Link href="/docs/online-services#devices">
                        root device
                    </Link>
                    , a device with permission to manage your Online Services
                    account.
                </p>
                <DocCallout
                    title="You still need your vault secrets to open a backup"
                    tone="warning"
                >
                    <p>
                        We store your backup encrypted and cannot read its
                        contents or unlock it for you. To open a restored
                        backup, use its master password and any additional key
                        protection, or its vault recovery code. Your Online
                        Services Recovery Kit lets you retrieve eligible
                        backups, but does not decrypt them. Keep these secrets
                        somewhere safe; see the{" "}
                        <Link href="/docs/recovery">recovery guide</Link> for
                        what to save.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection
                id="security-changes"
                title="Backups after security changes"
            >
                <p>
                    Changing your master password, additional key protection,
                    recovery code, or local encryption key does not update
                    existing backups. Each older copy still uses the secrets
                    that protected it when it was created. Download and test a
                    fresh backup after changing these settings.
                </p>
                <p>
                    When managed backups are enabled, saving a security change
                    queues a replacement backup immediately. An upload failure
                    does not undo your local security change. Keep the app open
                    and check that the replacement finishes.
                </p>
                <DocCallout
                    title="Deleting older managed backups"
                    tone="warning"
                >
                    <p>
                        The security settings offer{" "}
                        <strong>
                            Delete older managed backups after replacement
                        </strong>
                        , off by default. This deletes all older restore points
                        for the account, including linked-device snapshots, only
                        after the replacement upload succeeds. It is not limited
                        to the vault you are changing.
                    </p>
                </DocCallout>
                <p>
                    Closing the app can interrupt the upload or cleanup. Check
                    the result after reopening it; do not assume the old copies
                    are gone. Downloaded <code>.cryx</code> files cannot be
                    revoked or deleted remotely. Remove those copies yourself
                    when you no longer need them.
                </p>
            </DocSection>

            <DocSection id="test" title="Test before you need it">
                <p>
                    Restore the newest backup as a separate vault, unlock it,
                    and inspect several recent entries. Keep the original until
                    that test is complete. After material changes or a large
                    import, download another backup rather than assuming an
                    older copy is current.
                </p>
            </DocSection>
        </DocArticle>
    );
}
