import Link from "next/link";

import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
} from "@/components/marketing/doc-article";
import d from "@/styles/Docs.module.css";

export default function Troubleshooting() {
    return (
        <DocArticle
            title="Troubleshooting"
            description="Checks for vault unlock failures, incomplete imports, missing autofill, device linking and sync problems, and backups that will not restore."
            toc={[
                { href: "#unlock", label: "Unlock" },
                { href: "#import", label: "Import" },
                { href: "#extension", label: "Extension" },
                { href: "#linking", label: "Linking and sync" },
                { href: "#restore", label: "Backups and restore" },
                { href: "#help", label: "Get help" },
            ]}
            related={[
                { href: "/docs/recovery", title: "Recovery guide" },
                { href: "/docs/threat-model", title: "Security boundaries" },
            ]}
        >
            <DocSection id="unlock" title="The vault will not unlock">
                <ul className={d.alignedList}>
                    <li>
                        Confirm that the correct vault is selected. A browser
                        can hold more than one local vault.
                    </li>
                    <li>
                        Enter the master password created for this local copy. A
                        linked extension can have a different passphrase from
                        the web vault.
                    </li>
                    <li>
                        If the vault requires a protection phrase, enter it in
                        the separate field. A hardware-backed key must be
                        available in a browser that supports the required
                        WebAuthn feature.
                    </li>
                    <li>
                        If the master password or additional key is unavailable,
                        choose <strong>Use recovery code</strong> and enter the
                        recovery code for this vault.
                    </li>
                </ul>
                <DocCallout title="Online Services cannot reset a vault password">
                    <p>
                        The Recovery Kit phrase recovers Online Services account
                        control. It does not unlock an encrypted vault or
                        backup.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="import" title="The import is empty or incomplete">
                <ul className={d.alignedList}>
                    <li>
                        Choose the source and format that exactly match the
                        export you made.
                    </li>
                    <li>
                        Read the import warnings and the{" "}
                        <strong>Skipped</strong> count before confirming.
                    </li>
                    <li>
                        Export again from the source application if it produced
                        a protected or malformed file. Cryptex Vault accepts the
                        formats listed in the{" "}
                        <Link href="/docs/importing">import guide</Link>.
                    </li>
                    <li>
                        If you retry an import, check the vault first. Importing
                        the same file again can add duplicate credentials.
                    </li>
                </ul>
            </DocSection>

            <DocSection
                id="extension"
                title="Browser extension autofill does not appear"
            >
                <ul className={d.alignedList}>
                    <li>
                        Open the toolbar popup and unlock the extension vault.
                    </li>
                    <li>
                        Open the credential and check that its saved URL matches
                        the page you are visiting.
                    </li>
                    <li>
                        Reload the page after installing or updating the
                        extension.
                    </li>
                    <li>
                        Some unusual, embedded, or cross-frame forms may not
                        show an inline icon. Open the extension popup and copy
                        the field you need.
                    </li>
                </ul>
                <p>
                    The extension locks after 30 minutes of system idle. Closing
                    the popup alone does not immediately lock it.
                </p>
            </DocSection>

            <DocSection id="linking" title="A device will not link or sync">
                <ul className={d.alignedList}>
                    <li>
                        Keep both devices online with their vaults unlocked.
                        During linking, leave the invitation screens open. Keep
                        the extension popup open during synchronization.
                    </li>
                    <li>
                        Start over with a fresh invitation if the QR code, file,
                        or verification words came from an earlier attempt.
                    </li>
                    <li>
                        If the camera is unavailable, paste the QR payload or
                        use the link file method.
                    </li>
                    <li>
                        If a direct connection fails, check whether the selected
                        signaling and relay service is reachable. Online
                        Services access also requires an active{" "}
                        <Link href="/pricing">eligible plan</Link>; self-hosted
                        users should check their signaling, STUN, and TURN
                        configuration. Signaling can connect successfully while
                        the device connection fails if no direct route is
                        available and the TURN relay cannot be reached.
                    </li>
                    <li>
                        A web-app tab can synchronize in the background while
                        both devices are online and unlocked. If one device is
                        offline, sync waits until it is available again.
                    </li>
                </ul>
                <p>
                    Use the linking progress details to identify whether the
                    failure happened while joining signaling, finding the other
                    device, building the private connection, or transferring the
                    vault. You can also open <strong>Vault Settings</strong>,
                    then <strong>Developer Tools</strong> and{" "}
                    <strong>Open Log Inspector</strong> to check recent errors.
                </p>
                <p>
                    Choose <strong>Manage</strong> beside Linked Devices, then
                    select the device. New links are set to connect and sync
                    automatically when both vaults are available.{" "}
                    <strong>Ready to connect</strong> means signaling is
                    available, but the device connection is not yet active. With
                    automatic connection on, you do not need to press{" "}
                    <strong>Connect</strong>. If the status does not change,
                    check that the other vault is online and unlocked, then
                    review the connection logs. Use <strong>Connect</strong> if
                    automatic connection is off or you want to retry manually.
                    Once connected, sync starts automatically if{" "}
                    <strong>Sync after connecting</strong> is on; otherwise,
                    choose <strong>Sync now</strong>. Check that{" "}
                    <strong>Last successful sync</strong> updates to confirm it
                    finished.
                </p>
                <p>
                    To review the automatic settings, open the three-dot menu
                    for that device in the Linked Devices sidebar, or press and
                    hold its row on a touch screen. Choose{" "}
                    <strong>Edit name and sync settings</strong>. The animated
                    line on the <strong>Devices</strong> map shows an active
                    connection, not a completed sync.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/devices.png"
                    width={1046}
                    height={907}
                    alt="Device details showing connection preferences and the most recent sync time"
                    caption="Check the linked device settings and last-sync time when diagnosing a connection that appears idle."
                />
                <h3>The sync finishes but a change is missing</h3>
                <p>
                    Check which device holds the change. Syncing A with C cannot
                    retrieve an edit that exists only on B. Bring B online and
                    sync it with the other devices. If the same item was edited
                    on both devices, compare their saved values and check the{" "}
                    <Link href="/docs/synchronization#changes">
                        conflict-resolution rules
                    </Link>
                    . A higher version or, for equal versions, a later edit can
                    take precedence.
                </p>
                <h3>A deleted item returns</h3>
                <p>
                    Bring the device where you deleted the item online and sync
                    it with each remaining device. This passes the deletion to
                    those copies. If the item was imported again, it may be a
                    separate record; check for duplicates before deleting it.
                </p>
            </DocSection>

            <DocSection id="restore" title="A backup will not restore">
                <ul className={d.alignedList}>
                    <li>
                        If the file picker rejects your backup, check that you
                        selected the original <code>.cryx</code> file, not a
                        JSON export or a renamed file. If you have another copy,
                        try that one.
                    </li>
                    <li>
                        If restoration finishes but the vault will not unlock,
                        select the restored copy on the <strong>Unlock</strong>{" "}
                        tab. Use the secrets that protected that backup when it
                        was made. Later changes to the original vault do not
                        change older backups.
                    </li>
                    <li>
                        If managed recovery shows no root-device restore points,
                        check whether managed backups were enabled and a{" "}
                        <Link href="/docs/online-services#devices">
                            root device
                        </Link>{" "}
                        uploaded a backup. The Online Services Recovery Kit
                        retrieves eligible backups; it cannot create one.
                    </li>
                    <li>
                        If one managed restore point fails an availability or
                        integrity check, try another retained point and note
                        which one failed before asking for help.
                    </li>
                </ul>
                <p>
                    For the full restore procedure and recovery secrets, see the{" "}
                    <Link href="/docs/backups">backup guide</Link> and{" "}
                    <Link href="/docs/recovery">recovery guide</Link>.
                </p>
            </DocSection>

            <DocSection id="help" title="Get help without sending secrets">
                <p>
                    For general questions and troubleshooting, start a thread in{" "}
                    <a href="https://github.com/CryptexIndustries/vault-web/discussions">
                        GitHub Discussions
                    </a>
                    . For a private issue, email{" "}
                    <a href="mailto:support@cryptex-vault.com">
                        support@cryptex-vault.com
                    </a>{" "}
                    instead. Include where the error occurred, your browser
                    version, and the exact error text. Never share a master
                    password, vault recovery code, protection phrase, Online
                    Services Recovery Kit, exported password file, or decrypted
                    credential.
                </p>
            </DocSection>
        </DocArticle>
    );
}
