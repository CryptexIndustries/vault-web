import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import d from "@/styles/Docs.module.css";
import {
    DocArticle,
    DocCallout,
    DocScreenshot,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function LinkingDevices() {
    const router = useRouter();
    const [deviceView, setDeviceView] = useState<"map" | "list" | "settings">(
        "map",
    );
    const [receiver, setReceiver] = useState<"web" | "extension">("web");
    useEffect(() => {
        if (router.isReady) {
            setReceiver(
                router.query.receiver === "extension" ? "extension" : "web",
            );
        }
    }, [router.isReady, router.query.receiver]);
    return (
        <DocArticle
            title="Linking devices"
            description="Connect another browser or the Chromium Extension to your vault, then sync your passwords between them."
            toc={[
                { href: "#prepare", label: "Before you start" },
                { href: "#invite", label: "Create an invitation" },
                { href: "#receive", label: "Accept the invitation" },
                { href: "#sync", label: "Sync your changes" },
                { href: "#manage", label: "Manage devices and links" },
                { href: "#help", label: "If you get stuck" },
            ]}
            related={[
                { href: "/docs/browser-extension", title: "Set up autofill" },
                {
                    href: "/docs/synchronization",
                    title: "How synchronization works",
                },
                { href: "/docs/backups", title: "Back up your vault" },
            ]}
        >
            <DocSection id="prepare" title="Before you start">
                <p>
                    Open and unlock the vault you want to synchronize. On the
                    other device, open the web app or install the Chromium
                    Extension. Both devices need to be online. Keep both apps
                    open until linking finishes.
                </p>
                <p>
                    To link devices and synchronize your vault, you need either
                    a paid{" "}
                    <Link href="/pricing">Online Services subscription</Link> or
                    your own connection servers. To use your own servers without
                    a subscription, follow the{" "}
                    <Link href="/docs/self-hosting">self-hosting guide</Link>{" "}
                    and configure them under <strong>Vault signaling</strong>{" "}
                    before linking.
                </p>
                <DocCallout title="Linking and syncing are separate steps">
                    <p>
                        Linking transfers your vault and connects the two
                        copies. After that, sync whenever you want to exchange
                        changes. Each device keeps its own local vault.
                    </p>
                </DocCallout>
            </DocSection>
            <DocSection id="invite" title="Create an invitation">
                <DocSteps
                    items={[
                        <p key="open">
                            In your existing web vault, open the plus menu
                            beside <strong>Linked Devices</strong>.
                        </p>,
                        <p key="create">
                            Choose <strong>Create invitation</strong> and follow
                            the prompts.
                        </p>,
                        <p key="method">
                            Display the QR code for the other device to scan, or
                            save an invitation file to open there. Keep the
                            verification words and invitation screen available.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/invitation-menu.png"
                    width={1046}
                    height={730}
                    alt="Linked Devices menu showing Create invitation and Use invitation"
                    caption="Create the invitation in the vault you want to copy."
                />
            </DocSection>
            <DocSection
                id="receive"
                title="Accept the invitation on the other device"
            >
                <div
                    className={d.platformSelector}
                    role="group"
                    aria-label="Receiving app"
                >
                    <button
                        type="button"
                        aria-pressed={receiver === "web"}
                        aria-controls="receiving-instructions"
                        onClick={() => setReceiver("web")}
                    >
                        Web app
                    </button>
                    <button
                        type="button"
                        aria-pressed={receiver === "extension"}
                        aria-controls="receiving-instructions"
                        onClick={() => setReceiver("extension")}
                    >
                        Chromium Extension
                    </button>
                </div>
                <div id="receiving-instructions">
                    <DocScreenshot
                        key={receiver}
                        src={
                            receiver === "web"
                                ? "/images/docs/invitation-menu.png"
                                : "/images/docs/link-extension.png"
                        }
                        width={receiver === "web" ? 1046 : 2880}
                        height={receiver === "web" ? 730 : 1800}
                        alt={
                            receiver === "web"
                                ? "Web app Linked Devices menu showing Use invitation"
                                : "Chromium Extension receiving screen with Scan QR, Import file and Verification words"
                        }
                        caption={
                            receiver === "web"
                                ? "In the receiving web vault, open the plus menu beside Linked Devices and choose Use invitation."
                                : "The extension can receive an invitation through a QR code or a file."
                        }
                    />
                    {receiver === "web" ? (
                        <>
                            <DocSteps
                                items={[
                                    <p key="open">
                                        Open{" "}
                                        <Link href="/app">the web app</Link> on
                                        the receiving device and unlock the
                                        vault you want to receive into. If this
                                        browser has no vault yet,{" "}
                                        <Link href="/docs/getting-started#create">
                                            create a vault
                                        </Link>{" "}
                                        first.
                                    </p>,
                                    <p key="invite">
                                        Open the plus menu beside{" "}
                                        <strong>Linked Devices</strong> and
                                        choose <strong>Use invitation</strong>.
                                        You can also choose{" "}
                                        <strong>Manage</strong>, then{" "}
                                        <strong>Link</strong> and{" "}
                                        <strong>Receive invitation</strong>.
                                    </p>,
                                    <p key="package">
                                        Choose <strong>Scan QR</strong> or{" "}
                                        <strong>Import file</strong> to load the
                                        invitation from the sending device, then
                                        choose <strong>Next</strong>.
                                    </p>,
                                    <p key="words">
                                        Enter the verification words shown by
                                        the sending vault in the mnemonic field,
                                        then choose{" "}
                                        <strong>Receive vault data</strong>.
                                    </p>,
                                    <p key="finish">
                                        Keep both vaults and the receiving
                                        dialog open until linking completes.
                                        Close the dialog and check that the
                                        received credentials are present.
                                        Continue using your receiving
                                        vault&apos;s existing password to unlock
                                        it.
                                    </p>,
                                ]}
                            />
                            <p>
                                Your existing items stay in the receiving vault.
                                Linking adds missing data from the sending
                                vault.
                            </p>
                        </>
                    ) : (
                        <DocSteps
                            items={[
                                <p key="open">
                                    Open the Chromium Extension and choose{" "}
                                    <strong>Use invitation</strong> on its
                                    opening screen. The receiving screen opens
                                    in a new tab.
                                </p>,
                                <p key="import">
                                    Scan the QR code or open the invitation
                                    file. Enter the verification words from the
                                    sending vault.
                                </p>,
                                <p key="transfer">
                                    Choose{" "}
                                    <strong>Connect with this vault</strong>.
                                    Wait for the vault transfer and keep the
                                    sending vault open throughout.
                                </p>,
                                <p key="save">
                                    Create and confirm a passphrase and choose{" "}
                                    <strong>Save vault</strong>. Use that
                                    passphrase to unlock this local copy.
                                </p>,
                                <p key="check">
                                    Open the receiving vault and check that your
                                    credentials are present before closing the
                                    sending vault.
                                </p>,
                            ]}
                        />
                    )}
                </div>
                <p>
                    Share invitations and verification words only with the
                    device you intend to link. Delete any copied invitation file
                    once you finish.
                </p>
            </DocSection>
            <DocSection id="sync" title="Sync your changes">
                <p>
                    New links connect automatically and sync after connecting.
                    Open and unlock both vaults so they can exchange changes.
                    The web app can sync in a background tab. If you use the
                    extension, keep its popup open while syncing.
                </p>
                <p>
                    In the web vault, choose <strong>Manage</strong> beside
                    <strong> Linked Devices</strong> and select the other
                    device. Check that <strong>Last successful sync</strong>{" "}
                    updates. If automatic connection is off, use{" "}
                    <strong>Connect</strong>. Once connected,{" "}
                    <strong>Sync now</strong> lets you start a sync manually.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/sync.png"
                    width={1046}
                    height={907}
                    alt="Web app linked-device menu with Connect, Sync now, View details, and Edit name and sync settings"
                    caption="Web application: the device menu provides manual connection and sync actions."
                />
                <p>
                    Open the device's three-dot menu in the Linked Devices
                    sidebar, or press and hold its row on a touch screen. Choose{" "}
                    <strong>Edit name and sync settings</strong> to change{" "}
                    <strong>Connect automatically</strong>,
                    <strong> Sync after connecting</strong>, or
                    <strong> Disconnect after inactivity</strong>.
                </p>
            </DocSection>
            <DocSection id="manage" title="Manage devices and links">
                <p>
                    Choose <strong>Manage</strong> beside Linked Devices, or
                    open the <strong>Devices</strong> tab in Account. Selecting
                    a device in the sidebar, or choosing{" "}
                    <strong>View details</strong> in its menu, opens the same
                    screen with that device selected. On touch screens, hold a
                    device row to open its quick actions; the three-dot button
                    also opens the menu.
                </p>
                <p>
                    Switch between the connection map and device list. Select a
                    device to inspect its saved links, connection status, and
                    last successful sync. Select a line on the map to inspect a
                    relationship. Custom signaling devices have a diamond
                    marker. An animated line means a connection is active; it
                    does not prove that a transfer is in progress or that a sync
                    completed. Connections between other devices may show an
                    unknown status.
                </p>

                <p>
                    Local links remain visible without an Online Services
                    session or root access. Account-wide information and
                    permissions require the appropriate account access. Use the
                    refresh button when signed in to reload account information;
                    it has a ten-second cooldown. A failed or unavailable
                    account check does not establish that a saved relationship
                    was deleted.
                </p>

                <div
                    className={d.platformSelector}
                    role="group"
                    aria-label="Web app device views"
                >
                    {(["map", "list", "settings"] as const).map((view) => (
                        <button
                            key={view}
                            type="button"
                            aria-pressed={deviceView === view}
                            aria-controls="device-view"
                            onClick={() => setDeviceView(view)}
                        >
                            {view === "map"
                                ? "Map"
                                : view === "list"
                                  ? "List"
                                  : "Sync settings"}
                        </button>
                    ))}
                </div>
                <div id="device-view">
                    <DocScreenshot
                        key={deviceView}
                        src={
                            deviceView === "settings"
                                ? "/images/walkthrough/devices.png"
                                : `/images/docs/device-${deviceView}.png`
                        }
                        width={1046}
                        height={907}
                        alt={
                            deviceView === "map"
                                ? "Web app Devices map showing linked peers and selected-device details"
                                : deviceView === "list"
                                  ? "Web app Devices list with search, filters, and selected-device details"
                                  : "Web app device settings with automatic connection and synchronization controls"
                        }
                        caption={
                            deviceView === "map"
                                ? "Web application: select a device to see its connection status and last successful sync."
                                : deviceView === "list"
                                  ? "Web application: search by device name or ID and filter the device list."
                                  : "Web application: configure automatic connection, sync after connecting, and idle disconnection."
                        }
                    />
                </div>
                <DocCallout
                    title="Unlinking does not erase a vault"
                    tone="warning"
                >
                    <p>
                        <strong>Unlink from this vault</strong> removes a custom
                        signaling link locally. For a verified Online Services
                        relationship, <strong>Unlink devices</strong> removes
                        that relationship and its local entry while keeping the
                        account registration.{" "}
                        <strong>Remove from Online Services</strong> removes the
                        selected device's account registration and its account
                        sync relationships, plus matching saved links in this
                        vault. Account removal requires root access and an
                        eligible device. None of these actions erases vault
                        contents already stored on either device.
                    </p>
                </DocCallout>
                <p>
                    If a relationship is confirmed missing from Online Services,
                    or an unlink attempt fails, device details can offer removal
                    of the saved link from this vault only. That cleanup does
                    not revoke the remote account registration.
                </p>
            </DocSection>

            <DocSection id="help" title="If you get stuck">
                <p>
                    The message{" "}
                    <strong>
                        Vault transfer could not be authenticated. Update the
                        sending device and try again.
                    </strong>{" "}
                    means the receiver could not verify the sender. Update the
                    sending app and retry with a new invitation. Current
                    receivers reject transfers from older senders that do not
                    sign the transfer. If it still fails with both apps updated,
                    stop and seek help rather than bypassing the check.
                </p>
                <p>
                    If the connection does not complete, check that both devices
                    are online and both vaults are still open. Check the
                    verification words and your Online Services access or custom
                    server settings, then try again.
                </p>
                <p>
                    For connection problems, see{" "}
                    <Link href="/docs/troubleshooting">Troubleshooting</Link>.
                    For an explanation of how changes move between linked
                    devices, read the{" "}
                    <Link href="/docs/synchronization">
                        technical synchronization guide
                    </Link>
                    .
                </p>
            </DocSection>
        </DocArticle>
    );
}
