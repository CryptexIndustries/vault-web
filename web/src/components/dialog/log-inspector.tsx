import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    FunnelIcon,
    MagnifyingGlassIcon,
    TrashIcon,
    XMarkIcon,
    ChevronDownIcon,
    ChevronRightIcon,
} from "@heroicons/react/20/solid";

import { GenericModal, Title, Body, Footer } from "../general/modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import {
    vaultLogger,
    LogGroup,
    LogLevel,
    type LogEntry,
} from "../../utils/logging";
import { ArrowDownIcon, ArrowDownUpIcon } from "lucide-react";

// Color mappings for log levels
const levelColors: Record<LogLevel, { bg: string; text: string; badge: string }> = {
    [LogLevel.Debug]: {
        bg: "bg-slate-50",
        text: "text-slate-600",
        badge: "bg-slate-200 text-slate-700",
    },
    [LogLevel.Info]: {
        bg: "bg-blue-50",
        text: "text-blue-700",
        badge: "bg-blue-200 text-blue-800",
    },
    [LogLevel.Warn]: {
        bg: "bg-amber-50",
        text: "text-amber-700",
        badge: "bg-amber-200 text-amber-800",
    },
    [LogLevel.Error]: {
        bg: "bg-red-50",
        text: "text-red-700",
        badge: "bg-red-200 text-red-800",
    },
};

// Color mappings for log groups
const groupColors: Record<LogGroup, string> = {
    [LogGroup.Synchronization]: "bg-violet-200 text-violet-800",
    // [LogGroup.UI]: "bg-pink-200 text-pink-800",
    // [LogGroup.Encryption]: "bg-emerald-200 text-emerald-800",
    // [LogGroup.Storage]: "bg-orange-200 text-orange-800",
    [LogGroup.WebRTC]: "bg-cyan-200 text-cyan-800",
    [LogGroup.Signaling]: "bg-indigo-200 text-indigo-800",
    [LogGroup.General]: "bg-gray-200 text-gray-800",
};

// Icons for log groups
const groupIcons: Record<LogGroup, string> = {
    [LogGroup.Synchronization]: "🔄",
    // [LogGroup.UI]: "🖥️",
    // [LogGroup.Encryption]: "🔐",
    // [LogGroup.Storage]: "💾",
    [LogGroup.WebRTC]: "📡",
    [LogGroup.Signaling]: "📶",
    [LogGroup.General]: "📋",
};

interface LogEntryRowProps {
    entry: LogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}

const LogEntryRow: React.FC<LogEntryRowProps> = ({ entry, isExpanded, onToggle }) => {
    const hasData = entry.data !== undefined && entry.data !== null;
    const levelStyle = levelColors[entry.level];
    const groupStyle = groupColors[entry.group];

    const formatTimestamp = (date: Date) => {
        return date.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
        });
    };

    const formatData = (data: unknown): string => {
        try {
            return JSON.stringify(data, null, 2);
        } catch {
            return String(data);
        }
    };

    return (
        <div className={clsx("border-b border-gray-100 transition-colors", levelStyle.bg)}>
            <div
                className={clsx(
                    "flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-black/5",
                    hasData && "cursor-pointer"
                )}
                onClick={hasData ? onToggle : undefined}
            >
                {/* Expand/Collapse indicator */}
                <div className="w-4 flex-shrink-0 pt-0.5">
                    {hasData ? (
                        isExpanded ? (
                            <ChevronDownIcon className="h-4 w-4 text-gray-500" />
                        ) : (
                            <ChevronRightIcon className="h-4 w-4 text-gray-500" />
                        )
                    ) : (
                        <span className="block w-4" />
                    )}
                </div>

                {/* Timestamp */}
                <span className="flex-shrink-0 font-mono text-xs text-gray-500 pt-0.5">
                    {formatTimestamp(entry.timestamp)}
                </span>

                {/* Level badge */}
                <span
                    className={clsx(
                        "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                        levelStyle.badge
                    )}
                >
                    {entry.level}
                </span>

                {/* Group badge */}
                <span
                    className={clsx(
                        "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        groupStyle
                    )}
                >
                    {groupIcons[entry.group]} {entry.group}
                </span>

                {/* Message */}
                <span className={clsx("flex-grow text-sm break-words", levelStyle.text)}>
                    {entry.message}
                </span>

                {/* Data indicator */}
                {hasData && !isExpanded && (
                    <span className="flex-shrink-0 text-xs text-gray-400 font-mono">
                        {"{...}"}
                    </span>
                )}
            </div>

            {/* Expanded data view */}
            {hasData && isExpanded && (
                <div className="px-3 pb-3 ml-6">
                    <pre className="p-3 bg-gray-900 text-gray-100 rounded-md text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                        {formatData(entry.data)}
                    </pre>
                </div>
            )}
        </div>
    );
};

interface FilterToggleProps {
    label: string;
    isActive: boolean;
    onClick: () => void;
    colorClass?: string;
    icon?: string;
    count?: number;
}

const FilterToggle: React.FC<FilterToggleProps> = ({
    label,
    isActive,
    onClick,
    colorClass,
    icon,
    count,
}) => (
    <button
        type="button"
        onClick={onClick}
        className={clsx(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all",
            isActive
                ? colorClass || "bg-slate-700 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        )}
    >
        {icon && <span>{icon}</span>}
        {label}
        {count !== undefined && count > 0 && (
            <span
                className={clsx(
                    "ml-1 px-1.5 py-0.5 rounded-full text-[10px]",
                    isActive ? "bg-white/20" : "bg-gray-300 text-gray-600"
                )}
            >
                {count}
            </span>
        )}
    </button>
);

export const LogInspectorDialog: React.FC<{
    showDialogFnRef: React.RefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedGroups, setSelectedGroups] = useState<Set<LogGroup>>(new Set(Object.values(LogGroup)));
    const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(new Set(Object.values(LogLevel)));
    const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
    const [autoScroll, setAutoScroll] = useState(true);
    const [showFilters, setShowFilters] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logCounts, setLogCounts] = useState<Record<LogGroup, number>>({} as Record<LogGroup, number>);

    const logContainerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    showDialogFnRef.current = () => {
        setVisible(true);
        refreshLogs();
    };

    const hideDialog = () => {
        setVisible(false);
    };

    const refreshLogs = useCallback(() => {
        setLogs(vaultLogger.getAllLogs());
        setLogCounts(vaultLogger.getLogCounts());
    }, []);

    // Auto-refresh logs when visible
    useEffect(() => {
        if (!visible) return;

        const interval = setInterval(refreshLogs, 1000);
        return () => clearInterval(interval);
    }, [visible, refreshLogs]);

    // Auto-scroll to bottom
    useEffect(() => {
        // In case the user has scrolled away, don't autoscroll

        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    // Filter logs
    const filteredLogs = useMemo(() => {
        return vaultLogger.getFilteredLogs({
            groups: selectedGroups.size === Object.values(LogGroup).length
                ? undefined
                : Array.from(selectedGroups),
            levels: selectedLevels.size === Object.values(LogLevel).length
                ? undefined
                : Array.from(selectedLevels),
            searchText: searchQuery || undefined,
        });
    }, [logs, selectedGroups, selectedLevels, searchQuery]);

    const toggleGroup = (group: LogGroup) => {
        setSelectedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });
    };

    const toggleLevel = (level: LogLevel) => {
        setSelectedLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
            }
            return next;
        });
    };

    const toggleEntryExpanded = (id: string) => {
        setExpandedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAllGroups = () => {
        setSelectedGroups(new Set(Object.values(LogGroup)));
    };

    const selectNoGroups = () => {
        setSelectedGroups(new Set());
    };

    const selectAllLevels = () => {
        setSelectedLevels(new Set(Object.values(LogLevel)));
    };

    const selectErrorsOnly = () => {
        setSelectedLevels(new Set([LogLevel.Error, LogLevel.Warn]));
    };

    const clearLogs = () => {
        vaultLogger.clearAll();
        refreshLogs();
        setExpandedEntries(new Set());
        vaultLogger.info(LogGroup.General, "Logs cleared");
    };

    const exportLogs = () => {
        const json = vaultLogger.exportAsJSON({
            groups: selectedGroups.size === Object.values(LogGroup).length
                ? undefined
                : Array.from(selectedGroups),
            levels: selectedLevels.size === Object.values(LogLevel).length
                ? undefined
                : Array.from(selectedLevels),
        });

        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cryptex-logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        vaultLogger.info(LogGroup.General, "Logs exported");
    };

    const expandAll = () => {
        setExpandedEntries(new Set(filteredLogs.map((l) => l.id)));
    };

    const collapseAll = () => {
        setExpandedEntries(new Set());
    };

    const totalLogCount = Object.values(logCounts).reduce((a, b) => a + b, 0);

    return (
        <GenericModal
            key="log-inspector-modal"
            visibleState={[visible, () => hideDialog()]}
            childrenTitle={
                <div className="flex items-center gap-3 w-full">
                    <Title>Log Inspector</Title>
                    <Badge variant="secondary" className="font-mono">
                        {filteredLogs.length} / {totalLogCount}
                    </Badge>
                </div>
            }
            width="6xl"
        >
            <Body className="p-0 flex flex-col h-[70vh]">
                {/* Toolbar */}
                <div className="flex flex-col gap-2 p-3 border-b">
                    {/* Search and main controls */}
                    <div className="flex items-center gap-2">
                        <div className="relative flex-grow">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search logs... (message or data)"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-8 h-9 text-gray-400"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery("")}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded"
                                >
                                    <XMarkIcon className="h-4 w-4 text-gray-400" />
                                </button>
                            )}
                        </div>

                        <Button
                            size="sm"
                            onClick={() => setShowFilters(!showFilters)}
                            className="flex-shrink-0"
                        >
                            <FunnelIcon className="h-4 w-4 mr-1" />
                            Filters
                        </Button>

                        {/* A button for refreshing logs */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoScroll(!autoScroll)}
                            title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
                            className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md p-1"
                        >
                            {autoScroll ? <ArrowDownIcon className="h-4 w-4" /> : <ArrowDownUpIcon className="h-4 w-4" />}
                        </Button>
                    </div>

                    {/* Filter panel */}
                    {showFilters && (
                        <div className="flex flex-col gap-3 p-3 bg-white rounded-lg border">
                            {/* Log Groups */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Groups
                                    </span>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={selectAllGroups}
                                            className="text-xs text-blue-600 hover:underline"
                                        >
                                            All
                                        </button>
                                        <span className="text-gray-300">|</span>
                                        <button
                                            type="button"
                                            onClick={selectNoGroups}
                                            className="text-xs text-blue-600 hover:underline"
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

                            {/* Log Levels */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Levels
                                    </span>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={selectAllLevels}
                                            className="text-xs text-blue-600 hover:underline"
                                        >
                                            All
                                        </button>
                                        <span className="text-gray-300">|</span>
                                        <button
                                            type="button"
                                            onClick={selectErrorsOnly}
                                            className="text-xs text-blue-600 hover:underline"
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

                            {/* Quick actions */}
                            <div className="flex items-center gap-2 pt-2 border-t">
                                <Button variant="ghost" size="sm" onClick={expandAll} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md p-1">
                                    Expand All
                                </Button>
                                <Button variant="ghost" size="sm" onClick={collapseAll} className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md p-1">
                                    Collapse All
                                </Button>
                                {/* <div className="flex-grow" /> */}
                            </div>
                        </div>
                    )}
                </div>

                {/* Log entries */}
                <div
                    ref={logContainerRef}
                    className="flex-grow overflow-y-auto bg-white font-mono text-sm"
                >
                    {filteredLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <div className="text-4xl mb-2">📋</div>
                            <p className="text-lg font-medium">No logs to display</p>
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

                {/* Stats bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t text-xs text-gray-500">
                    <div className="flex items-center gap-4">
                        <span>
                            Showing <strong>{filteredLogs.length}</strong> of{" "}
                            <strong>{totalLogCount}</strong> logs
                        </span>
                        {Object.entries(logCounts)
                            .filter(([, count]) => count > 0)
                            .map(([group, count]) => (
                                <span key={group} className="flex items-center gap-1">
                                    <span>{groupIcons[group as LogGroup]}</span>
                                    <span>{count}</span>
                                </span>
                            ))}
                    </div>
                    <span className="font-mono text-gray-400">
                        Last updated: {new Date().toLocaleTimeString()}
                    </span>
                </div>
            </Body>

            <Footer className="flex items-center justify-between">
                <Button variant="secondary" onClick={hideDialog}>
                    Close
                </Button>
                <div className="flex items-center gap-2">
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={clearLogs}
                        disabled={totalLogCount === 0}
                    >
                        <TrashIcon className="h-4 w-4 mr-1" />
                        Clear All
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={exportLogs}
                        disabled={filteredLogs.length === 0}
                        className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md p-1"
                    >
                        <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                        Export JSON
                    </Button>
                </div>
            </Footer>
        </GenericModal>
    );
};
