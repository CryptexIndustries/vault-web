import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { Bug, Calendar, GitCommit, Plus, Zap } from "lucide-react";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";

interface ChangelogRelease {
    version: string;
    initialVersion?: boolean;
    date: string;
    changes: {
        type: "added" | "changed" | "fix" | "removed";
        description: string;
    }[];
}

const CHANGELOG_DATA: ChangelogRelease[] = [
    {
        version: "v1.4.1",
        date: "2026-09-25",
        changes: [
            {
                type: "added",
                description:
                    "Manage your linked devices from Account or the vault sidebar. A connection map and searchable list show each device and its links, including direct links that do not use Online Services.",
            },
            {
                type: "changed",
                description:
                    "Device actions now make it clearer when you are connecting, syncing, unlinking, or removing a device. Sidebar quick actions also work with a long press on touch screens.",
            },
            {
                type: "added",
                description:
                    "Change your master password and extra key protection, generate a new vault recovery code, or rotate this device's encryption key from Vault Security. Key rotation gives you a new recovery code. In the web app, your recovery code can also be used to set a new password.",
            },
            {
                type: "changed",
                description:
                    "When managed backups are enabled, security changes start a fresh backup. You can opt to delete older account restore points, including linked-device copies, after the upload succeeds. Downloaded backups remain yours to delete and still use the password and recovery information they had when downloaded.",
            },
            {
                type: "changed",
                description:
                    "Imports now show what will be added, skipped, or saved differently before you confirm. More details from Bitwarden, 1Password, KeePass, LastPass, Chrome, and Firefox exports are carried over, and invalid files show clearer errors.",
            },
            {
                type: "fix",
                description:
                    "Synchronization handles simultaneous connections and disconnects more reliably. A failed vault save no longer appears as a successful sync, and secure custom relay server addresses now work.",
            },
            {
                type: "fix",
                description:
                    "Backup Center now shows current coverage only after a backup has finished uploading.",
            },
            {
                type: "fix",
                description:
                    "Vault transfers now verify the sending device before accepting the encrypted vault. Update the sending device if a new link reports that its transfer could not be authenticated.",
            },
            {
                type: "changed",
                description:
                    "Boolean custom fields now have an on/off switch in the web credential editor.",
            },
            {
                type: "added",
                description:
                    "Self-hosting templates are available for the web app and its device-linking services, including secure TURN setup.",
            },
        ],
    },
    {
        version: "v1.4.0",
        date: "2026-07-06",
        changes: [
            {
                type: "added",
                description:
                    "Credentials can store multiple website rules with exact-host, parent/sibling domain, or safe wildcard matching.",
            },
            {
                type: "added",
                description:
                    "A new Backup Center provides encrypted downloads and optional Premium managed restore points with backup status, history, and management controls. Restore local files or recover on a fresh device without replacing an existing vault, and rotate or replace your Recovery Kit for future recovery.",
            },
            {
                type: "added",
                description:
                    "Choose how long the web vault waits before automatically locking after inactivity.",
            },
            {
                type: "added",
                description:
                    "Organize credentials into directories across the web app and extension, move multiple credentials at once, and preserve directories through imports, exports, and linked-device synchronization.",
            },
            {
                type: "changed",
                description:
                    "Online Services sessions now refresh and sign out more reliably, including when locking a vault or removing an account connection.",
            },
            {
                type: "removed",
                description:
                    "Removed the unused Online Services feature-voting integration and Premium perk listing.",
            },
            {
                type: "fix",
                description:
                    "Older v2 vault backups can be restored and unlocked again without an invalid-version error.",
            },
            {
                type: "fix",
                description:
                    "Production Online Services error logs no longer include request inputs or response details that may contain sensitive information.",
            },
            {
                type: "added",
                description:
                    "Payments now stay inside Cryptex Vault with embedded monthly and yearly checkout, billing management, and clearer account and recovery flows.",
            },
            {
                type: "added",
                description:
                    "The browser extension can securely recognize authentication forms, fill, save, and manage credentials for the current site, generate passwords and linking passphrases, keep its controls aligned, and automatically lock when idle.",
            },
            {
                type: "added",
                description:
                    "Vault protection now includes password-strength guidance, optional recovery phrases and additional protection keys, safer secret handling, and clearer setup and recovery controls.",
            },
            {
                type: "added",
                description:
                    "Import passwords from Cryptex Vault, Bitwarden, 1Password, KeePass, LastPass, Chrome, and Firefox using a guided preview, including during new vault setup.",
            },
            {
                type: "added",
                description:
                    "Linking and synchronization are now encrypted end-to-end with more reliable QR exchange, improved connectivity, and post-quantum message signing.",
            },
            {
                type: "changed",
                description:
                    "Vault, account, recovery, and connected-device screens have been refined for clearer feedback.",
            },
        ],
    },
    {
        version: "v1.3.0",
        date: "2026-01-06",
        changes: [
            {
                type: "added",
                description:
                    "Introduced a Log Inspector dialog for enhanced debugging and log management.",
            },
            {
                type: "added",
                description:
                    "Added an auto-confirm countdown to the Vault Lock dialog.",
            },
            {
                type: "added",
                description:
                    "Added a `showPasswordGenerator` prop to `FormInput` for optional password generator buttons, and removed the default generator from the vault unlock secret input.",
            },
            {
                type: "changed",
                description:
                    "Started unifying vault UI components for a more consistent experience.",
            },
            {
                type: "changed",
                description:
                    "Added autofocus to the secret key input in the Unlock tab for faster entry.",
            },
            {
                type: "changed",
                description:
                    "The `web` package version has been bumped to `v1.3.0`.",
            },
            {
                type: "changed",
                description:
                    "Updated `.gitignore` to exclude extension build artifacts.",
            },
            {
                type: "fix",
                description:
                    "Correctly reference the credentials list in `applyDiffs` so vault synchronization works properly.",
            },
            {
                type: "fix",
                description:
                    "Added a short UI delay in the Unlock Vault dialog to improve responsiveness during unlock.",
            },
            {
                type: "fix",
                description:
                    "Unified HTML5 quote escape sequences in `unlock.tsx` to avoid parsing inconsistencies.",
            },
        ],
    },
    {
        version: "v1.2.0",
        date: "2025-12-06",
        changes: [
            {
                type: "added",
                description:
                    "QR code data can be copied in the in-vault linking dialog.",
            },
            {
                type: "added",
                description: "Changelog dialog now highlights unseen releases.",
            },
            {
                type: "added",
                description:
                    "Implemented a new vault metadata editor in the Vault Manager.",
            },
            {
                type: "added",
                description:
                    "Implemented a credential generator dialog on every password input field.",
            },
            {
                type: "changed",
                description:
                    "Strip the linking configuration and devices from the generated backup.",
            },
            {
                type: "changed",
                description:
                    "The `web` package version has been bumped to `v1.2.0`.",
            },
            {
                type: "fix",
                description: "Removed reliance on the nodejs Buffer class.",
            },
        ],
    },
    {
        version: "v1.1.0",
        date: "2025-08-03",
        changes: [
            {
                type: "added",
                description: "Added the `CHANGELOG.md` file (#5)",
            },
            {
                type: "added",
                description: "Changelog dialog inside the application",
            },
            {
                type: "changed",
                description: "Replaced `npm` with `pnpm` (#5)",
            },
            {
                type: "changed",
                description:
                    "Changed the project structure to allow for browser extension collocation",
            },
            {
                type: "changed",
                description: "Bumped the dependency versions",
            },
            {
                type: "changed",
                description:
                    "Stripe API integration now targets the latest version used by the account - not pinned to a specific version",
            },
            {
                type: "changed",
                description:
                    "The `web` package version has been bumped to `v1.1.0`",
            },
        ],
    },
    {
        version: "v1.0.2",
        date: "2025-07-12",
        changes: [
            {
                type: "added",
                description:
                    "Show a notification when the TURN server configuration is saved (#4)",
            },
            {
                type: "fix",
                description:
                    "Make sure that the Vault Manager UI is refreshed when the last vault is removed (#4)",
            },
            {
                type: "fix",
                description:
                    "In-vault dialog header title color has appropriate contrast",
            },
            {
                type: "fix",
                description:
                    "In-vault number input control text color has appropriate contrast",
            },
            {
                type: "fix",
                description:
                    "Signaling server configuration is now properly saved",
            },
            {
                type: "fix",
                description:
                    "In-vault STUN/TURN/Signaling server configuration dialog UI elements now use appropriate colors",
            },
            {
                type: "changed",
                description:
                    "Remove `console.error` calls when the credential list is rendering (#4)",
            },
            {
                type: "changed",
                description:
                    "In-vault credential list item favicons now load lazily",
            },
        ],
    },
    {
        version: "v1.0.1",
        date: "2025-07-11",
        changes: [
            {
                type: "added",
                description:
                    "Show all tier perks in the account dialog, along with an icon indicating whether or not it is available in the current tier (#3)",
            },
        ],
    },
    {
        version: "v1.0.0",
        date: "2025-07-01",
        initialVersion: true,
        changes: [
            {
                type: "fix",
                description:
                    "Fix Stripe configuration so that it accepts promotional codes (#1)",
            },
            {
                type: "fix",
                description: "Fix QR decoding when linking outside vault (#2)",
            },
            {
                type: "changed",
                description: "Redesigned the index page",
            },
            {
                type: "changed",
                description: "Redesigned the Vault Manager page",
            },
            {
                type: "changed",
                description: "Rewrote the synchronization logic",
            },
            {
                type: "changed",
                description: "Project made public",
            },
        ],
    },
];

export const ChangelogDialog: React.FC = () => {
    const currentVersion = CHANGELOG_DATA[0]?.version ?? "";
    const storageKey = "changelog:lastSeenVersion";

    const [open, setOpen] = useState(false);
    const [hasUnseen, setHasUnseen] = useState(false);

    useEffect(() => {
        try {
            const lastSeen =
                typeof window !== "undefined"
                    ? localStorage.getItem(storageKey)
                    : null;
            setHasUnseen(!!currentVersion && lastSeen !== currentVersion);
        } catch {
            // ignore storage errors
        }
    }, [currentVersion]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            try {
                if (typeof window !== "undefined") {
                    localStorage.setItem(storageKey, currentVersion);
                }
            } catch {
                // ignore storage errors
            }
            setHasUnseen(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    // size="xs"
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                    <span className="relative inline-block">
                        {currentVersion}
                        {hasUnseen && (
                            <span
                                aria-label="New changelog"
                                className="absolute -right-1 -top-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 ring-2 ring-background"
                            />
                        )}
                    </span>
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <GitCommit className="h-5 w-5" />
                        Changelog
                    </DialogTitle>
                    <DialogDescription>
                        Track updates, improvements, and new features in Cryptex
                        Vault.
                        <br />
                        Detailed release notes are published in the repository
                        changelog.
                        <br />
                        Source URL:{" "}
                        <a
                            href="https://github.com/CryptexIndustries/vault-web"
                            target="blank"
                            className="text-primary underline"
                        >
                            https://github.com/CryptexIndustries/vault-web
                        </a>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-6">
                        {CHANGELOG_DATA.map((release) => (
                            <div key={release.version} className="space-y-4">
                                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background py-2">
                                    <div className="flex items-center gap-3">
                                        <Badge
                                            variant={
                                                release.version ===
                                                CHANGELOG_DATA[0]?.version
                                                    ? "default"
                                                    : "secondary"
                                            }
                                            className="font-mono"
                                        >
                                            {release.version}
                                        </Badge>
                                        {release.initialVersion && (
                                            <Badge
                                                variant="outline"
                                                className="text-xs"
                                            >
                                                Initial Release
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                        <Calendar className="h-3 w-3" />
                                        <span>{release.date}</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {release.changes.map((change, index) => (
                                        <div
                                            key={index}
                                            className="flex items-start gap-3"
                                        >
                                            <div className="mt-0.5 flex-shrink-0">
                                                {change.type === "added" && (
                                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                                                        <Plus className="h-3 w-3 text-green-600 dark:text-green-400" />
                                                    </div>
                                                )}
                                                {change.type === "changed" && (
                                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                                                        <Zap className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                                    </div>
                                                )}
                                                {change.type === "fix" && (
                                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
                                                        <Bug className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                                                    </div>
                                                )}
                                                {change.type === "removed" && (
                                                    <div className="bg-destructive-100 dark:bg-destructive-900/30 flex h-5 w-5 items-center justify-center rounded-full">
                                                        <Zap className="text-destructive-600 dark:text-destructive-400 h-3 w-3" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm leading-relaxed">
                                                    {change.description}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {release !==
                                    CHANGELOG_DATA[
                                        CHANGELOG_DATA.length - 1
                                    ] && <Separator className="mt-6" />}
                            </div>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
