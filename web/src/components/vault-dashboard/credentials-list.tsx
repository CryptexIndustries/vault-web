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
    Pencil,
    Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
} from "@/app_lib/vault-utils/vault";
import { cn } from "@/lib/utils";
import { CredentialConstants } from "@/utils/consts";
import { normalizeCredentialUrl } from "@/utils/credential-url";

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
    onCreateDirectory: (name: string) => Promise<void> | void;
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
                    <span className="font-medium text-foreground">+ Add New</span>{" "}
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

function parseTags(tags?: string): string[] {
    if (!tags) return [];
    return tags
        .split(CredentialConstants.TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

type ParsedSearchQuery = {
    tagTerms: string[];
    noteTerms: string[];
    freeText: string;
};

function parseIdentifierValues(rawValue: string): string[] {
    const values: string[] = [];
    const valueRegex = /"([^"]*)"|([^,]+)/g;
    let match: RegExpExecArray | null;

    while ((match = valueRegex.exec(rawValue)) !== null) {
        const quotedValue = match[1];
        const plainValue = match[2];
        const value = (quotedValue ?? plainValue ?? "").trim();
        if (value) {
            values.push(value);
        }
    }

    return values;
}

function parseSearchQuery(query: string): ParsedSearchQuery {
    const parsed: ParsedSearchQuery = {
        tagTerms: [],
        noteTerms: [],
        freeText: query.trim(),
    };

    const identifierRegex =
        /(^|\s)(tag|note):((?:"[^"]*"|[^,\s]+)(?:\s*,\s*(?:"[^"]*"|[^,\s]+))*)/g;
    let remaining = query;

    remaining = remaining.replace(
        identifierRegex,
        (_fullMatch, leadingWhitespace, identifier, rawValue) => {
            const values = parseIdentifierValues(String(rawValue));
            if (identifier === "tag") {
                parsed.tagTerms.push(...values);
            } else if (identifier === "note") {
                parsed.noteTerms.push(...values);
            }
            return String(leadingWhitespace ?? "");
        },
    );

    parsed.freeText = remaining.trim().replace(/\s+/g, " ");
    return parsed;
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
    const [directoryName, setDirectoryName] = useState("");
    const [directoryError, setDirectoryError] = useState("");
    const [directoryManagerError, setDirectoryManagerError] = useState("");
    const [isSavingDirectory, setIsSavingDirectory] = useState(false);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 639px)");
        const updateIsMobile = () => setIsMobile(mediaQuery.matches);

        updateIsMobile();
        mediaQuery.addEventListener("change", updateIsMobile);
        return () => mediaQuery.removeEventListener("change", updateIsMobile);
    }, []);

    const parsedSearchQuery = parseSearchQuery(searchQuery);
    const hasIdentifierFilters =
        parsedSearchQuery.tagTerms.length > 0 ||
        parsedSearchQuery.noteTerms.length > 0;

    const filteredCredentials = credentials.filter((credential) => {
        const tags = parseTags(credential.Tags);
        const searchableFields = [
            credential.Name,
            credential.Username,
            credential.Notes,
            ...tags,
        ];

        const matchesFreeText =
            parsedSearchQuery.freeText.length === 0
                ? true
                : searchableFields.some((field) =>
                      field.includes(parsedSearchQuery.freeText),
                  );

        if (!hasIdentifierFilters) {
            return matchesFreeText;
        }

        const matchesTags =
            parsedSearchQuery.tagTerms.length === 0
                ? true
                : parsedSearchQuery.tagTerms.some((tagTerm) =>
                      tags.some((tag) => tag.includes(tagTerm)),
                  );

        const matchesNotes =
            parsedSearchQuery.noteTerms.length === 0
                ? true
                : parsedSearchQuery.noteTerms.some((noteTerm) =>
                      credential.Notes.includes(noteTerm),
                  );

        return matchesTags && matchesNotes && matchesFreeText;
    });
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
        const input = searchInputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [searchFocusRequestToken]);

    useEffect(() => {
        setSelectedIDs(new Set());
    }, [selectedDirectoryID]);

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
        setDirectoryName(directory?.Name ?? "");
        setDirectoryError("");
        setDirectoryEditorOpen(true);
    };

    const saveDirectory = async () => {
        setDirectoryError("");
        setIsSavingDirectory(true);
        try {
            if (editingDirectory) {
                await onRenameDirectory(editingDirectory.ID, directoryName);
            } else {
                await onCreateDirectory(directoryName);
            }
            setDirectoryEditorOpen(false);
        } catch (error: unknown) {
            setDirectoryError(
                error instanceof Error
                    ? error.message
                    : "Failed to save directory",
            );
        } finally {
            setIsSavingDirectory(false);
        }
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
                                onSelect={() =>
                                    setTimeout(
                                        () => openDirectoryEditor(null),
                                        0,
                                    )
                                }
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                New directory
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    setTimeout(() => {
                                        setDirectoryManagerError("");
                                        setDirectoryManagerOpen(true);
                                    }, 0)
                                }
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
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={searchInputRef}
                            placeholder='Search (e.g. tag:"work","urgent" or note:"shared account")'
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.blur();
                                }
                            }}
                            className="bg-card pl-9 text-sm"
                        />
                    </div>
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
                                                <Globe className="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
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
                                                </div>
                                                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                                                    {credential.Username}
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
                                            <Globe className="h-5 w-5 text-muted-foreground" />
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
                                            </div>
                                            <p className="truncate text-xs text-muted-foreground sm:text-sm">
                                                {credential.Username}
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

            <Dialog
                open={directoryEditorOpen}
                onOpenChange={setDirectoryEditorOpen}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {editingDirectory
                                ? "Rename directory"
                                : "Create directory"}
                        </DialogTitle>
                        <DialogDescription>
                            Directory names must be unique and 1–100 characters.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="credential-list-directory-name">
                            Name
                        </Label>
                        <Input
                            id="credential-list-directory-name"
                            value={directoryName}
                            maxLength={100}
                            autoFocus
                            disabled={isSavingDirectory}
                            onChange={(event) => {
                                setDirectoryName(event.target.value);
                                setDirectoryError("");
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveDirectory();
                                }
                            }}
                        />
                        {directoryError ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {directoryError}
                            </p>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={isSavingDirectory}
                            onClick={() => setDirectoryEditorOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={isSavingDirectory}
                            onClick={() => void saveDirectory()}
                        >
                            {isSavingDirectory ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={directoryManagerOpen}
                onOpenChange={setDirectoryManagerOpen}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manage directories</DialogTitle>
                        <DialogDescription>
                            Rename or delete directories. Root is always
                            available and cannot be changed.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <FolderRoot className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm font-medium">
                                Root
                            </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {credentialCounts.root ?? 0}
                        </span>
                    </div>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                        {sortedDirectories.length === 0 ? (
                            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                                No directories yet.
                            </div>
                        ) : (
                            sortedDirectories.map((directory) => (
                                <div
                                    key={directory.ID}
                                    className="flex items-center gap-3 rounded-md border p-3"
                                >
                                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {directory.Name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {credentialCounts[directory.ID] ?? 0}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        aria-label={`Rename ${directory.Name}`}
                                        onClick={() => {
                                            setDirectoryManagerOpen(false);
                                            setTimeout(
                                                () =>
                                                    openDirectoryEditor(
                                                        directory,
                                                    ),
                                                0,
                                            );
                                        }}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        aria-label={`Delete ${directory.Name}`}
                                        onClick={() => {
                                            setDirectoryManagerError("");
                                            void Promise.resolve(
                                                onDeleteDirectory(directory.ID),
                                            ).catch((error: unknown) =>
                                                setDirectoryManagerError(
                                                    error instanceof Error
                                                        ? error.message
                                                        : "Failed to delete directory",
                                                ),
                                            );
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                    {directoryManagerError ? (
                        <p className="text-sm text-destructive" role="alert">
                            {directoryManagerError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDirectoryManagerOpen(false)}
                        >
                            Close
                        </Button>
                        <Button
                            onClick={() => {
                                setDirectoryManagerOpen(false);
                                setTimeout(() => openDirectoryEditor(null), 0);
                            }}
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            New directory
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
