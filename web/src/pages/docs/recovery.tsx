import Link from "next/link";

import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function Recovery() {
    return (
        <DocArticle
            title="Recovery"
            description="Cryptex Vault has one recovery code for the encrypted vault and a separate Recovery Kit for Online Services. Keep the right material for each job."
            toc={[
                { href: "#difference", label: "Two recovery systems" },
                { href: "#vault", label: "Recover a vault" },
                { href: "#online", label: "Recover Online Services" },
                { href: "#fresh", label: "Recover on a fresh device" },
            ]}
            related={[
                { href: "/docs/backups", title: "Create and restore backups" },
                { href: "/docs/troubleshooting", title: "Troubleshooting" },
            ]}
        >
            <DocSection
                id="difference"
                title="Keep both if you use Online Services"
            >
                <h3>Vault recovery code</h3>
                <p>
                    After you select <strong>Create Vault</strong>, the
                    <strong> Save these secrets now</strong> dialog shows your
                    new vault's recovery code before you enter the vault. It is
                    shown once. It opens that encrypted vault when the master
                    password or additional key is unavailable. You can replace
                    it later in <strong>Vault Settings</strong> under{" "}
                    <strong>Encryption &amp; Security</strong>.
                </p>
                <DocScreenshot
                    src="/images/docs/vault-recovery-code.png"
                    width={896}
                    height={718}
                    alt="Web application Save these secrets now dialog with a vault recovery code and acknowledgement checkbox"
                    caption="After creating a vault in the web application, save the recovery code before choosing Continue."
                />
                <h3>Online Services Recovery Kit</h3>
                <p>
                    Contains the Online Services User ID and recovery phrase. It
                    is created when you register an Online Services account. You
                    can generate a replacement from the account's
                    <strong> Security</strong> tab. Save the replacement Kit;
                    the previous one will no longer work. It restores account
                    control and can retrieve available encrypted backups from
                    current{" "}
                    <Link href="/docs/online-services#devices">
                        root devices
                    </Link>
                    , the devices allowed to manage the account. It does not
                    decrypt those backups.
                </p>
                <DocScreenshot
                    src="/images/docs/online-recovery-kit.png"
                    width={1024}
                    height={1722}
                    alt="Web application Save your Recovery Kit dialog showing separate User ID and recovery phrase fields"
                    caption="The Online Services Recovery Kit contains both your User ID and recovery phrase. Save both together."
                />
                <DocCallout
                    title="Anyone with the recovery material can use it"
                    tone="warning"
                >
                    <p>
                        Store recovery codes and kits offline or in another
                        trusted system. Do not keep the only copy beside the
                        device or backup it is meant to recover.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="vault" title="Unlock with a vault recovery code">
                <DocSteps
                    items={[
                        <p key="unlock">
                            Open <Link href="/app">Cryptex Vault</Link>, choose
                            the <strong>Unlock</strong> tab, and select the
                            vault.
                        </p>,
                        <p key="recovery">
                            Choose <strong>Use recovery code</strong>.
                        </p>,
                        <p key="enter">
                            Enter the code saved for this vault, then choose{" "}
                            <strong>Unlock Vault</strong>.
                        </p>,
                        <p key="settings">
                            In the unlocked web vault, open{" "}
                            <strong>Vault Settings</strong> and choose{" "}
                            <strong>Manage Encryption &amp; Security</strong>.
                        </p>,
                        <p key="new-password">
                            Enter the same code under{" "}
                            <strong>
                                Recovery code to set a new master password
                            </strong>
                            . Enter and confirm your new master password, then
                            choose <strong>Save protection settings</strong>.
                        </p>,
                    ]}
                />
                <p>
                    Changing your master password this way does not replace the
                    vault recovery code. Keep it safe. If the code may have been
                    exposed, use your new master password to generate a new code
                    in <strong>Encryption &amp; Security</strong>, then save it
                    offline before closing the dialog. The old code will no
                    longer unlock this local vault, but older backups can still
                    accept the code that protected them when they were created.
                </p>
                <p>
                    Security settings also offer{" "}
                    <strong>Rotate this device's vault encryption key</strong>,
                    off by default. If you choose it while setting the new
                    password, the app re-encrypts this local vault and generates
                    a new recovery code. Save the new code before closing the
                    dialog. Rotation does not change the keys on linked devices.
                    See{" "}
                    <Link href="/docs/backups#security-changes">
                        backups after security changes
                    </Link>{" "}
                    for replacing older copies.
                </p>
            </DocSection>

            <DocSection id="online" title="Recover an Online Services account">
                <p>
                    If a usable vault is already open, choose{" "}
                    <strong>Sign up</strong> in the sidebar. In the Account
                    dialog, select <strong>Recover account</strong>. Enter the
                    User ID and Recovery Kit phrase, complete human
                    verification, and submit. Recovery binds the current vault
                    as a new Online Services device.
                </p>
                <p>
                    Successful account recovery uses up the Recovery Kit you
                    entered. The app then requests a new Kit and shows it when
                    ready. Save your User ID with the new phrase before relying
                    on recovery again. If no new Kit appears, open{" "}
                    <strong>Account</strong> and generate one from its{" "}
                    <strong>Security</strong> tab.
                </p>
                <p>
                    You can also replace a Kit from <strong>Account</strong>{" "}
                    &gt; <strong>Security</strong>. This invalidates all earlier
                    Kits and ends active backup recovery sessions. Replace your
                    stored copies with the new Kit.
                </p>
            </DocSection>

            <DocSection
                id="fresh"
                title="Recover from managed backup on a fresh device"
            >
                <DocSteps
                    items={[
                        <p key="restore">
                            Open the <strong>Restore</strong> tab and choose{" "}
                            <strong>
                                No file? Use Managed Backups (Online Services)
                            </strong>
                            .
                        </p>,
                        <p key="kit">
                            Enter the Online Services User ID and Recovery Kit
                            phrase, then complete human verification.
                        </p>,
                        <p key="find">
                            Choose <strong>Find Root Restore Points</strong>,
                            then select a restore point. The newest is marked
                            recommended.
                        </p>,
                        <p key="name">
                            Name the restored copy and choose{" "}
                            <strong>Restore Vault</strong>.
                        </p>,
                        <p key="unlock">
                            Unlock the restored vault with its vault master
                            password and any required protection phrase or
                            security key, or use its vault recovery code
                            instead.
                        </p>,
                        <p key="replacement-kit">
                            After the first unlock, save the replacement Online
                            Services Recovery Kit when prompted. Keep it in
                            place of the old one, then confirm that your
                            credentials are present.
                        </p>,
                    ]}
                />
                <p>
                    Finding an eligible root-device restore point uses up the
                    Recovery Kit you entered. If none is available, the Kit
                    remains valid. If the replacement does not appear after
                    unlocking the restored vault, try again on the next unlock
                    or generate one from <strong>Account</strong> &gt;{" "}
                    <strong>Security</strong>.
                </p>
                <DocCallout title="If every vault secret is gone">
                    <p>
                        An Online Services Recovery Kit can retrieve eligible
                        encrypted backups, but cannot decrypt them. If the vault
                        master password, vault recovery code, and required
                        additional key are all unavailable, Cryptex Industries
                        d.o.o. cannot restore the plaintext.
                    </p>
                </DocCallout>
                <DocScreenshot
                    src="/images/docs/managed-recovery.png"
                    width={764}
                    height={444}
                    alt="Online Services User ID and Recovery Kit phrase fields"
                    caption="Enter the User ID and phrase from your Online Services Recovery Kit, then complete the human verification below these fields. You still need the vault secrets to unlock the restored copy."
                />
            </DocSection>
        </DocArticle>
    );
}
