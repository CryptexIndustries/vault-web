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
        version: "v1.2.0",
        date: "2025-12-06",
        changes: [
            {
                type: "added",
                description: "QR code data can be copied in the in-vault linking dialog.",
            },
            {
                type: "added",
                description: "Changelog dialog now highlights unseen releases.",
            },
            {
                type: "added",
                description: "Implemented a new vault metadata editor in the Vault Manager.",
            },
            {
                type: "added",
                description: "Implemented a credential generator dialog on every password input field.",
            },
            {
                type: "changed",
                description: "Strip the linking configuration and devices from the generated backup.",
            },
            {
                type: "changed",
                description: "The `web` package version has been bumped to `v1.2.0`.",
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
    {
        version: "unreleased",
        date: "-",
        changes: [
            {
                type: "added",
                description:
                    "Release the Cryptex Vault Browser Extension v1.0.0",
            },
            {
                type: "added",
                description: "Private credentials sharing",
            },
            {
                type: "added",
                description: "Automatic encrypted backups",
            },
            {
                type: "added",
                description: "Layered quantum-resistant encryption",
            },
            {
                type: "changed",
                description: "Redesign the in-vault UI",
            },
            {
                type: "changed",
                description: "Complete test coverage",
            },
        ],
    },
];

export const ChangelogDialog: React.FC = ({}) => {
    const currentVersion = CHANGELOG_DATA[0]?.version ?? "";
    const storageKey = "changelog:lastSeenVersion";

    const [open, setOpen] = useState(false);
    const [hasUnseen, setHasUnseen] = useState(false);

    useEffect(() => {
        try {
            const lastSeen = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
            setHasUnseen(!!currentVersion && lastSeen !== currentVersion);
        } catch (_) {
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
            } catch (_) {
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
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                >
                    <span className="relative inline-block">
                        {currentVersion}
                        {hasUnseen && (
                            <span
                                aria-label="New changelog"
                                className="absolute -top-1 -right-1 inline-block h-2 w-2 rounded-full ring-2 ring-background bg-red-500 animate-pulse"
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
                                <div className="flex items-center justify-between">
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
                                    <div className="text-muted-foreground flex items-center gap-1 text-sm">
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
