import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import {
    Bug,
    Calendar,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    GitCommit,
    Plus,
    Zap,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";
import styles from "@/styles/Changelog.module.css";

import agentChangelog from "../../../services/cmd/cryptex-agent/CHANGELOG.md";
import relayServerChangelog from "../../../services/cmd/relay-server/CHANGELOG.md";
import shareServerChangelog from "../../../services/cmd/share-server/CHANGELOG.md";
import extensionChangelog from "../../../extension/CHANGELOG.md";
import androidChangelog from "../../../mobile/CHANGELOG.md";
import webChangelog from "../../CHANGELOG.md";

interface ChangelogRelease {
    version: string;
    date: string;
    changes: {
        type: "added" | "changed" | "fix" | "removed";
        description: string;
    }[];
}

const CHANGE_LABELS: Record<
    ChangelogRelease["changes"][number]["type"],
    string
> = {
    added: "Added",
    changed: "Changed",
    fix: "Fixed",
    removed: "Removed",
};

const CHANGE_TYPES = Object.fromEntries(
    Object.entries(CHANGE_LABELS).map(([type, label]) => [label, type]),
) as Record<string, ChangelogRelease["changes"][number]["type"]>;

/**
 * Reads the "## 1.2.3 - 2026-01-31" sections of a component's CHANGELOG.md.
 * Throws on headings it doesn't know, so a typo fails the build instead of
 * dropping entries from the page.
 */
function parseChangelog(markdown: string): ChangelogRelease[] {
    const releases: ChangelogRelease[] = [];
    let type: ChangelogRelease["changes"][number]["type"] | undefined;
    let entry: ChangelogRelease["changes"][number] | undefined;
    for (const line of markdown.split(/\r?\n/)) {
        if (line.startsWith("## ")) {
            const match = /^## (\S+) - (\d{4}-\d{2}-\d{2})$/.exec(line);
            if (!match) throw new Error(`Bad changelog heading: ${line}`);
            releases.push({
                version: `v${match[1]}`,
                date: match[2]!,
                changes: [],
            });
            type = entry = undefined;
        } else if (line.startsWith("### ")) {
            type = CHANGE_TYPES[line.slice(4)];
            if (!type) throw new Error(`Bad changelog heading: ${line}`);
            entry = undefined;
        } else if (line.startsWith("- ") && releases.length) {
            if (!type)
                throw new Error(`Changelog entry outside a section: ${line}`);
            entry = { type, description: line.slice(2) };
            releases.at(-1)!.changes.push(entry);
        } else if (entry && /^\s+\S/.test(line)) {
            // A bullet wrapped onto the next line.
            entry.description += ` ${line.trim()}`;
        }
    }
    return releases;
}

export const CHANGELOGS = [
    {
        key: "web",
        label: "Web app",
        path: "web/CHANGELOG.md",
        releases: parseChangelog(webChangelog),
    },
    {
        key: "extension",
        label: "Extension",
        path: "extension/CHANGELOG.md",
        releases: parseChangelog(extensionChangelog),
    },
    {
        key: "android",
        label: "Android",
        path: "mobile/CHANGELOG.md",
        releases: parseChangelog(androidChangelog),
    },
    {
        key: "agent",
        label: "SSH agent",
        path: "services/cmd/cryptex-agent/CHANGELOG.md",
        releases: parseChangelog(agentChangelog),
    },
    {
        key: "share-server",
        label: "Share server",
        path: "services/cmd/share-server/CHANGELOG.md",
        releases: parseChangelog(shareServerChangelog),
    },
    {
        key: "relay-server",
        label: "Relay",
        path: "services/cmd/relay-server/CHANGELOG.md",
        releases: parseChangelog(relayServerChangelog),
    },
] as const;

export type ChangelogKey = (typeof CHANGELOGS)[number]["key"];

export function isChangelogKey(value: unknown): value is ChangelogKey {
    return CHANGELOGS.some((changelog) => changelog.key === value);
}

export function ChangelogPicker({
    value,
    onChange,
    className,
    buttonClassName,
}: {
    value: ChangelogKey;
    onChange: (key: ChangelogKey) => void;
    className: string;
    buttonClassName?: string;
}) {
    const groupRef = useRef<HTMLDivElement>(null);
    const [hidden, setHidden] = useState({ left: false, right: false });

    // Fades out an edge of the row when more buttons are hidden past it.
    const updateHidden = useCallback(() => {
        const group = groupRef.current;
        if (!group) return;
        const left = group.scrollLeft > 1;
        const right =
            group.scrollLeft + group.clientWidth < group.scrollWidth - 1;
        setHidden((current) =>
            current.left === left && current.right === right
                ? current
                : { left, right },
        );
    }, []);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;
        updateHidden();
        const observer = new ResizeObserver(updateHidden);
        observer.observe(group);
        return () => observer.disconnect();
    }, [updateHidden]);

    // The row scrolls sideways on narrow screens; keep the selected button in
    // it visible without scrolling the page.
    useEffect(() => {
        const group = groupRef.current;
        const selected = group?.querySelector('[aria-pressed="true"]');
        if (!group || !selected) return;
        const row = group.getBoundingClientRect();
        const button = selected.getBoundingClientRect();
        if (button.left < row.left) group.scrollLeft -= row.left - button.left;
        else if (button.right > row.right)
            group.scrollLeft += button.right - row.right;
    }, [value]);

    // Mouse users can't easily scroll sideways, so the chevrons do it. They're
    // hidden from keyboards and screen readers, which reach every button anyway.
    const scrollRow = (direction: 1 | -1) => {
        const group = groupRef.current;
        group?.scrollBy({
            left: direction * group.clientWidth * 0.6,
            behavior: "smooth",
        });
    };
    const chevronClassName =
        "absolute inset-y-0 flex items-center opacity-70 transition-opacity hover:opacity-100";

    return (
        <div className="relative shrink-0">
            <div
                ref={groupRef}
                role="group"
                aria-label="Component"
                className={`flex overflow-x-auto [scrollbar-width:none] ${className}`}
                onScroll={updateHidden}
                style={{
                    maskImage: `linear-gradient(to right, ${hidden.left ? "transparent 1.5rem" : "black"}, black 4rem, black calc(100% - 4rem), ${hidden.right ? "transparent calc(100% - 1.5rem)" : "black"})`,
                }}
            >
                {CHANGELOGS.map((changelog) => (
                    <button
                        key={changelog.key}
                        type="button"
                        aria-pressed={changelog.key === value}
                        className={`flex-none whitespace-nowrap ${buttonClassName ?? ""}`}
                        onClick={() => onChange(changelog.key)}
                    >
                        {changelog.label}
                        <span className="font-mono opacity-70">
                            {changelog.releases[0]?.version.slice(1)}
                        </span>
                    </button>
                ))}
            </div>
            {hidden.left && (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    className={`${chevronClassName} left-0`}
                    onClick={() => scrollRow(-1)}
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
            )}
            {hidden.right && (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    className={`${chevronClassName} right-0`}
                    onClick={() => scrollRow(1)}
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}

/** Renders `code` spans; changelog entries use no other markdown. */
function Description({ text }: { text: string }) {
    return text
        .split("`")
        .map((part, index) =>
            index % 2 ? <code key={index}>{part}</code> : part,
        );
}

/** Release content shared by the app dialog and the public changelog. */
export function ChangelogEntries({
    changelog,
    website = false,
}: {
    changelog: ChangelogKey;
    website?: boolean;
}) {
    const releases = CHANGELOGS.find(({ key }) => key === changelog)!.releases;
    return (
        <TooltipProvider>
            <div className={website ? styles.website : "space-y-6"}>
                {releases.map((release) => (
                    <section
                        key={release.version}
                        id={website ? release.version : undefined}
                        className={`space-y-4 ${styles.release}`}
                    >
                        <div
                            className={`sticky top-0 z-10 flex items-center justify-between border-b bg-background py-2 ${styles.releaseHeader}`}
                        >
                            <div className="flex items-center gap-3">
                                <Badge
                                    role="heading"
                                    aria-level={2}
                                    variant={
                                        release === releases[0]
                                            ? "default"
                                            : "secondary"
                                    }
                                    className={`font-mono ${styles.version}`}
                                >
                                    {release.version}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                <time dateTime={release.date}>
                                    {release.date}
                                </time>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {release.changes.map((change, index) => (
                                <div
                                    key={index}
                                    className={`flex items-start gap-3 ${styles.change}`}
                                >
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div
                                                className="mt-0.5 flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                                role="img"
                                                aria-label={
                                                    CHANGE_LABELS[change.type]
                                                }
                                                tabIndex={0}
                                            >
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
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {CHANGE_LABELS[change.type]}
                                        </TooltipContent>
                                    </Tooltip>
                                    <div className="flex-1">
                                        <p
                                            className={`text-sm leading-relaxed ${styles.description}`}
                                        >
                                            <Description
                                                text={change.description}
                                            />
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {release !== releases.at(-1) && (
                            <Separator className={`mt-6 ${styles.separator}`} />
                        )}
                    </section>
                ))}
            </div>
        </TooltipProvider>
    );
}

export const ChangelogDialog: React.FC = () => {
    const currentVersion = CHANGELOGS[0].releases[0]?.version ?? "";
    const storageKey = "changelog:lastSeenVersion";

    const [open, setOpen] = useState(false);
    const [changelog, setChangelog] = useState<ChangelogKey>("web");
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
            <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden">
                <DialogHeader className="flex-row items-center gap-4 space-y-0 pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <GitCommit className="h-5 w-5" />
                        Changelog
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Release notes for each Cryptex Vault component.
                    </DialogDescription>
                    <a
                        href={`https://github.com/CryptexIndustries/vault-web/blob/master/${
                            CHANGELOGS.find(({ key }) => key === changelog)!
                                .path
                        }`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                        View on GitHub
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </DialogHeader>
                <ChangelogPicker
                    value={changelog}
                    onChange={setChangelog}
                    className="gap-1"
                    buttonClassName="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground [&>span]:ml-1.5"
                />
                <div className="flex-1 overflow-y-auto pr-2">
                    <ChangelogEntries changelog={changelog} />
                </div>
            </DialogContent>
        </Dialog>
    );
};
