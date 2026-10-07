import Link from "next/link";

import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function GettingStarted() {
    return (
        <DocArticle
            title="Getting started"
            description="Create a local vault, save the one-time recovery information, and add your first login. You do not need an account for these steps."
            toc={[
                { href: "#create", label: "Create a vault" },
                { href: "#recovery", label: "Save the recovery code" },
                { href: "#first-login", label: "Add a login" },
                { href: "#find-logins", label: "Find saved logins" },
                { href: "#next", label: "Before you move in" },
            ]}
            related={[
                { href: "/docs/importing", title: "Import existing passwords" },
                {
                    href: "/docs/browser-extension",
                    title: "Set up browser autofill",
                },
            ]}
        >
            <DocSection id="create" title="Create the vault">
                <DocSteps
                    items={[
                        <p key="open">
                            Open <Link href="/app">Cryptex Vault</Link>. On a
                            new browser, the <strong>Create</strong> tab is
                            selected.
                        </p>,
                        <p key="name">
                            Give the vault a name. The description is optional.
                        </p>,
                        <p key="secret">
                            Enter a strong{" "}
                            <strong>Master password (secret key)</strong>, or
                            use the generator beside the field. Then select
                            additional key protection, if you want it.
                        </p>,
                        <p key="import">
                            Optionally, choose{" "}
                            <strong>Import existing passwords</strong> to bring
                            in logins from another password manager. Follow the{" "}
                            <Link href="/docs/importing">import guide</Link> to
                            export and select the right file. You can also
                            import later.
                        </p>,
                        <p key="create">
                            Select <strong>Create Vault</strong>.
                        </p>,
                    ]}
                />
                <DocCallout
                    title="Clearing website data deletes your local vault"
                    tone="warning"
                >
                    <p>
                        Your vault is stored in this browser. Clearing this
                        website&apos;s cookies and site data deletes the vault
                        from this browser, even if you still know the master
                        password. Keep an encrypted backup outside the browser
                        before clearing site data. Your recovery code alone
                        cannot restore deleted vault data. See the{" "}
                        <Link href="/docs/backups">backup guide</Link>.
                    </p>
                </DocCallout>
                <DocCallout title="What is the secret key?">
                    <p>
                        It is the master password you enter to unlock this local
                        vault. It stays on your device and is never sent to
                        Cryptex Industries d.o.o. We cannot reset it for you.
                    </p>
                </DocCallout>
                <p>
                    Additional key protection requires another secret alongside
                    your master password. It helps protect a stolen vault file
                    if someone learns or guesses that password.
                </p>
                <ul>
                    <li>
                        <strong>Password only</strong> is the simplest option.
                        There is no extra phrase or security key to keep, so
                        choose a strong, unique master password.
                    </li>
                    <li>
                        <strong>Generated protection phrase</strong> adds a
                        random secret. The 128-bit option is shorter; the
                        256-bit option offers a larger security margin with a
                        longer phrase to store. This device caches its derived
                        key for convenient unlocks, but you need the phrase
                        after restoring a backup or on a device without that
                        cached key.
                    </li>
                    <li>
                        <strong>Security key (WebAuthn PRF)</strong> uses a
                        compatible authenticator instead of a phrase. It depends
                        on security-key and browser support and stays bound to
                        the enrolled key and browser. Keep your recovery code in
                        case that key becomes unavailable.
                    </li>
                </ul>
                <p>
                    Keep the default <strong>Encryption Configuration</strong>{" "}
                    unless you understand the speed and password-guessing
                    tradeoff.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/create.png"
                    alt="Create tab with vault name, master password, and additional key protection"
                    caption="Start on the Create tab. The master password unlocks this local vault; additional key protection is optional."
                />
            </DocSection>

            <DocSection id="recovery" title="Stop and save the recovery code">
                <p>
                    After creation, the <strong>Save these secrets now</strong>{" "}
                    dialog shows your vault recovery code once. Write it on
                    paper or print it and keep it offline in a safe place,
                    separate from your device. Confirm that you have saved it
                    before continuing.
                </p>
                <p>
                    If you chose a protection phrase, save that too. If you
                    chose a WebAuthn security key, read the device warning
                    before you continue. The recovery code is the fallback when
                    that key is unavailable.
                </p>
                <DocCallout
                    title="Two different recovery secrets"
                    tone="warning"
                >
                    <p>
                        This vault recovery code can unlock the encrypted vault
                        without its master password. An Online Services Recovery
                        Kit is created separately and cannot decrypt a vault.
                        See the{" "}
                        <Link href="/docs/recovery"> recovery guide</Link>.
                    </p>
                </DocCallout>
                <DocCallout
                    title="Older backups keep their original protection"
                    tone="warning"
                >
                    <p>
                        Changing your master password or adding key protection
                        does not update backups you already made. Those copies
                        still use the password and protection in place when they
                        were created. Download and check a fresh backup after a
                        change, then remove older copies you no longer need,
                        including managed backups. The security settings can
                        replace and delete older managed restore points; see{" "}
                        <Link href="/docs/backups#security-changes">
                            backups after security changes
                        </Link>{" "}
                        before using that option.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="first-login" title="Add your first login">
                <p>
                    In the unlocked vault, choose the add credential action.
                    Fill in the site, username, and password, then select{" "}
                    <strong>Create Credential</strong>. Open the saved item once
                    and check its URL and username before relying on autofill.
                </p>
                <p>
                    To move more than a few logins, use the{" "}
                    <Link href="/docs/importing">import guide</Link> rather than
                    entering them one by one.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/credential.png"
                    alt="Saved Personal email credential with username, masked password, and website"
                    caption="Open a saved credential to check its username and website. Keep the password masked when sharing a screenshot."
                />
            </DocSection>

            <DocSection id="find-logins" title="Find saved logins">
                <p>
                    Use the search field above the credential list to narrow the
                    entries you see. You can also choose a directory to show
                    only its credentials.
                </p>
                <p>
                    Select the sort button beside the row count to cycle through
                    <strong> Name A-Z</strong>, <strong>Name Z-A</strong>,{" "}
                    <strong>Recently updated</strong>, and{" "}
                    <strong>Newest created</strong>. The web app remembers your
                    choice in this browser.
                </p>
            </DocSection>

            <DocSection
                id="next"
                title="Before you replace your old password manager"
            >
                <DocSteps
                    items={[
                        <p key="backup">
                            Open <strong>Backups</strong> in the sidebar. In the
                            Backup Center, choose{" "}
                            <strong>Download backup</strong> under{" "}
                            <strong>Local encrypted backup</strong> to save a{" "}
                            <code>.cryx</code> file. Keep it somewhere safe and
                            separate from your device so you have a copy if
                            local data is lost.
                        </p>,
                        <p key="unlock">
                            Lock the vault and confirm that your master password
                            unlocks it. This checks that you can get back in
                            before you start relying on it.
                        </p>,
                        <p key="check">
                            Open several important entries and check their URLs,
                            usernames, passwords, notes, and one-time codes. Try
                            a few logins to catch missing or incorrectly
                            imported details.
                        </p>,
                        <p key="keep">
                            Keep your old password manager unchanged until the
                            new vault works and you have tested restoring the
                            backup. That gives you a fallback while you check
                            the move.
                        </p>,
                    ]}
                />
            </DocSection>
        </DocArticle>
    );
}
