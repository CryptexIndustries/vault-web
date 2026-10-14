import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { deleteAppOwnedTempFile, writeSecretTempFile } from "@/utils/secret-temp-files";
import { Check, Copy, Download, ListFilter, RotateCw } from "lucide-react-native";

import { vaultLogger, type MobileLogEntry } from "@/utils/logging";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { copySecretToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";

type EventFilter = "all" | "problems" | "errors" | "warnings" | "info" | "debug";

const FILTER_OPTIONS: Array<{ value: EventFilter; label: string }> = [
    { value: "all", label: "All events" },
    { value: "problems", label: "Problems" },
    { value: "errors", label: "Errors" },
    { value: "warnings", label: "Warnings" },
    { value: "info", label: "Info" },
    { value: "debug", label: "Debug" },
];

function matchesFilter(entry: MobileLogEntry, filter: EventFilter): boolean {
    switch (filter) {
        case "problems": return entry.level === "ERROR" || entry.level === "WARN";
        case "errors": return entry.level === "ERROR";
        case "warnings": return entry.level === "WARN";
        case "info": return entry.level === "INFO";
        case "debug": return entry.level === "DEBUG";
        default: return true;
    }
}

function createDiagnosticsExport() {
    return JSON.stringify(
        {
            capturedAt: new Date().toISOString(),
            appVersion:
                Constants.expoConfig?.version ??
                Constants.nativeAppVersion ??
                "Unknown",
            buildVersion: Constants.nativeBuildVersion ?? null,
            platform: Platform.OS,
            osVersion: Platform.OS === "android" ? Platform.constants.Release : String(Platform.Version),
            androidApiLevel: Platform.OS === "android" ? Platform.Version : undefined,
            events: vaultLogger.getAllLogs(),
        },
        null,
        2,
    );
}

function detailsText(entry: MobileLogEntry): string {
    return entry.details === undefined ? "" : JSON.stringify(entry.details, null, 2) ?? "";
}

export default function DiagnosticsScreen() {
    const confirm = useUnlockedConfirmation();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<EventFilter>("all");
    const [filterOpen, setFilterOpen] = useState(false);
    const [expandedDetails, setExpandedDetails] = useState<Record<number, boolean>>({});
    const [revision, setRevision] = useState(0);
    const [exportSnapshot, setExportSnapshot] = useState<string | null>(null);
    const [reviewExport, setReviewExport] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    const [copyMessage, setCopyMessage] = useState("");
    useFocusEffect(useCallback(() => {
        setRevision((value) => value + 1);
    }, []));
    const allLogs = useMemo(() => {
        void revision;
        return vaultLogger.getAllLogs();
    }, [revision]);
    const logs = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return allLogs
            .filter(
                (entry) =>
                    matchesFilter(entry, filter) &&
                    (!needle ||
                        entry.group.toLowerCase().includes(needle) ||
                        entry.level.toLowerCase().includes(needle) ||
                        entry.message.toLowerCase().includes(needle) ||
                        detailsText(entry).toLowerCase().includes(needle)),
            )
            .reverse();
    }, [allLogs, filter, query]);
    const errorCount = allLogs.filter((entry) => entry.level === "ERROR").length;
    const warningCount = allLogs.filter((entry) => entry.level === "WARN").length;
    const activeFilterLabel = FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? "All events";
    const exportEventCount = exportSnapshot ? (JSON.parse(exportSnapshot) as { events: MobileLogEntry[] }).events.length : 0;

    const copyLogs = async () => {
        const copied = await copySecretToClipboard(createDiagnosticsExport());
        setCopyMessage(copied ? "Copied. The clipboard will clear after 30 seconds." : "Could not copy diagnostics.");
    };

    const exportLogs = async () => {
        if (!exportSnapshot || exporting) return;
        setExporting(true);
        setExportError("");
        let path: string | undefined;
        try {
            path = await writeSecretTempFile(
                "json",
                exportSnapshot,
                FileSystem.EncodingType.UTF8,
            );
            await Sharing.shareAsync(path, { mimeType: "application/json" });
        } catch (error) {
            setExportError(error instanceof Error ? error.message : "Could not export diagnostics.");
        } finally {
            if (path) await deleteAppOwnedTempFile(path).catch(() => {});
            setExporting(false);
        }
    };

    return (
        <UnlockedTaskScreen
            title={reviewExport ? "Review diagnostic export" : "Diagnostics"}
            onBack={reviewExport ? () => setReviewExport(false) : undefined}
            scroll={false}
            actions={reviewExport ? undefined : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Refresh diagnostics"
                    onPress={() => setRevision((value) => value + 1)}
                    style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                >
                    <RotateCw size={21} color={colors.foreground} strokeWidth={1.8} />
                </Pressable>
            )}
        >
            <Dialog open={exportSnapshot !== null && !reviewExport} onOpenChange={(open) => !open && setExportSnapshot(null)} placement="bottom" scroll dismissible={!exporting}>
                <DialogHeader><UnlockedDialogTitle>Export diagnostics</UnlockedDialogTitle></DialogHeader>
                <Text className="text-sm leading-5 text-muted-foreground">
                    A JSON file containing app version, device information, and {exportEventCount} diagnostic {exportEventCount === 1 ? "event" : "events"}. Known secret fields are redacted, but review the contents before sharing.
                </Text>
                <Button variant="outline" disabled={exporting} onPress={() => setReviewExport(true)}>Review file contents</Button>
                <Button loading={exporting} onPress={() => void exportLogs()}>Save diagnostic file</Button>
                {exportError ? <InlineNotice tone="error" message={exportError} /> : null}
            </Dialog>
            {reviewExport ? (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 30 }}>
                    <Text className="text-[22px] font-medium text-foreground">Check before sharing</Text>
                    <Text className="mt-2 text-[13px] leading-5 text-muted-foreground">
                        The file contains diagnostic events, app version, and device information.
                    </Text>
                    <View className="my-5 rounded-md border border-border bg-[#111520] p-[18px]">
                        <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled showsVerticalScrollIndicator>
                            <Text selectable className="font-mono text-sm leading-[25px] text-foreground">
                                {exportSnapshot}
                            </Text>
                        </ScrollView>
                    </View>
                    <View className="border-l-2 border-muted pl-3">
                        <Text className="text-xs leading-5 text-muted-foreground">
                            Known secret fields are redacted. Review the contents before sharing them with support.
                        </Text>
                    </View>
                    <Button className="mt-6" loading={exporting} onPress={() => void exportLogs()}>
                        Save diagnostic file
                    </Button>
                    {exportError ? <InlineNotice tone="error" message={exportError} className="mt-3" /> : null}
                </ScrollView>
            ) : (
                <View style={{ flex: 1 }}>
                    <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background, zIndex: 20 }}>
                        <View className="flex-row items-center gap-3">
                            <View className="flex-1">
                                <Input
                                    value={query}
                                    onChangeText={setQuery}
                                    onFocus={() => setFilterOpen(false)}
                                    placeholder="Search diagnostics"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    accessibilityLabel="Search diagnostic events"
                                />
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Filter diagnostics, ${activeFilterLabel}`}
                                accessibilityState={{ expanded: filterOpen }}
                                onPress={() => setFilterOpen((open) => !open)}
                                style={{ width: 54, height: 54, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 6, borderColor: filter === "all" ? colors.border : colors.primary, backgroundColor: "#111520" }}
                            >
                                <ListFilter size={21} color={filter === "all" ? colors.foreground : colors.primary} strokeWidth={1.8} />
                            </Pressable>
                        </View>
                    </View>
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
                        <View className="rounded-md border border-border bg-[#111520] p-4">
                            <Text className="text-[11px] uppercase tracking-[1px] text-muted-foreground">This session</Text>
                            <Text className="mt-2 text-sm text-foreground">
                                {allLogs.length} {allLogs.length === 1 ? "event" : "events"} · {errorCount} errors · {warningCount} warnings
                            </Text>
                            <Text className="mt-2 text-xs text-muted-foreground">
                                App {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "Unknown"}
                                {Constants.nativeBuildVersion ? ` (build ${Constants.nativeBuildVersion})` : ""}
                                {Platform.OS === "android" ? ` · Android ${Platform.constants.Release} · API ${Platform.Version}` : ` · ${Platform.OS} ${Platform.Version}`}
                            </Text>
                        </View>
                        <Text className="mt-3 text-xs leading-5 text-muted-foreground">
                            Events stay in memory for this session. Review details before copying or sharing them.
                        </Text>
                        <View className="mt-5 flex-row gap-3">
                            <Button variant="outline" className="flex-1" onPress={() => { setExportError(""); setExportSnapshot(createDiagnosticsExport()); }}>
                                <Download size={18} color={colors.foreground} />
                                <Text className="text-sm font-semibold">Export file</Text>
                            </Button>
                            <Button variant="outline" className="flex-1" onPress={() => void copyLogs()}>
                                <Copy size={18} color={colors.foreground} />
                                <Text className="text-sm font-semibold">Copy JSON</Text>
                            </Button>
                        </View>
                        {copyMessage ? <InlineNotice tone={copyMessage.startsWith("Copied") ? "success" : "error"} message={copyMessage} className="mt-3" /> : null}
                        <Text className="mb-2 mt-7 text-[11px] uppercase tracking-[1px] text-muted-foreground">
                            Recent events ({logs.length}){filter !== "all" ? ` · ${activeFilterLabel}` : ""}
                        </Text>
                        {logs.map((entry) => {
                            const details = detailsText(entry);
                            const expanded = expandedDetails[entry.id] ?? (entry.level === "ERROR" || entry.level === "WARN");
                            return <View key={entry.id} className="justify-center border-b border-border py-4">
                                <Text className="text-[13px] leading-[19px] text-muted-foreground">
                                    {new Date(entry.timestamp).toLocaleString()} [{entry.group}] {entry.level}
                                </Text>
                                <Text className="mt-1 text-sm leading-5 text-foreground">{entry.message}</Text>
                                {details ? <>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`${expanded ? "Hide" : "Show"} details for ${entry.message}`}
                                        onPress={() => setExpandedDetails((current) => ({ ...current, [entry.id]: !expanded }))}
                                        className="mt-3 self-start py-2"
                                    >
                                        <Text className="text-sm text-primary">{expanded ? "Hide details" : "Show details"}</Text>
                                    </Pressable>
                                    {expanded ? (
                                        <View className="rounded-md border border-border bg-[#111520] p-3">
                                            <Text selectable className="font-mono text-xs leading-5 text-foreground">{details}</Text>
                                        </View>
                                    ) : null}
                                </> : null}
                            </View>;
                        })}
                        {!logs.length ? (
                            <Text className="py-5 text-sm text-muted-foreground">
                                {allLogs.length ? "No events match this search and filter." : "No diagnostic events yet."}
                            </Text>
                        ) : null}
                        <Button
                            variant="destructive"
                            className="mt-6"
                            onPress={() => {
                                confirm({
                                    title: "Clear diagnostic logs?",
                                    description: "Remove the in-memory log history from this session.",
                                    cancelLabel: "Cancel",
                                    confirmLabel: "Clear logs",
                                    onConfirm: () => {
                                        vaultLogger.clearAll();
                                        setExpandedDetails({});
                                        setRevision((value) => value + 1);
                                    },
                                });
                            }}
                        >
                            Clear logs
                        </Button>
                    </ScrollView>
                    {filterOpen ? (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Close diagnostic filters"
                                onPress={() => setFilterOpen(false)}
                                style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 }}
                            />
                            <View style={{ position: "absolute", top: 74, right: 20, width: 245, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.navigation, zIndex: 30, elevation: 12 }}>
                                {FILTER_OPTIONS.map((option, index) => (
                                    <Pressable
                                        key={option.value}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Show ${option.label.toLowerCase()}`}
                                        accessibilityState={{ selected: filter === option.value }}
                                        onPress={() => { setFilter(option.value); setFilterOpen(false); }}
                                        style={{ minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: index === FILTER_OPTIONS.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
                                    >
                                        <Text className="flex-1 text-sm">{option.label}</Text>
                                        <Text className="text-xs text-muted-foreground">{allLogs.filter((entry) => matchesFilter(entry, option.value)).length}</Text>
                                        {filter === option.value ? <Check size={17} color={colors.primary} /> : null}
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    ) : null}
                </View>
            )}
        </UnlockedTaskScreen>
    );
}
