import Link from "next/link";

import { BROWSER_EXTENSION } from "@/components/marketing/site";
import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function BrowserExtension() {
    return (
        <DocArticle
            title="Chromium Extension & autofill"
            description="Install the Chromium Extension, link it to an existing vault, and use the inline picker on a login page."
            toc={[
                { href: "#install", label: "Install" },
                { href: "#link", label: "Link the vault" },
                { href: "#autofill", label: "Autofill" },
                {
                    href: "#security-settings",
                    label: "Vault security settings",
                },
                { href: "#boundaries", label: "Security boundaries" },
            ]}
            related={[
                {
                    href: "/docs/linking-devices",
                    title: "Link another device",
                },
                {
                    href: "/docs/synchronization",
                    title: "How synchronization works",
                },
                {
                    href: "/docs/troubleshooting",
                    title: "Troubleshoot the extension",
                },
            ]}
        >
            <DocSection id="install" title="Install the Chromium Extension">
                <p>
                    The Chromium Extension is designed for desktop Chrome,
                    Microsoft Edge, and Brave. Install it from the Chrome Web
                    Store. Firefox support is planned and is not available yet.
                </p>
                <DocSteps
                    items={[
                        <p key="store">
                            Open the{" "}
                            <a href={BROWSER_EXTENSION}>
                                official Chrome Web Store listing
                            </a>{" "}
                            and follow your browser&apos;s installation prompt.
                            In Chrome, choose <strong>Add to Chrome</strong>.
                            Edge may ask you to allow extensions from other
                            stores.
                        </p>,
                        <p key="pin">
                            Pin Cryptex Vault to the toolbar so it is easier to
                            open and use.
                        </p>,
                        <p key="open">
                            Open the extension. A new installation shows{" "}
                            <strong>No vault on this device</strong>.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/extension-invitation.png"
                    width={768}
                    height={404}
                    alt="Empty extension vault with the Use invitation button"
                    caption="Use invitation opens the extension's receiving screen in a new tab."
                />
                <DocCallout title="Firefox support is planned">
                    <p>
                        The Firefox extension has not been released yet. See the{" "}
                        <Link href="/roadmap">roadmap</Link> for planned browser
                        support.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="link" title="Link the extension to your vault">
                <p>
                    Link the extension to your existing vault to synchronize
                    your passwords between them. Each keeps its own local vault.
                </p>
                <p>
                    Follow the{" "}
                    <Link href="/docs/linking-devices?receiver=extension#receive">
                        Chromium Extension linking instructions
                    </Link>
                    , then return here to set up autofill. The linking guide
                    covers connection requirements and creating an invitation
                    too.
                </p>
            </DocSection>

            <DocSection id="autofill" title="Fill a login">
                <DocSteps
                    items={[
                        <p key="unlock">
                            Open the toolbar popup and unlock the extension
                            vault with its passphrase.
                        </p>,
                        <p key="site">
                            Open a saved site and focus its username or password
                            field.
                        </p>,
                        <p key="picker">
                            Choose the Cryptex Vault icon in the field, then
                            select the matching credential.
                        </p>,
                        <p key="submit">
                            Check the selected account and submit the site’s
                            form yourself.
                        </p>,
                    ]}
                />
                <p>
                    When you submit a new login, Cryptex Vault may ask whether
                    to save it. Review the captured site and username before
                    choosing
                    <strong> Save</strong>. If no picker appears, open the popup
                    to confirm that the vault is unlocked and the saved URL
                    matches the site.
                </p>
                <DocScreenshot
                    src="/images/docs/autofill.png"
                    alt="Cryptex Vault inline picker showing matching credentials below a login field"
                    caption="The actual extension picker on a demonstration login page. Click the vault icon inside the field, then choose the matching credential."
                />
                <DocScreenshot
                    src="/images/walkthrough/extension.png"
                    alt="Unlocked Chromium Extension showing a synced credential and Connected status"
                    caption="The linked extension holds the same credential locally. Check its saved website if the inline picker does not offer the expected login."
                    width={1440}
                />
            </DocSection>

            <DocSection
                id="security-settings"
                title="Change this vault's protection"
            >
                <p>
                    In the unlocked extension, open the menu and choose{" "}
                    <strong>Vault Settings</strong>, labeled{" "}
                    <strong>Encryption &amp; Security</strong>. You can change
                    the master password or protection phrase and generate a new
                    recovery code. Save any newly displayed secrets before
                    closing the dialog.
                </p>
                <p>
                    Optional encryption-key rotation re-encrypts this device's
                    vault and generates a new recovery code. It does not rotate
                    keys on your other devices. Older backups keep their
                    original protection; read{" "}
                    <Link href="/docs/backups#security-changes">
                        the backup guidance
                    </Link>{" "}
                    before deleting old restore points.
                </p>
            </DocSection>

            <DocSection id="boundaries" title="What the extension can see">
                <p>
                    While unlocked, the extension can use credentials for sites
                    you visit so it can fill them. Treat other installed browser
                    extensions and the browser profile itself as part of your
                    security boundary. Lock Cryptex Vault when you are finished
                    on a shared machine.
                </p>
                <p>
                    The extension locks after 30 minutes of system idle. Closing
                    its popup does not lock it immediately. Open the three-dot
                    <strong> Vault actions</strong> menu and choose{" "}
                    <strong>Lock vault</strong> when you need an immediate lock.
                </p>
                <DocScreenshot
                    src="/images/docs/extension-lock.png"
                    width={600}
                    height={480}
                    alt="Chromium Extension Vault actions menu with Lock vault visible"
                    caption="Choose Lock vault from the three-dot menu to clear the unlocked session."
                />
            </DocSection>
        </DocArticle>
    );
}
