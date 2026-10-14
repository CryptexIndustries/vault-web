import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ArrowDownUp,
    ArrowLeft,
    ExternalLink,
    Link2,
    ListFilter,
    Lock,
    MoreHorizontal,
    Plus,
    RefreshCw,
    Search,
    Server,
    Trash2,
    XCircle,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    countShareListRows,
    queryShareListRows,
    SHARE_LIST_SORTS,
    SHARE_LIST_STATUSES,
    SHARE_STATUS_LABELS,
    toShareListRows,
    type ShareListRow,
    type ShareListSort,
    type ShareListStatus,
} from "@cryptex-industries/vault-core/vault-utils/share-list";
import {
    dismissShareLink,
    refreshShareStatuses,
    revokeShareLink,
} from "@cryptex-industries/vault-core/vault-utils/share-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describeShareError, type ShareBackend } from "./share-backend";
import { ShareServerSettingsForm } from "./share-server-settings";

/** The host's own confirmation dialog: description, button label, action. */
export type ShareConfirmFn = (
    description: string,
    confirmLabel: string,
    onConfirm: () => void,
) => void;

const STATUS_CLASSES: Record<ShareListStatus, string> = {
    active: "border-primary/30 bg-primary/10 text-primary",
    viewed: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    expired: "text-muted-foreground",
    revoked: "text-muted-foreground",
    burned: "border-destructive/30 bg-destructive/10 text-destructive",
};

const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });

function describeTiming(
    record: VaultUtilTypes.ShareLink,
    status: ShareListStatus,
) {
    if (status === "viewed" && record.ViewedAtTimestamp) {
        return `Opened ${formatDate(record.ViewedAtTimestamp)}`;
    }
    if (status === "active") {
        return `Expires ${formatDate(record.ExpiresAtTimestamp)}`;
    }
    if (status === "burned") return "Destroyed after five wrong passphrases";
    return `Created ${formatDate(record.CreatedAtTimestamp)}`;
}

export function SharedLinksView({
    records,
    credentialNames,
    backend,
    onBack,
    onShareSecret,
    onOpenItem,
    confirm,
}: {
    records: VaultUtilTypes.ShareLink[];
    /** Names of items that still exist, by ID. */
    credentialNames: Map<string, string>;
    backend: ShareBackend;
    onBack?: () => void;
    onShareSecret: () => void;
    onOpenItem?: (credentialId: string) => void;
    confirm: ShareConfirmFn;
}) {
    const [refreshing, setRefreshing] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settings, setSettings] = useState<
        VaultUtilTypes.ShareSettings | undefined
    >();
    const [query, setQuery] = useState("");
    const [statuses, setStatuses] = useState<ShareListStatus[]>([]);
    const [sort, setSort] = useState<ShareListSort>("newest");

    const rows = useMemo(
        () => toShareListRows(records, credentialNames),
        [records, credentialNames],
    );
    const counts = useMemo(() => countShareListRows(rows), [rows]);
    const visible = useMemo(
        () => queryShareListRows(rows, { query, statuses, sort }),
        [rows, query, statuses, sort],
    );

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await refreshShareStatuses(backend.deps);
        } catch (error) {
            toast.error(describeShareError(error));
        } finally {
            // Picks up records that arrived by sync even when no status changed.
            await backend.reload?.().catch(() => undefined);
            setRefreshing(false);
        }
    }, [backend]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const run = useCallback(
        async (id: string, action: typeof revokeShareLink) => {
            setBusyId(id);
            try {
                await action(backend.deps, id);
            } catch (error) {
                toast.error(describeShareError(error));
            } finally {
                setBusyId(null);
            }
        },
        [backend],
    );

    const requestRevoke = useCallback(
        (row: ShareListRow) =>
            confirm(
                `Revoke the link for "${row.name}"? It stops working right away.`,
                "Revoke link",
                () => void run(row.record.ID, revokeShareLink),
            ),
        [confirm, run],
    );

    const requestRemove = useCallback(
        (row: ShareListRow) => {
            if (row.status !== "active") {
                void run(row.record.ID, dismissShareLink);
                return;
            }
            confirm(
                `Remove "${row.name}" from the list? The link is still active, so this revokes it first.`,
                "Revoke and remove",
                () => void run(row.record.ID, dismissShareLink),
            );
        },
        [confirm, run],
    );

    const toggleStatus = (status: ShareListStatus) =>
        setStatuses((current) =>
            current.includes(status)
                ? current.filter((entry) => entry !== status)
                : [...current, status],
        );

    const openSettings = async () => {
        setSettings(await backend.deps.store.getShareSettings());
        setSettingsOpen(true);
    };

    return (
        <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground shadow-2xl">
            {/* Header and controls stay put; only the list scrolls. */}
            <div className="shrink-0 border-b border-border">
                <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-3 sm:px-6 lg:px-8 lg:pt-6">
                    <div className="flex items-center gap-2">
                        {onBack ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="-ml-2 shrink-0"
                                aria-label="Back to credentials"
                                title="Back to credentials"
                                onClick={onBack}
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        ) : null}
                        <Link2 className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate text-lg font-semibold">
                                Shared links
                            </h1>
                            {/* Only where there's height to spare. */}
                            <p className="hidden text-sm text-foreground/75 [@media(min-height:700px)]:block">
                                One-time links you sent. Your vault keeps their
                                status, not what you shared.
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Share server settings"
                            title="Share server settings"
                            onClick={() => void openSettings()}
                        >
                            <Server className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Refresh status"
                            title="Refresh status"
                            disabled={refreshing}
                            onClick={() => void refresh()}
                        >
                            <RefreshCw
                                className={cn(
                                    "h-4 w-4",
                                    refreshing && "animate-spin",
                                )}
                            />
                        </Button>
                        <Button
                            size="sm"
                            className="shrink-0 gap-1.5"
                            aria-label="Share a secret"
                            onClick={onShareSecret}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">
                                Share a secret
                            </span>
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="search"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Search name or server"
                                aria-label="Search shared links"
                                className="pl-9"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="relative shrink-0"
                                    aria-label={
                                        statuses.length
                                            ? `Filter by status, ${statuses.length} selected`
                                            : "Filter by status"
                                    }
                                    title="Filter by status"
                                >
                                    <ListFilter className="h-4 w-4" />
                                    {statuses.length ? (
                                        <span
                                            aria-hidden="true"
                                            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                                        >
                                            {statuses.length}
                                        </span>
                                    ) : null}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuLabel>Status</DropdownMenuLabel>
                                {SHARE_LIST_STATUSES.map((option) => (
                                    <DropdownMenuCheckboxItem
                                        key={option.value}
                                        checked={statuses.includes(
                                            option.value,
                                        )}
                                        // Keep the menu open to tick several.
                                        onSelect={(event) =>
                                            event.preventDefault()
                                        }
                                        onCheckedChange={() =>
                                            toggleStatus(option.value)
                                        }
                                    >
                                        <span className="flex-1">
                                            {option.label}
                                        </span>
                                        <span className="ml-3 tabular-nums text-muted-foreground">
                                            {counts[option.value]}
                                        </span>
                                    </DropdownMenuCheckboxItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    disabled={statuses.length === 0}
                                    onSelect={() => setStatuses([])}
                                >
                                    Show all
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    aria-label={`Sort: ${SHARE_LIST_SORTS.find((option) => option.value === sort)?.label}`}
                                    title="Sort"
                                >
                                    <ArrowDownUp className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                                <DropdownMenuRadioGroup
                                    value={sort}
                                    onValueChange={(value) =>
                                        setSort(value as ShareListSort)
                                    }
                                >
                                    {SHARE_LIST_SORTS.map((option) => (
                                        <DropdownMenuRadioItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1">
                {rows.length === 0 ? (
                    <EmptyList>
                        No shared links yet. Use Share once on an item, or share
                        a secret that isn&apos;t in your vault.
                    </EmptyList>
                ) : visible.length === 0 ? (
                    <EmptyList>No links match.</EmptyList>
                ) : (
                    <Virtuoso
                        style={{ height: "100%" }}
                        data={visible}
                        computeItemKey={(_index, row) => row.record.ID}
                        itemContent={(_index, row) => (
                            <div className="mx-auto w-full max-w-3xl px-4 py-1 sm:px-6 lg:px-8">
                                <SharedLinkRow
                                    row={row}
                                    busy={busyId === row.record.ID}
                                    canOpenItem={
                                        !!onOpenItem &&
                                        credentialNames.has(
                                            row.record.CredentialID,
                                        )
                                    }
                                    onOpenItem={() =>
                                        onOpenItem?.(row.record.CredentialID)
                                    }
                                    onRevoke={() => requestRevoke(row)}
                                    onRemove={() => requestRemove(row)}
                                />
                            </div>
                        )}
                        components={{
                            Header: () => <div className="h-3" />,
                            Footer: () => <div className="h-6" />,
                        }}
                    />
                )}
            </div>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Share server</DialogTitle>
                        <DialogDescription>
                            {backend.allowCustomServer
                                ? "Use the Cryptex Vault server with Online Services, or your own share server."
                                : "This app creates links on the server that hosts it. A self-hosted server needs a creation token."}
                        </DialogDescription>
                    </DialogHeader>
                    <ShareServerSettingsForm
                        settings={settings}
                        allowCustomServer={backend.allowCustomServer}
                        defaultOrigin={backend.deps.defaultOrigin}
                        onSave={async (next) => {
                            await backend.saveSettings(next);
                            setSettingsOpen(false);
                            toast.success("Share server saved.");
                        }}
                    />
                </DialogContent>
            </Dialog>
        </main>
    );
}

function EmptyList({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6 lg:px-8">
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {children}
            </div>
        </div>
    );
}

function SharedLinkRow({
    row,
    busy,
    canOpenItem,
    onOpenItem,
    onRevoke,
    onRemove,
}: {
    row: ShareListRow;
    busy: boolean;
    canOpenItem: boolean;
    onOpenItem: () => void;
    onRevoke: () => void;
    onRemove: () => void;
}) {
    const { record, status, name, host } = row;
    return (
        <div
            className="flex items-center gap-3 rounded-lg border border-border p-3"
            aria-label={`${name}, ${SHARE_STATUS_LABELS[status]}`}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {record.Passphrase ? (
                        <Lock
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label="Passphrase protected"
                        />
                    ) : null}
                    <Badge
                        variant="outline"
                        className={cn(
                            "shrink-0 text-[11px] font-medium",
                            STATUS_CLASSES[status],
                        )}
                    >
                        {SHARE_STATUS_LABELS[status]}
                    </Badge>
                </div>
                <p className="mt-0.5 flex min-w-0 gap-3 text-xs text-muted-foreground">
                    <span className="shrink-0">
                        {describeTiming(record, status)}
                    </span>
                    <span className="truncate">{host}</span>
                </p>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={busy}
                        aria-label={`Actions for ${name}`}
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {status === "active" ? (
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={onRevoke}
                        >
                            <XCircle className="mr-2 h-4 w-4" />
                            Revoke link
                        </DropdownMenuItem>
                    ) : null}
                    {canOpenItem ? (
                        <DropdownMenuItem onSelect={onOpenItem}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open item
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={onRemove}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove from list
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
