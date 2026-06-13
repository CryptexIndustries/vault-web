import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createRoot } from "react-dom/client";
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

import "./logs.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    clearStoredLogs,
    getStoredLogs,
    LogGroup,
    LogLevel,
    subscribeStoredLogs,
    type LogEntry,
} from "./utils/ext-logging";

const levelStyles: Record<
    LogLevel,
    { row: string; badge: string; text: string }
> = {
    [LogLevel.Debug]: {
        row: "bg-muted/30",
        badge: "bg-muted text-muted-foreground",
        text: "text-muted-foreground",
    },
    [LogLevel.Info]: {
        row: "bg-blue-500/10",
        badge: "bg-blue-500/30 text-blue-200",
        text: "text-blue-100",
    },
    [LogLevel.Warn]: {
        row: "bg-amber-500/10",
        badge: "bg-amber-500/30 text-amber-200",
        text: "text-amber-100",
    },
    [LogLevel.Error]: {
        row: "bg-destructive/15",
        badge: "bg-destructive/40 text-foreground",
        text: "text-foreground",
    },
};

const groupStyles: Record<LogGroup, string> = {
    [LogGroup.WebRTC]: "bg-cyan-500/30 text-cyan-100",
    [LogGroup.Signaling]: "bg-indigo-500/30 text-indigo-100",
    [LogGroup.Synchronization]: "bg-violet-500/30 text-violet-100",
    [LogGroup.Vault]: "bg-emerald-500/30 text-emerald-100",
    [LogGroup.OnlineServices]: "bg-rose-500/30 text-rose-100",
    [LogGroup.UI]: "bg-pink-500/30 text-pink-100",
    [LogGroup.Import]: "bg-orange-500/30 text-orange-100",
    [LogGroup.General]: "bg-slate-500/30 text-slate-100",
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
    count,
}: {
    label: string;
    isActive: boolean;
    onClick: () => void;
    colorClass?: string;
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
            {label}
            {count !== undefined && count > 0 ? (
                <span
                    className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        isActive ? "bg-black/30" : "bg-muted-foreground/20",
                    )}
                >
                    {count}
                </span>
            ) : null}
        </button>
    );
}

function LogRow({
    entry,
    isExpanded,
    onToggle,
}: {
    entry: LogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const hasData = entry.data !== undefined && entry.data !== null;
    const style = levelStyles[entry.level];

    return (
        <div className={cn("border-b border-border/60", style.row)}>
            <div
                className={cn(
                    "flex cursor-default items-start gap-2 px-3 py-2 hover:bg-muted/40",
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
                        style.badge,
                    )}
                >
                    {entry.level}
                </span>
                <span
                    className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        groupStyles[entry.group],
                    )}
                >
                    {entry.group}
                </span>
                <span
                    className={cn("flex-grow break-words text-sm", style.text)}
                >
                    {entry.message}
                </span>
                {hasData && !isExpanded ? (
                    <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                        {"{ ... }"}
                    </span>
                ) : null}
            </div>
            {hasData && isExpanded ? (
                <div className="ml-6 px-3 pb-3">
                    <pre className="max-h-64 overflow-auto rounded-md bg-background/80 p-3 font-mono text-xs">
                        {formatData(entry.data)}
                    </pre>
                </div>
            ) : null}
        </div>
    );
}

const LogsApp = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedGroups, setSelectedGroups] = useState<Set<LogGroup>>(
        new Set(Object.values(LogGroup)),
    );
    const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(
        new Set(Object.values(LogLevel)),
    );
    const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
        new Set(),
    );
    const [autoScroll, setAutoScroll] = useState(true);
    const [showFilters, setShowFilters] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        setLogs(await getStoredLogs());
    }, []);

    useEffect(() => {
        void refresh();
        const unsubscribe = subscribeStoredLogs(setLogs);
        return unsubscribe;
    }, [refresh]);

    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const logCounts = useMemo(() => {
        const counts = Object.values(LogGroup).reduce(
            (acc, group) => {
                acc[group] = 0;
                return acc;
            },
            {} as Record<LogGroup, number>,
        );
        for (const entry of logs) {
            counts[entry.group] = (counts[entry.group] ?? 0) + 1;
        }
        return counts;
    }, [logs]);

    const filteredLogs = useMemo(() => {
        const search = searchQuery.toLowerCase();
        return logs.filter((entry) => {
            if (!selectedGroups.has(entry.group)) return false;
            if (!selectedLevels.has(entry.level)) return false;
            if (!search) return true;
            if (entry.message.toLowerCase().includes(search)) return true;
            if (entry.data) {
                try {
                    return JSON.stringify(entry.data)
                        .toLowerCase()
                        .includes(search);
                } catch {
                    return false;
                }
            }
            return false;
        });
    }, [logs, selectedGroups, selectedLevels, searchQuery]);

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

    const toggleEntry = (id: string) =>
        setExpandedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });

    const handleClear = async () => {
        await clearStoredLogs();
        setExpandedEntries(new Set());
    };

    const handleExport = () => {
        const payload = JSON.stringify(filteredLogs, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `cryptex-extension-logs-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="dark flex min-h-screen flex-col bg-background text-foreground">
            <header className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-semibold">
                        Cryptex Vault Logs
                    </h1>
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        {filteredLogs.length} / {logs.length}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExport}
                        disabled={filteredLogs.length === 0}
                    >
                        <Download className="mr-1 h-4 w-4" />
                        Export
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleClear}
                        disabled={logs.length === 0}
                    >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Clear
                    </Button>
                </div>
            </header>

            <div className="flex flex-col gap-2 border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-grow">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="Search logs..."
                            value={searchQuery}
                            onChange={(
                                event: React.ChangeEvent<HTMLInputElement>,
                            ) => setSearchQuery(event.target.value)}
                            className="h-9 pl-9 pr-8"
                        />
                        {searchQuery ? (
                            <button
                                type="button"
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted"
                            >
                                <X className="h-4 w-4 text-muted-foreground" />
                            </button>
                        ) : null}
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

                {showFilters ? (
                    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                                    <span className="text-muted-foreground">
                                        |
                                    </span>
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
                                        colorClass={groupStyles[group]}
                                        count={logCounts[group] || 0}
                                    />
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                                    <span className="text-muted-foreground">
                                        |
                                    </span>
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
                                        Errors only
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
                                        colorClass={levelStyles[level].badge}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            <div
                ref={containerRef}
                className="flex-grow overflow-y-auto font-mono text-sm"
            >
                {filteredLogs.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 p-12 text-muted-foreground">
                        <p className="text-base font-medium">
                            No logs to display
                        </p>
                        <p className="text-sm">
                            {logs.length === 0
                                ? "Logs appear here as you use the extension."
                                : "Try adjusting your filters."}
                        </p>
                    </div>
                ) : (
                    filteredLogs.map((entry) => (
                        <LogRow
                            key={entry.id}
                            entry={entry}
                            isExpanded={expandedEntries.has(entry.id)}
                            onToggle={() => toggleEntry(entry.id)}
                        />
                    ))
                )}
            </div>

            <footer className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                <span>
                    Showing <strong>{filteredLogs.length}</strong> of{" "}
                    <strong>{logs.length}</strong> stored entries
                </span>
                <span className="font-mono">
                    Last updated: {new Date().toLocaleTimeString()}
                </span>
            </footer>
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<LogsApp />);
