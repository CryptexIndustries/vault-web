import { useEffect, useRef, useState } from "react";
import {
    Search,
    Plus,
    Grid3X3,
    List,
    Key,
    Globe,
    Clock,
    MoreHorizontal,
    Copy,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VaultCredential } from "@/app_lib/vault-utils/vault";
import { cn } from "@/lib/utils";
import { CredentialConstants } from "@/utils/consts";

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
}

const MAX_VISIBLE_TAGS = 2;

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
}: CredentialsListProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [isMobile, setIsMobile] = useState(false);
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

    return (
        <div className="bg-background flex min-w-0 flex-1 flex-col">
            {/* Header */}
            <div className="border-border border-b p-2 sm:p-3">
                {/* Search */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <Button
                        onClick={onAddNew}
                        className="w-full gap-2 inline-flex sm:w-auto"
                        size="sm"
                    >
                        <Plus className="h-4 w-4" />
                        <span>Add New</span>
                    </Button>
                    <div className="relative flex-1">
                        <Search className="text-muted-foreground absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2" />
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
                            <div className="border-border flex items-center overflow-hidden rounded-md border">
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
                    <p className="text-muted-foreground hidden text-xs sm:block">
                        Press <kbd className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">?</kbd> for shortcuts
                    </p>
                    <p className="text-muted-foreground text-xs sm:text-sm">
                        {filteredCredentials.length} rows
                    </p>
                </div>
            </div>

            {/* Credentials list */}
            {effectiveViewMode === "list" ? (
                <div className="min-h-0 flex-1">
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: "100%" }}
                        className="min-w-0"
                        data={filteredCredentials}
                        computeItemKey={(_index, credential) => credential.ID}
                        itemContent={(_index, credential) => {
                            const tags = parseTags(credential.Tags);
                            const visibleTags = tags.slice(
                                0,
                                MAX_VISIBLE_TAGS,
                            );
                            const hiddenTagCount = Math.max(
                                tags.length -
                                    MAX_VISIBLE_TAGS,
                                0,
                            );
                            return (
                                <div className="px-1 sm:px-2 first:pt-3 sm:first:pt-2">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => onSelect(credential)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
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
                                        {/* Favicon */}
                                        <div className="bg-muted flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10">
                                            <Globe className="text-muted-foreground h-4 w-4 sm:h-5 sm:w-5" />
                                        </div>

                                        {/* Content */}
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex min-w-0 items-center gap-2">
                                                <span className="text-foreground block min-w-0 truncate text-sm font-medium sm:text-base">
                                                    {credential.Name}
                                                </span>
                                                {credential.TOTP && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-primary/20 bg-primary/10 text-primary h-5 flex-shrink-0 px-1.5 py-0 text-xs"
                                                    >
                                                        <Key className="mr-1 h-3 w-3" />
                                                        <span className="hidden sm:inline">
                                                            2FA
                                                        </span>
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground truncate text-xs sm:text-sm">
                                                {credential.Username}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
                                                {visibleTags.map((tag) => (
                                                    <Badge
                                                        key={tag}
                                                        variant="outline"
                                                        className="border-border/70 bg-muted/60 max-w-[110px] text-xs text-muted-foreground"
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
                                            <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs sm:hidden">
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
                                                    className="border-border/70 bg-muted/60 max-w-[120px] text-xs text-muted-foreground"
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
                                        <div className="text-muted-foreground hidden flex-shrink-0 items-center gap-1 text-xs sm:flex">
                                            <Clock className="h-3 w-3" />
                                            {formatDate(
                                                credential.DateModifiedTimestamp ||
                                                    credential.DateCreatedTimestamp,
                                            )}
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                asChild
                                                onClick={(e) => e.stopPropagation()}
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
                                                        onCopyUsername(credential);
                                                    }}
                                                >
                                                    <Copy className="mr-2 h-4 w-4" />
                                                    Copy username
                                                </DropdownMenuItem>
                                                {credential.Password && (
                                                    <DropdownMenuItem
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onCopyPassword(credential);
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
                                                            onCopyTOTP(credential);
                                                        }}
                                                    >
                                                        <Key className="mr-2 h-4 w-4" />
                                                        Copy OTP
                                                    </DropdownMenuItem>
                                                )}
                                                {credential.URL &&
                                                    URL.canParse(credential.URL) && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onOpenUrl(credential);
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
                                                        onDeleteCredential(credential);
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
                </div>
            ) : (
                <div className="min-w-0 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4">
                        {filteredCredentials.map((credential) => {
                            const tags = parseTags(credential.Tags);
                            const visibleTags = (
                                tags
                            ).slice(0, MAX_VISIBLE_TAGS);
                            const hiddenTagCount = Math.max(
                                tags.length -
                                    MAX_VISIBLE_TAGS,
                                0,
                            );
                            return (
                                <div
                                    key={credential.ID}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onSelect(credential)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
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
                            <div
                                className="bg-muted mb-3 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                            >
                                <Globe
                                    className="text-muted-foreground h-5 w-5"
                                />
                            </div>

                            {/* Content */}
                            <div className="min-w-0">
                                <div className="mb-1 flex min-w-0 items-center gap-2">
                                    <span className="text-foreground block min-w-0 flex-1 truncate text-sm font-medium sm:text-base">
                                        {credential.Name}
                                    </span>
                                    {credential.TOTP && (
                                        <Badge
                                            variant="outline"
                                            className="border-primary/20 bg-primary/10 text-primary h-5 flex-shrink-0 px-1.5 py-0 text-xs"
                                        >
                                            <Key className="mr-1 h-3 w-3" />
                                            <span className="hidden sm:inline">
                                                2FA
                                            </span>
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-muted-foreground truncate text-xs sm:text-sm">
                                    {credential.Username}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {visibleTags.map((tag) => (
                                        <Badge
                                            key={tag}
                                            variant="outline"
                                            className="border-border/70 bg-muted/60 max-w-[120px] text-xs text-muted-foreground"
                                        >
                                            <span className="truncate">
                                                {tag}
                                            </span>
                                        </Badge>
                                    ))}
                                    {hiddenTagCount > 0 && (
                                        <Badge variant="secondary" className="text-xs">
                                            +{hiddenTagCount}
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            {/* List view extras */}
                                </div>
                            );
                        })}

                    {filteredCredentials.length === 0 && (
                        <div className="py-12 text-center">
                            <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                                <Search className="text-muted-foreground h-6 w-6" />
                            </div>
                            <p className="text-muted-foreground">
                                No credentials found
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Try a different search term
                            </p>
                        </div>
                    )}
                </div>
                </div>
            )}
        </div>
    );
}
