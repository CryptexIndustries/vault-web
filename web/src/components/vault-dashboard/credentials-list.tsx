import { useEffect, useRef, useState } from "react";
import {
    Search,
    Plus,
    Grid3X3,
    List,
    Key,
    Inbox,
    Globe,
    Clock,
    MoreHorizontal,
    Copy,
    Trash2,
    ChevronDown,
    Folder,
    FolderRoot,
    LayoutList,
    Settings2,
    Fingerprint,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Directory,
    sortDirectories,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { cn } from "@/lib/utils";
import { normalizeCredentialUrl } from "@/utils/credential-url";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import {
    CredentialSearch,
    credentialMatchesSearch,
    parseTags,
} from "@/components/vault-dashboard/credential-search";
import {
    DirectoryEditorDialog,
    DirectoryManagerDialog,
} from "@/components/vault-dashboard/directory-dialogs";

interface CredentialsListProps {
    credentials: VaultCredential[];
    selectedId: string | null;
    onSelect: (credential: VaultCredential) => void;
    onAddNew: () => void;
    onCopyUsername: (credential: VaultCredential) => void;
    onCopyPassword: (credential: VaultCredential) => void;
    onCopyTOTP: (credential: VaultCredential) => void;
    onOpenUrl: (credential: VaultCredential) => void;
    onDeleteCredential: (credential: VaultCredential) => void;
    onFilteredCredentialsChange?: (credentials: VaultCredential[]) => void;
    searchFocusRequestToken?: number;
    directories: Directory[];
    credentialCounts: Record<string, number>;
    selectedDirectoryID: string;
    onSelectDirectory: (directoryID: string) => void;
    onCreateDirectory: (name: string) => Promise<string | void> | string | void;
    onRenameDirectory: (
        directoryID: string,
        name: string,
    ) => Promise<void> | void;
    onDeleteDirectory: (directoryID: string) => Promise<void> | void;
    onMoveCredentials: (
        credentialIDs: string[],
        directoryID: string,
    ) => Promise<void> | void;
}

const MAX_VISIBLE_TAGS = 2;

function VaultEmptyState() {
    return (
        <div className="flex min-h-full items-center justify-center p-6">
            <div className="w-full max-w-sm text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Inbox className="h-7 w-7" />
                </div>
                <p className="text-lg font-semibold text-foreground">
                    There are no credentials in this directory.
                </p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                    You can add a new credential by clicking the{" "}
                    <span className="font-medium text-foreground">
                        + Add New
                    </span>{" "}
                    button.
                </p>
            </div>
        </div>
    );
}

function SearchEmptyState() {
    return (
        <div className="flex min-h-full items-center justify-center p-6 text-center">
            <div>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">No credentials found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    Try a different search term
                </p>
            </div>
        </div>
    );
}

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
}

export function CredentialsList({
    credentials,
    selectedId,
    onSelect,
    onAddNew,
    onCopyUsername,
    onCopyPassword,
    onCopyTOTP,
    onOpenUrl,
    onDeleteCredential,
    onFilteredCredentialsChange,
    searchFocusRequestToken = 0,
    directories,
    credentialCounts,
    selectedDirectoryID,
    onSelectDirectory,
    onCreateDirectory,
    onRenameDirectory,
    onDeleteDirectory,
    onMoveCredentials,
}: CredentialsListProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [isMobile, setIsMobile] = useState(false);
    const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
    const [directoryEditorOpen, setDirectoryEditorOpen] = useState(false);
    const [directoryManagerOpen, setDirectoryManagerOpen] = useState(false);
    const [editingDirectory, setEditingDirectory] = useState<Directory | null>(
        null,
    );
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 639px)");
        const updateIsMobile = () => setIsMobile(mediaQuery.matches);

        updateIsMobile();
        mediaQuery.addEventListener("change", updateIsMobile);
        return () => mediaQuery.removeEventListener("change", updateIsMobile);
    }, []);

    const filteredCredentials = credentials.filter((credential) =>
        credentialMatchesSearch(credential, searchQuery),
    );
    const effectiveViewMode = isMobile ? "list" : viewMode;

    useEffect(() => {
        onFilteredCredentialsChange?.(filteredCredentials);
    }, [filteredCredentials, onFilteredCredentialsChange]);

    useEffect(() => {
        if (!selectedId || effectiveViewMode !== "list") return;
        const selectedIndex = filteredCredentials.findIndex(
            (credential) => credential.ID === selectedId,
        );
        if (selectedIndex < 0) return;

        virtuosoRef.current?.scrollToIndex({
            index: selectedIndex,
            align: "center",
            behavior: "smooth",
        });
    }, [effectiveViewMode, filteredCredentials, selectedId]);

    useEffect(() => {
        setSelectedIDs(new Set());
    }, [selectedDirectoryID]);

    const toggleCredentialChecked = (credentialID: string) => {
        setSelectedIDs((previous) => {
            const next = new Set(previous);
            if (next.has(credentialID)) {
                next.delete(credentialID);
            } else {
                next.add(credentialID);
            }
            return next;
        });
    };

    useEffect(() => {
        if (!selectedId) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== " ") return;
            if (
                event.defaultPrevented ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
            ) {
                return;
            }
            if (!(event.target instanceof HTMLElement)) return;
            if (
                event.target.closest(
                    'input, textarea, select, [contenteditable="true"], [role="textbox"], button, [role="menuitem"], [role="option"], [role="dialog"]',
                )
            ) {
                return;
            }

            event.preventDefault();
            setSelectedIDs((previous) => {
                const next = new Set(previous);
                if (next.has(selectedId)) {
                    next.delete(selectedId);
                } else {
                    next.add(selectedId);
                }
                return next;
            });
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selectedId]);

    const sortedDirectories = sortDirectories(directories);
    const selectedDirectory = directories.find(
        (directory) => directory.ID === selectedDirectoryID,
    );
    const selectedDirectoryLabel =
        selectedDirectoryID === "all"
            ? "All credentials"
            : selectedDirectoryID === ""
              ? "Root"
              : (selectedDirectory?.Name ?? "All credentials");
    const selectedDirectoryCount =
        selectedDirectoryID === "all"
            ? (credentialCounts.all ?? 0)
            : selectedDirectoryID === ""
              ? (credentialCounts.root ?? 0)
              : (credentialCounts[selectedDirectoryID] ?? 0);

    const openDirectoryEditor = (directory: Directory | null) => {
        setEditingDirectory(directory);
        setDirectoryEditorOpen(true);
    };

    return (
        <div className="flex min-w-0 flex-1 flex-col bg-background">
            {/* Header */}
            <div className="border-b border-border p-2 sm:p-3">
                {/* Search */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-between gap-2 bg-card sm:w-52"
                                aria-label="Browse directories"
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    {selectedDirectoryID === "all" ? (
                                        <LayoutList className="h-4 w-4 shrink-0" />
                                    ) : selectedDirectoryID === "" ? (
                                        <FolderRoot className="h-4 w-4 shrink-0" />
                                    ) : (
                                        <Folder className="h-4 w-4 shrink-0" />
                                    )}
                                    <span className="truncate">
                                        {selectedDirectoryLabel}
                                    </span>
                                </span>
                                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                                    <span className="text-xs">
                                        {selectedDirectoryCount}
                                    </span>
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-64"
                            onCloseAutoFocus={(event) => event.preventDefault()}
                        >
                            <DropdownMenuItem
                                className={cn(
                                    selectedDirectoryID === "all" &&
                                        "bg-accent",
                                )}
                                onSelect={() => onSelectDirectory("all")}
                            >
                                <LayoutList className="mr-2 h-4 w-4" />
                                <span className="flex-1">All credentials</span>
                                <span className="text-xs text-muted-foreground">
                                    {credentialCounts.all ?? 0}
                                </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className={cn(
                                    selectedDirectoryID === "" && "bg-accent",
                                )}
                                onSelect={() => onSelectDirectory("")}
                            >
                                <FolderRoot className="mr-2 h-4 w-4" />
                                <span className="flex-1">Root</span>
                                <span className="text-xs text-muted-foreground">
                                    {credentialCounts.root ?? 0}
                                </span>
                            </DropdownMenuItem>
                            {sortedDirectories.length > 0 ? (
                                <DropdownMenuSeparator />
                            ) : null}
                            {sortedDirectories.map((directory) => (
                                <DropdownMenuItem
                                    key={directory.ID}
                                    className={cn(
                                        selectedDirectoryID === directory.ID &&
                                            "bg-accent",
                                    )}
                                    onSelect={() =>
                                        onSelectDirectory(directory.ID)
                                    }
                                >
                                    <Folder className="mr-2 h-4 w-4" />
                                    <span className="flex-1 truncate">
                                        {directory.Name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {credentialCounts[directory.ID] ?? 0}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onSelect={() => openDirectoryEditor(null)}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                New directory
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => setDirectoryManagerOpen(true)}
                            >
                                <Settings2 className="mr-2 h-4 w-4" />
                                Manage directories
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        onClick={onAddNew}
                        className="inline-flex w-full gap-2 sm:w-auto"
                        size="sm"
                    >
                        <Plus className="h-4 w-4" />
                        <span>Add New</span>
                    </Button>
                    <CredentialSearch
                        value={searchQuery}
                        onChange={setSearchQuery}
                        focusRequestToken={searchFocusRequestToken}
                    />
                    <div className="flex items-center gap-2">
                        {!isMobile && (
                            <div className="flex items-center overflow-hidden rounded-md border border-border">
                                <Button
                                    variant={
                                        viewMode === "list"
                                            ? "secondary"
                                            : "ghost"
                                    }
                                    size="icon"
                                    onClick={() => setViewMode("list")}
                                    className="rounded-none"
                                    aria-label="List view"
                                >
                                    <List className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant={
                                        viewMode === "grid"
                                            ? "secondary"
                                            : "ghost"
                                    }
                                    size="icon"
                                    onClick={() => setViewMode("grid")}
                                    className="rounded-none"
                                    aria-label="Grid view"
                                >
                                    <Grid3X3 className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-between px-2 sm:pt-2">
                    <p className="hidden text-xs text-muted-foreground sm:block">
                        Press{" "}
                        <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                            ?
                        </kbd>{" "}
                        for shortcuts
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        {filteredCredentials.length} rows
                    </p>
                </div>
                {selectedIDs.size > 0 ? (
                    <div className="mt-2 flex items-center gap-2 rounded-md bg-muted p-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setSelectedIDs(
                                    new Set(
                                        filteredCredentials.map(
                                            (credential) => credential.ID,
                                        ),
                                    ),
                                )
                            }
                        >
                            Select All
                        </Button>
                        <span className="text-sm text-foreground">
                            {selectedIDs.size} selected
                        </span>
                        <Select
                            onValueChange={(value) => {
                                void Promise.resolve(
                                    onMoveCredentials(
                                        Array.from(selectedIDs),
                                        value === "root" ? "" : value,
                                    ),
                                ).then(() => setSelectedIDs(new Set()));
                            }}
                        >
                            <SelectTrigger
                                className="ml-auto w-48"
                                aria-label="Move to directory"
                            >
                                <SelectValue placeholder="Move to directory" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="root">Root</SelectItem>
                                {sortedDirectories.map((directory) => (
                                    <SelectItem
                                        key={directory.ID}
                                        value={directory.ID}
                                    >
                                        {directory.Name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>

            {/* Credentials list */}
            {effectiveViewMode === "list" ? (
                <div className="min-h-0 flex-1">
                    {credentials.length === 0 ? (
                        <VaultEmptyState />
                    ) : filteredCredentials.length === 0 ? (
                        <SearchEmptyState />
                    ) : (
                        <Virtuoso
                            ref={virtuosoRef}
                            style={{ height: "100%" }}
                            className="min-w-0"
                            data={filteredCredentials}
                            computeItemKey={(_index, credential) =>
                                credential.ID
                            }
                            itemContent={(_index, credential) => {
                                const tags = parseTags(credential.Tags);
                                const visibleTags = tags.slice(
                                    0,
                                    MAX_VISIBLE_TAGS,
                                );
                                const hiddenTagCount = Math.max(
                                    tags.length - MAX_VISIBLE_TAGS,
                                    0,
                                );
                                return (
                                    <div className="px-1 first:pt-3 sm:px-2 sm:first:pt-2">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => onSelect(credential)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    onSelect(credential);
                                                } else if (e.key === " ") {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    toggleCredentialChecked(
                                                        credential.ID,
                                                    );
                                                }
                                            }}
                                            className={cn(
                                                "w-full min-w-0 cursor-pointer text-left transition-all",
                                                "hover:border-primary/50 flex items-start gap-2 rounded-lg border p-2.5 sm:items-center sm:gap-4 sm:p-3",
                                                selectedId === credential.ID
                                                    ? "bg-primary/5 border-primary"
                                                    : "bg-card border-border",
                                            )}
                                        >
                                            <Checkbox
                                                checked={selectedIDs.has(
                                                    credential.ID,
                                                )}
                                                aria-label={`Select ${credential.Name}`}
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onCheckedChange={(checked) => {
                                                    setSelectedIDs(
                                                        (previous) => {
                                                            const next =
                                                                new Set(
                                                                    previous,
                                                                );
                                                            if (checked) {
                                                                next.add(
                                                                    credential.ID,
                                                                );
                                                            } else {
                                                                next.delete(
                                                                    credential.ID,
                                                                );
                                                            }
                                                            return next;
                                                        },
                                                    );
                                                }}
                                            />
                                            {/* Favicon */}
                                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted sm:h-10 sm:w-10">
                                                {credential.Type ===
                                                ItemType.Passkey ? (
                                                    <Fingerprint className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
                                                ) : (
                                                    <Globe className="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
                                                )}
                                            </div>

                                            {/* Content */}
                                            <div className="min-w-0 flex-1">
                                                <div className="mb-1 flex min-w-0 items-center gap-2">
                                                    <span className="block min-w-0 truncate text-sm font-medium text-foreground sm:text-base">
                                                        {credential.Name}
                                                    </span>
                                                    {credential.TOTP && (
                                                        <Badge
                                                            variant="outline"
                                                            className="h-5 flex-shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-xs text-primary"
                                                        >
                                                            <Key className="mr-1 h-3 w-3" />
                                                            <span className="hidden sm:inline">
                                                                2FA
                                                            </span>
                                                        </Badge>
                                                    )}
                                                    {credential.Passkey && (
                                                        <Badge
                                                            variant="outline"
                                                            className="h-5 flex-shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-xs text-primary"
                                                        >
                                                            <Fingerprint className="mr-1 h-3 w-3" />
                                                            Passkey
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                                                    {credential.Type ===
                                                    ItemType.Passkey
                                                        ? credential.Passkey
                                                              ?.UserDisplayName ||
                                                          credential.Passkey
                                                              ?.UserName ||
                                                          credential.URL
                                                        : credential.Username}
                                                </p>
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
                                                    {visibleTags.map((tag) => (
                                                        <Badge
                                                            key={tag}
                                                            variant="outline"
                                                            className="max-w-[110px] border-border/70 bg-muted/60 text-xs text-muted-foreground"
                                                        >
                                                            <span className="truncate">
                                                                {tag}
                                                            </span>
                                                        </Badge>
                                                    ))}
                                                    {hiddenTagCount > 0 && (
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-xs"
                                                        >
                                                            +{hiddenTagCount}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
                                                    <Clock className="h-3 w-3" />
                                                    {formatDate(
                                                        credential.DateModifiedTimestamp ||
                                                            credential.DateCreatedTimestamp,
                                                    )}
                                                </div>
                                            </div>

                                            {/* List view extras */}
                                            <div className="hidden flex-shrink-0 flex-wrap items-center gap-1.5 md:flex">
                                                {visibleTags.map((tag) => (
                                                    <Badge
                                                        key={tag}
                                                        variant="outline"
                                                        className="max-w-[120px] border-border/70 bg-muted/60 text-xs text-muted-foreground"
                                                    >
                                                        <span className="truncate">
                                                            {tag}
                                                        </span>
                                                    </Badge>
                                                ))}
                                                {hiddenTagCount > 0 && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-xs"
                                                    >
                                                        +{hiddenTagCount}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="hidden flex-shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                                                <Clock className="h-3 w-3" />
                                                {formatDate(
                                                    credential.DateModifiedTimestamp ||
                                                        credential.DateCreatedTimestamp,
                                                )}
                                            </div>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger
                                                    asChild
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="mt-0.5 h-8 w-8 flex-shrink-0 sm:mt-0 sm:h-9 sm:w-9"
                                                        aria-label={`Actions for ${credential.Name}`}
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onCopyUsername(
                                                                credential,
                                                            );
                                                        }}
                                                    >
                                                        <Copy className="mr-2 h-4 w-4" />
                                                        Copy username
                                                    </DropdownMenuItem>
                                                    {credential.Password && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onCopyPassword(
                                                                    credential,
                                                                );
                                                            }}
                                                        >
                                                            <Key className="mr-2 h-4 w-4" />
                                                            Copy password
                                                        </DropdownMenuItem>
                                                    )}
                                                    {credential.TOTP && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onCopyTOTP(
                                                                    credential,
                                                                );
                                                            }}
                                                        >
                                                            <Key className="mr-2 h-4 w-4" />
                                                            Copy OTP
                                                        </DropdownMenuItem>
                                                    )}
                                                    {normalizeCredentialUrl(
                                                        credential.URL,
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onOpenUrl(
                                                                    credential,
                                                                );
                                                            }}
                                                        >
                                                            <Globe className="mr-2 h-4 w-4" />
                                                            Open URL
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        className="text-destructive"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteCredential(
                                                                credential,
                                                            );
                                                        }}
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    )}
                </div>
            ) : (
                <div className="min-w-0 flex-1 overflow-y-auto">
                    {credentials.length === 0 ? (
                        <VaultEmptyState />
                    ) : filteredCredentials.length === 0 ? (
                        <SearchEmptyState />
                    ) : (
                        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4">
                            {filteredCredentials.map((credential) => {
                                const tags = parseTags(credential.Tags);
                                const visibleTags = tags.slice(
                                    0,
                                    MAX_VISIBLE_TAGS,
                                );
                                const hiddenTagCount = Math.max(
                                    tags.length - MAX_VISIBLE_TAGS,
                                    0,
                                );
                                return (
                                    <div
                                        key={credential.ID}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => onSelect(credential)}
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === "Enter" ||
                                                e.key === " "
                                            ) {
                                                e.preventDefault();
                                                onSelect(credential);
                                            }
                                        }}
                                        className={cn(
                                            "w-full min-w-0 cursor-pointer text-left transition-all",
                                            "hover:border-primary/50 rounded-lg border p-3 sm:p-4",
                                            selectedId === credential.ID
                                                ? "bg-primary/5 border-primary"
                                                : "bg-card border-border",
                                        )}
                                    >
                                        {/* Favicon */}
                                        <div className="mb-3 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                                            {credential.Type ===
                                            ItemType.Passkey ? (
                                                <Fingerprint className="h-5 w-5 text-primary" />
                                            ) : (
                                                <Globe className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="min-w-0">
                                            <div className="mb-1 flex min-w-0 items-center gap-2">
                                                <span className="block min-w-0 flex-1 truncate text-sm font-medium text-foreground sm:text-base">
                                                    {credential.Name}
                                                </span>
                                                {credential.TOTP && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-5 flex-shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-xs text-primary"
                                                    >
                                                        <Key className="mr-1 h-3 w-3" />
                                                        <span className="hidden sm:inline">
                                                            2FA
                                                        </span>
                                                    </Badge>
                                                )}
                                                {credential.Passkey && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-5 flex-shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-xs text-primary"
                                                    >
                                                        <Fingerprint className="mr-1 h-3 w-3" />
                                                        Passkey
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="truncate text-xs text-muted-foreground sm:text-sm">
                                                {credential.Type ===
                                                ItemType.Passkey
                                                    ? credential.Passkey
                                                          ?.UserDisplayName ||
                                                      credential.Passkey
                                                          ?.UserName ||
                                                      credential.URL
                                                    : credential.Username}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                {visibleTags.map((tag) => (
                                                    <Badge
                                                        key={tag}
                                                        variant="outline"
                                                        className="max-w-[120px] border-border/70 bg-muted/60 text-xs text-muted-foreground"
                                                    >
                                                        <span className="truncate">
                                                            {tag}
                                                        </span>
                                                    </Badge>
                                                ))}
                                                {hiddenTagCount > 0 && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-xs"
                                                    >
                                                        +{hiddenTagCount}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>

                                        {/* List view extras */}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <DirectoryEditorDialog
                open={directoryEditorOpen}
                onOpenChange={setDirectoryEditorOpen}
                directory={editingDirectory}
                onCreate={onCreateDirectory}
                onRename={onRenameDirectory}
            />
            <DirectoryManagerDialog
                open={directoryManagerOpen}
                onOpenChange={setDirectoryManagerOpen}
                directories={directories}
                credentialCounts={credentialCounts}
                onDelete={onDeleteDirectory}
                onEditDirectory={openDirectoryEditor}
                onCreateDirectory={() => openDirectoryEditor(null)}
            />
        </div>
    );
}
