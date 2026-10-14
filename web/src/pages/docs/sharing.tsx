import Link from "next/link";

import {
    DocArticle,
    DocCallout,
    DocScreenshot,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function Sharing() {
    return (
        <DocArticle
            title="One-time share links"
            description="Send a login or a secret to someone who doesn't use Cryptex Vault. The link opens once, then the server deletes what you sent."
            toc={[
                { href: "#share", label: "Share an item" },
                { href: "#android", label: "Share on Android" },
                { href: "#recipient", label: "What the recipient sees" },
                { href: "#manage", label: "Check and revoke links" },
                { href: "#server", label: "What the server sees" },
                { href: "#limits", label: "Limits" },
                { href: "#self-hosted", label: "Self-hosted servers" },
            ]}
            related={[
                { href: "/docs/online-services", title: "Online Services" },
                { href: "/docs/self-hosting", title: "Self-hosting" },
                { href: "/docs/cryptography", title: "Cryptography" },
            ]}
        >
            <DocSection id="share" title="Share an item">
                <DocSteps
                    items={[
                        <p key="open">
                            In the web app or the Chromium Extension, open the
                            item and choose <strong>Share once</strong>, the
                            link icon next to Edit.
                        </p>,
                        <p key="fields">
                            Pick the fields to include. Name, username, password
                            and website are on by default. Notes, custom fields
                            and the one-time code setup stay off until you turn
                            them on. Passkeys are never shared.
                        </p>,
                        <p key="expiry">
                            Choose how long the link waits to be opened: 1 hour,
                            1 day, 3 days or 7 days.
                        </p>,
                        <p key="create">
                            Choose <strong>Create link</strong> and copy it.
                            Cryptex Vault can&apos;t show the same link again.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/sharing-dialog.png"
                    alt="Share once dialog for an Office VPN login with name, username, password, website and the one-time code setup selected"
                    caption="Only the fields you select go into the link. Here the one-time code setup is turned on, so the recipient can add the account to their own authenticator."
                    width={1024}
                    height={900}
                />
                <DocScreenshot
                    src="/images/docs/sharing-link.png"
                    alt="Share once dialog showing the new link with a copy button"
                    caption="The key is the part of the link after the #. Copy the link now. The app doesn't keep it."
                    width={1024}
                    height={668}
                />
                <p>
                    To send something that isn&apos;t in your vault, such as a
                    Wi-Fi password or an API key, open{" "}
                    <strong>Shared Links</strong> and choose{" "}
                    <strong>Share a secret</strong>.
                </p>
                <DocCallout title="Add a passphrase for anything sensitive">
                    Turn on <strong>Require a passphrase</strong> and send the
                    passphrase another way, for example by phone. Someone who
                    intercepts only the link can&apos;t open it. Five wrong
                    passphrases destroy the link.
                </DocCallout>
            </DocSection>

            <DocSection id="android" title="Share on Android">
                <p>
                    Open the item and tap the link icon at the top, next to
                    Edit. The three-dot menu next to it also has{" "}
                    <strong>Share once</strong>. From the vault list, press and
                    hold an item to select it, then choose{" "}
                    <strong>Share</strong> in the selection bar.
                </p>
                <p>
                    Pick the fields with the switches, choose when the link
                    expires, and tap <strong>Create link</strong>.{" "}
                    <strong>Send link</strong> opens the Android share sheet, so
                    you can pass the link straight to a chat or mail app.
                </p>
                <DocScreenshot
                    src="/images/docs/sharing-android.png"
                    alt="Android Share once screen with switches for name, username, password, website and one-time code setup, expiry choices and Create link"
                    caption="The same choices on Android. Share a secret lives under More, Shared links, behind the + in the header."
                    width={720}
                    height={1460}
                />
            </DocSection>

            <DocSection id="recipient" title="What the recipient sees">
                <p>
                    The recipient opens the link in any browser. Until they
                    choose <strong>Reveal secret</strong>, the page only checks
                    that the link still exists. Chat apps and mail scanners that
                    preview links don&apos;t use it up.
                </p>
                <DocScreenshot
                    src="/images/docs/sharing-reveal.png"
                    alt="Shared secret page with a Reveal secret button and the expiry date"
                    caption="Before the reveal, the page only checks that the link still exists."
                    width={2880}
                    height={700}
                />
                <p>
                    After the reveal, the page shows each field with a copy
                    button and removes the key from the address bar. If you
                    included the one-time code setup, the page shows the current
                    code and a QR code they can add to their own authenticator
                    app. Opening the link again shows that it no longer works.
                </p>
                <DocScreenshot
                    src="/images/docs/sharing-recipient.png"
                    alt="Revealed shared login with username, hidden password, live one-time code, setup QR code and website"
                    caption="The revealed login. The server deleted the contents at the moment of the reveal."
                />
                <DocCallout title="A shared one-time code setup keeps working">
                    The recipient gets the TOTP secret itself, not a single
                    code. If you only want them to sign in once, rotate the
                    secret afterwards.
                </DocCallout>
            </DocSection>

            <DocSection id="manage" title="Check and revoke links">
                <p>
                    <strong>Shared Links</strong> lists the links you created.
                    It sits in the web app&apos;s sidebar, in the
                    extension&apos;s vault actions menu, and under{" "}
                    <strong>More</strong> on Android. A link stays{" "}
                    <strong>Active</strong> until someone opens it, it expires,
                    you revoke it, or five wrong passphrases destroy it. You can
                    search by name or server, filter by one or more statuses,
                    and sort by date, deadline or name. The list syncs to your
                    linked devices.
                </p>
                <DocScreenshot
                    src="/images/docs/sharing-list.png"
                    alt="Shared links list with a revoked API key, an active Wi-Fi password, and two opened logins"
                    caption="Opened links show when the recipient revealed them. The filter and sort buttons sit next to search."
                />
                <p>
                    Each link has a three-dot menu. On Android, tapping the row
                    opens it too. <strong>Revoke link</strong> stops a link that
                    hasn&apos;t been opened yet and deletes its contents from
                    the server, after you confirm. <strong>Open item</strong>{" "}
                    jumps to the vault item it came from.{" "}
                    <strong>Remove from list</strong> only changes your list. If
                    the link is still active, it revokes it first. Finished
                    links leave the list on their own after about 90 days.
                </p>
            </DocSection>

            <DocSection id="server" title="What the server sees">
                <p>
                    Your device encrypts the contents with AES-256-GCM before
                    anything is uploaded. The key is part of the link after the{" "}
                    <code>#</code>, and browsers never send that part to a
                    server. The server stores:
                </p>
                <ul>
                    <li>
                        the encrypted contents, until the link is opened,
                        revoked or expires
                    </li>
                    <li>
                        hashes of the tokens that let someone open, check or
                        revoke the link
                    </li>
                    <li>
                        when the link was created, when it expires, and when it
                        was opened
                    </li>
                    <li>
                        a pseudonym for your account, or for the creation token
                        on a self-hosted server, so it can count your open links
                    </li>
                </ul>
                <p>
                    On the Cryptex Vault server the pseudonym is a keyed hash of
                    your account, so the share server never receives your
                    account ID or email address. It also doesn&apos;t store who
                    you sent the link to, which item it came from, or its label.
                    Those stay in your vault. The server keeps client IP
                    addresses in memory for rate limiting and doesn&apos;t log
                    them. The{" "}
                    <Link href="/docs/cryptography#share-links">
                        cryptography guide
                    </Link>{" "}
                    explains how the key and tokens are derived.
                </p>
            </DocSection>

            <DocSection id="limits" title="Limits">
                <p>
                    Share links on the Cryptex Vault server are part of{" "}
                    <Link href="/docs/online-services">Online Services</Link>.
                    Each account can have 200 unopened links at a time. A link
                    can hold up to 64 KB and wait up to 7 days. The server
                    forgets a finished link 30 days after it ends. Your list
                    keeps it for about 90.
                </p>
            </DocSection>

            <DocSection id="self-hosted" title="Use a self-hosted share server">
                <p>
                    The share server is open source and ships with the{" "}
                    <Link href="/docs/self-hosting#share-server">
                        self-hosting stack
                    </Link>
                    . Its operator hands out creation tokens. Links then point
                    at that server&apos;s domain and keep working whatever
                    happens to the Cryptex Vault service.
                </p>
                <p>
                    In the Chromium Extension and on Android, open{" "}
                    <strong>Shared Links</strong>, choose the server icon, and
                    enter the server address and your creation token. A
                    self-hosted web app always uses its own server, so it only
                    asks for the token.
                </p>
            </DocSection>
        </DocArticle>
    );
}
