import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronDown,
    ChevronRight,
    Download,
    Filter,
    RefreshCw,
    Search,
    Trash2,
    X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    LogGroup,
    LogLevel,
    type LogEntry,
    vaultLogger,
} from "@/utils/logging";

const levelColors: Record<LogLevel, { row: string; badge: string; text: string }> = {
    [LogLevel.Debug]: {
        row: "bg-slate-50",
        badge: "bg-slate-200 text-slate-700",
        text: "text-slate-700",
    },
    [LogLevel.Info]: {
        row: "bg-blue-50",
        badge: "bg-blue-200 text-blue-800",
        text: "text-blue-700",
    },
    [LogLevel.Warn]: {
        row: "bg-amber-50",
        badge: "bg-amber-200 text-amber-800",
        text: "text-amber-700",
    },
    [LogLevel.Error]: {
        row: "bg-red-50",
        badge: "bg-red-200 text-red-800",
        text: "text-red-700",
    },
};

const groupColors: Record<LogGroup, string> = {
    [LogGroup.OnlineServices]: "bg-purple-200 text-purple-800",
    [LogGroup.Vault]: "bg-green-200 text-green-800",
    [LogGroup.Synchronization]: "bg-violet-200 text-violet-800",
    [LogGroup.UI]: "bg-pink-200 text-pink-800",
    [LogGroup.Import]: "bg-green-200 text-green-800",
    [LogGroup.WebRTC]: "bg-cyan-200 text-cyan-800",
    [LogGroup.Signaling]: "bg-indigo-200 text-indigo-800",
    [LogGroup.General]: "bg-gray-200 text-gray-800",
};

const groupIcons: Record<LogGroup, string> = {
    [LogGroup.OnlineServices]: "🌐",
    [LogGroup.Vault]: "💰",
    [LogGroup.Synchronization]: "🔄",
    [LogGroup.UI]: "🖥️",
    [LogGroup.Import]: "📂",
    [LogGroup.WebRTC]: "📡",
    [LogGroup.Signaling]: "📶",
    [LogGroup.General]: "📋",
};

const formatTimestamp = (date: Date) =>
    date.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });

const formatData = (data: unknown) => {
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
};

function FilterToggle({
    label,
    isActive,
    onClick,
    colorClass,
    icon,
    count,
}: {
    label: string;
    isActive: boolean;
    onClick: () => void;
    colorClass?: string;
    icon?: string;
    count?: number;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                isActive
                    ? colorClass || "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
        >
            {icon && <span>{icon}</span>}
            {label}
            {count !== undefined && count > 0 && (
                <span
                    className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        isActive ? "bg-black/10" : "bg-muted-foreground/20",
                    )}
                >
                    {count}
                </span>
            )}
        </button>
    );
}

function LogEntryRow({
    entry,
    isExpanded,
    onToggle,
}: {
    entry: LogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const hasData = entry.data !== undefined && entry.data !== null;
    const levelStyle = levelColors[entry.level];

    return (
        <div className={cn("border-b transition-colors", levelStyle.row)}>
            <div
                className={cn(
                    "flex cursor-default items-start gap-2 px-3 py-2 hover:bg-black/5",
                    hasData && "cursor-pointer",
                )}
                onClick={hasData ? onToggle : undefined}
            >
                <div className="w-4 flex-shrink-0 pt-0.5">
                    {hasData ? (
                        isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )
                    ) : (
                        <span className="block w-4" />
                    )}
                </div>
                <span className="pt-0.5 font-mono text-xs text-muted-foreground">
                    {formatTimestamp(entry.timestamp)}
                </span>
                <span
                    className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        levelStyle.badge,
                    )}
                >
                    {entry.level}
                </span>
                <span
                    className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        groupColors[entry.group],
                    )}
                >
                    {groupIcons[entry.group]} {entry.group}
                </span>
                <span className={cn("flex-grow break-words text-sm", levelStyle.text)}>
                    {entry.message}
                </span>
                {hasData && !isExpanded && (
                    <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                        {"{...}"}
                    </span>
                )}
            </div>
            {hasData && isExpanded && (
                <div className="ml-6 px-3 pb-3">
                    <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
                        {formatData(entry.data)}
                    </pre>
                </div>
            )}
        </div>
    );
}

export const LogInspectorDialog: React.FC<{
    showDialogFnRef: React.RefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedGroups, setSelectedGroups] = useState<Set<LogGroup>>(
        new Set(Object.values(LogGroup)),
    );
    const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(
        new Set(Object.values(LogLevel)),
    );
    const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
    const [autoScroll, setAutoScroll] = useState(true);
    const [showFilters, setShowFilters] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logCounts, setLogCounts] = useState<Record<LogGroup, number>>(
        {} as Record<LogGroup, number>,
    );

    const logContainerRef = useRef<HTMLDivElement>(null);

    const refreshLogs = useCallback(() => {
        setLogs(vaultLogger.getAllLogs());
        setLogCounts(vaultLogger.getLogCounts());
    }, []);

    showDialogFnRef.current = () => {
        setOpen(true);
        refreshLogs();
    };

    useEffect(() => {
        if (!open) return;
        const interval = setInterval(refreshLogs, 1000);
        return () => clearInterval(interval);
    }, [open, refreshLogs]);

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const filteredLogs = useMemo(
        () =>
            vaultLogger.getFilteredLogs({
                groups:
                    selectedGroups.size === Object.values(LogGroup).length
                        ? undefined
                        : Array.from(selectedGroups),
                levels:
                    selectedLevels.size === Object.values(LogLevel).length
                        ? undefined
                        : Array.from(selectedLevels),
                searchText: searchQuery || undefined,
            }),
        [logs, selectedGroups, selectedLevels, searchQuery],
    );

    const toggleGroup = (group: LogGroup) =>
        setSelectedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });

    const toggleLevel = (level: LogLevel) =>
        setSelectedLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
            }
            return next;
        });

    const toggleEntryExpanded = (id: string) =>
        setExpandedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });

    const clearLogs = () => {
        vaultLogger.clearAll();
        refreshLogs();
        setExpandedEntries(new Set());
        vaultLogger.info(LogGroup.General, "Logs cleared");
    };

    const exportLogs = () => {
        const json = vaultLogger.exportAsJSON({
            groups:
                selectedGroups.size === Object.values(LogGroup).length
                    ? undefined
                    : Array.from(selectedGroups),
            levels:
                selectedLevels.size === Object.values(LogLevel).length
                    ? undefined
                    : Array.from(selectedLevels),
        });
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `cryptex-logs-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        vaultLogger.info(LogGroup.General, "Logs exported");
    };

    const totalLogCount = Object.values(logCounts).reduce(
        (accumulator, value) => accumulator + value,
        0,
    );

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="flex h-[80vh] max-w-6xl flex-col gap-0 p-0">
                <DialogHeader className="border-b px-4 py-3">
                    <DialogTitle className="flex items-center gap-3">
                        Log Inspector
                        <Badge variant="secondary" className="font-mono">
                            {filteredLogs.length} / {totalLogCount}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-2 border-b p-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-grow">
                            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                            <Input
                                type="text"
                                placeholder="Search logs..."
                                value={searchQuery}
                                onChange={(event) =>
                                    setSearchQuery(event.target.value)
                                }
                                className="h-9 pl-9 pr-8"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery("")}
                                    className="hover:bg-muted absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
                                >
                                    <X className="text-muted-foreground h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <Button
                            size="sm"
                            variant={showFilters ? "default" : "outline"}
                            onClick={() => setShowFilters((value) => !value)}
                        >
                            <Filter className="mr-1 h-4 w-4" />
                            Filters
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAutoScroll((value) => !value)}
                            title={
                                autoScroll
                                    ? "Disable auto-scroll"
                                    : "Enable auto-scroll"
                            }
                        >
                            <RefreshCw
                                className={cn(
                                    "h-4 w-4",
                                    autoScroll && "animate-spin",
                                )}
                            />
                        </Button>
                    </div>

                    {showFilters && (
                        <div className="bg-background flex flex-col gap-3 rounded-lg border p-3">
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                                        Groups
                                    </span>
                                    <div className="flex gap-1 text-xs">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedGroups(
                                                    new Set(
                                                        Object.values(LogGroup),
                                                    ),
                                                )
                                            }
                                            className="text-primary hover:underline"
                                        >
                                            All
                                        </button>
                                        <span className="text-muted-foreground">|</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedGroups(new Set())
                                            }
                                            className="text-primary hover:underline"
                                        >
                                            None
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.values(LogGroup).map((group) => (
                                        <FilterToggle
                                            key={group}
                                            label={group}
                                            isActive={selectedGroups.has(group)}
                                            onClick={() => toggleGroup(group)}
                                            colorClass={groupColors[group]}
                                            icon={groupIcons[group]}
                                            count={logCounts[group] || 0}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                                        Levels
                                    </span>
                                    <div className="flex gap-1 text-xs">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedLevels(
                                                    new Set(
                                                        Object.values(LogLevel),
                                                    ),
                                                )
                                            }
                                            className="text-primary hover:underline"
                                        >
                                            All
                                        </button>
                                        <span className="text-muted-foreground">|</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedLevels(
                                                    new Set([
                                                        LogLevel.Error,
                                                        LogLevel.Warn,
                                                    ]),
                                                )
                                            }
                                            className="text-primary hover:underline"
                                        >
                                            Errors Only
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.values(LogLevel).map((level) => (
                                        <FilterToggle
                                            key={level}
                                            label={level}
                                            isActive={selectedLevels.has(level)}
                                            onClick={() => toggleLevel(level)}
                                            colorClass={levelColors[level].badge}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-2 border-t pt-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setExpandedEntries(
                                            new Set(
                                                filteredLogs.map((log) => log.id),
                                            ),
                                        )
                                    }
                                >
                                    Expand All
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpandedEntries(new Set())}
                                >
                                    Collapse All
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    ref={logContainerRef}
                    className="bg-background flex-grow overflow-y-auto font-mono text-sm"
                >
                    {filteredLogs.length === 0 ? (
                        <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
                            <div className="mb-2 text-4xl">📋</div>
                            <p className="text-lg font-medium">
                                No logs to display
                            </p>
                            <p className="text-sm">
                                {totalLogCount === 0
                                    ? "Logs will appear here as you use the app"
                                    : "Try adjusting your filters"}
                            </p>
                        </div>
                    ) : (
                        filteredLogs.map((entry) => (
                            <LogEntryRow
                                key={entry.id}
                                entry={entry}
                                isExpanded={expandedEntries.has(entry.id)}
                                onToggle={() => toggleEntryExpanded(entry.id)}
                            />
                        ))
                    )}
                </div>

                <div className="bg-muted/40 text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
                    <span>
                        Showing <strong>{filteredLogs.length}</strong> of{" "}
                        <strong>{totalLogCount}</strong> logs
                    </span>
                    <span className="font-mono">
                        Last updated: {new Date().toLocaleTimeString()}
                    </span>
                </div>

                <DialogFooter className="flex-row items-center justify-between border-t px-4 py-3">
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                        Close
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={clearLogs}
                            disabled={totalLogCount === 0}
                        >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Clear All
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={exportLogs}
                            disabled={filteredLogs.length === 0}
                        >
                            <Download className="mr-1 h-4 w-4" />
                            Export JSON
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
