import { useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    ScrollView,
    View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
    ArrowUpDown,
    ChevronRight,
    KeyRound,
    ShieldCheck,
} from "lucide-react-native";

import {
    type SecurityAnalysisResult,
    type SecurityFindingIdentity,
    type WeakPasswordFinding,
} from "@cryptex-industries/vault-core/vault-utils/security-report";
import { useSecurityReport } from "@/components/security-report-provider";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

type FindingFilter = "all" | "reused" | "critical" | "weak" | "old";
type FindingSort = "risk" | "name" | "strength" | "reuse" | "age";

type SecurityFindingRow = SecurityFindingIdentity & {
    strength?: WeakPasswordFinding;
    reuseCount: number;
    reuseGroup?: SecurityFindingIdentity[];
    passwordAgeDays?: number;
};

const SORT_CYCLE: FindingSort[] = ["risk", "name", "strength", "reuse", "age"];

const SORT_LABELS: Record<FindingSort, string> = {
    risk: "Risk",
    name: "Name",
    strength: "Strength",
    reuse: "Reuse",
    age: "Age",
};

function buildFindingRows(
    analysis: SecurityAnalysisResult,
): SecurityFindingRow[] {
    const rows = new Map<string, SecurityFindingRow>();
    const getRow = (finding: SecurityFindingIdentity) => {
        const existing = rows.get(finding.credentialId);
        if (existing) return existing;
        const row: SecurityFindingRow = { ...finding, reuseCount: 0 };
        rows.set(finding.credentialId, row);
        return row;
    };

    for (const finding of analysis.weakFindings) {
        getRow(finding).strength = finding;
    }
    for (const group of analysis.reuseGroups) {
        for (const finding of group.credentials) {
            const row = getRow(finding);
            row.reuseCount = group.credentials.length;
            row.reuseGroup = group.credentials;
        }
    }
    for (const finding of analysis.ageFindings) {
        getRow(finding).passwordAgeDays = finding.passwordAgeDays;
    }

    return Array.from(rows.values());
}

function isCriticalFinding(row: SecurityFindingRow): boolean {
    return row.reuseCount > 1 || row.strength?.severity === "critical";
}

function matchesCategory(
    row: SecurityFindingRow,
    filter: FindingFilter,
): boolean {
    switch (filter) {
        case "reused":
            return row.reuseCount > 1;
        case "critical":
            return row.strength?.severity === "critical";
        case "weak":
            return row.strength?.score === 2;
        case "old":
            return row.passwordAgeDays != null;
        default:
            return true;
    }
}

function formatPasswordAge(days: number): string {
    const years = Math.floor(days / 365);
    const months = Math.min(11, Math.floor((days % 365) / 30));
    if (years === 0) return `${months}m`;
    return months > 0 ? `${years}y ${months}m` : `${years}y`;
}

function readFilter(value: string | string[] | undefined): FindingFilter {
    const filter = Array.isArray(value) ? value[0] : value;
    return filter === "reused" ||
        filter === "critical" ||
        filter === "weak" ||
        filter === "old"
        ? filter
        : "all";
}

export function SecurityReportScreen({
    view = "report",
}: {
    view?: "report" | "findings";
}) {
    const params = useLocalSearchParams<{ filter?: string | string[] }>();
    const findings = view === "findings";
    const { analysis, progress, running, error, refresh } =
        useSecurityReport();
    const [filter, setFilter] = useState<FindingFilter>(() =>
        readFilter(params.filter),
    );
    const [sort, setSort] = useState<FindingSort>(() => {
        const filter = readFilter(params.filter);
        return filter === "reused" ? "reuse" : filter === "old" ? "age" : "risk";
    });
    const [search, setSearch] = useState("");

    const rows = useMemo(
        () => (analysis ? buildFindingRows(analysis) : []),
        [analysis],
    );

    const filteredRows = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        const filtered = rows.filter((row) => {
            if (!matchesCategory(row, filter)) {
                return false;
            }
            if (!normalizedSearch) return true;
            const hay =
                `${row.name} ${row.username ?? ""} ${row.domain ?? ""}`.toLowerCase();
            return hay.includes(normalizedSearch);
        });

        return filtered.sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "strength") {
                return (a.strength?.score ?? 5) - (b.strength?.score ?? 5);
            }
            if (sort === "age") {
                return (b.passwordAgeDays ?? 0) - (a.passwordAgeDays ?? 0);
            }
            if (sort === "reuse") {
                return b.reuseCount - a.reuseCount;
            }
            // risk
            const rank = (row: SecurityFindingRow) => {
                if (isCriticalFinding(row)) return 0;
                if (row.strength?.score === 2) return 1;
                return 2;
            };
            return (
                rank(a) - rank(b) ||
                (a.strength?.score ?? 5) - (b.strength?.score ?? 5) ||
                b.reuseCount - a.reuseCount ||
                (b.passwordAgeDays ?? 0) - (a.passwordAgeDays ?? 0) ||
                a.name.localeCompare(b.name)
            );
        });
    }, [filter, rows, search, sort]);

    const categories: Array<{
        value: Exclude<FindingFilter, "all">;
        label: string;
        short: string;
        hint: string;
    }> = [
        {
            value: "reused",
            label: "Reused passwords",
            short: "Reused",
            hint: `Across ${analysis?.reuseGroups.length ?? 0} shared password groups`,
        },
        {
            value: "critical",
            label: "Critically weak",
            short: "Critical",
            hint: "Easy to guess. Change these first.",
        },
        {
            value: "weak",
            label: "Weak passwords",
            short: "Weak",
            hint: "Could be stronger",
        },
        {
            value: "old",
            label: "Old passwords",
            short: "Old",
            hint: "Last changed a year or more ago",
        },
    ];
    const counts = {
        all: rows.length,
        reused: rows.filter((row) => matchesCategory(row, "reused")).length,
        critical: rows.filter((row) => matchesCategory(row, "critical")).length,
        weak: rows.filter((row) => matchesCategory(row, "weak")).length,
        old: rows.filter((row) => matchesCategory(row, "old")).length,
    };
    const urgentCount = rows.filter(isCriticalFinding).length;
    const openFindings = (category: FindingFilter) => {
        if (!findings) {
            router.push({
                pathname: "/(app)/settings/security-report/findings",
                params: { filter: category },
            });
            return;
        }
        setFilter(category);
        setSort(
            category === "reused"
                ? "reuse"
                : category === "old"
                  ? "age"
                  : "risk",
        );
        setSearch("");
    };
    const displayRows = useMemo(() => {
        if (filter !== "reused") return filteredRows;
        const groups = new Map<string, SecurityFindingRow[]>();
        for (const row of filteredRows) {
            const key = row.reuseGroup?.[0]?.credentialId ?? row.credentialId;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }
        return Array.from(groups.values()).flat();
    }, [filter, filteredRows]);
    const renderFinding = (row: SecurityFindingRow) => {
        const reasons = [
            row.reuseCount > 1
                ? `Reused across ${row.reuseCount} accounts`
                : "",
            row.strength ? `${row.strength.strengthLabel} password` : "",
            row.passwordAgeDays != null
                ? `Changed ${formatPasswordAge(row.passwordAgeDays)} ago`
                : "",
        ]
            .filter(Boolean)
            .join("; ");
        return (
            <Pressable
                key={row.credentialId}
                accessibilityRole="button"
                accessibilityLabel={`${row.name || "Untitled"}. ${reasons}. Open credential.`}
                android_ripple={{ color: colors.border }}
                onPress={() =>
                    router.push({
                        pathname:
                            "/(app)/settings/security-report/credential/[id]",
                        params: {
                            id: row.credentialId,
                            returnTo: "security-report",
                        },
                    })
                }
                style={{
                    minHeight: 76,
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 13,
                    }}
                >
                    <KeyRound
                        size={22}
                        color={
                            isCriticalFinding(row)
                                ? colors.primary
                                : colors.muted
                        }
                        strokeWidth={1.7}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 14, fontWeight: "500" }}>
                            {row.name || "Untitled"}
                        </Text>
                        {row.username || row.domain ? (
                            <Text
                                numberOfLines={1}
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    marginTop: 4,
                                }}
                            >
                                {[row.username, row.domain]
                                    .filter(Boolean)
                                    .join("; ")}
                            </Text>
                        ) : null}
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 12,
                                lineHeight: 18,
                                marginTop: 6,
                            }}
                        >
                            {reasons}
                        </Text>
                    </View>
                    <ChevronRight size={17} color={colors.muted} />
                </View>
            </Pressable>
        );
    };

    return (
        <UnlockedTaskScreen
            scroll={false}
            title={findings ? "Security findings" : "Security report"}
        >
            <FlatList<SecurityFindingRow>
                key={findings ? "findings" : "dashboard"}
                data={analysis && findings ? displayRows : []}
                keyExtractor={(row) => row.credentialId}
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: 24,
                    paddingBottom: 30,
                }}
                renderItem={({ item, index }) => (
                    <>
                        {filter === "reused" &&
                        (index === 0 ||
                            item.reuseGroup?.[0]?.credentialId !==
                                displayRows[index - 1]?.reuseGroup?.[0]
                                    ?.credentialId) ? (
                            <Text
                                style={{
                                    fontSize: 12,
                                    lineHeight: 18,
                                    color: colors.muted,
                                    marginTop: 16,
                                }}
                            >
                                Same password used by {item.reuseCount} accounts
                                {search.trim()
                                    ? " (showing search matches)"
                                    : ""}
                            </Text>
                        ) : null}
                        {renderFinding(item)}
                    </>
                )}
                ListHeaderComponent={
                    <>
                        <View
                            style={{
                                paddingBottom: 20,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 22,
                                    fontWeight: "500",
                                    marginTop: 10,
                                    letterSpacing: -0.5,
                                }}
                            >
                                {findings
                                    ? "Review your findings"
                                    : "Password health"}
                            </Text>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    lineHeight: 20,
                                    marginTop: 6,
                                }}
                            >
                                {findings
                                    ? "Open a credential to review its password and make changes."
                                    : "A clear overview, then the passwords worth your attention."}
                            </Text>
                        </View>
                        {running ? (
                            <View
                                style={{ paddingVertical: 18, gap: 10 }}
                                accessibilityLiveRegion="polite"
                            >
                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 10,
                                    }}
                                >
                                    <ActivityIndicator
                                        size="small"
                                        color={colors.primary}
                                    />
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 13,
                                        }}
                                    >
                                        {analysis
                                            ? "Updating report…"
                                            : "Analyzing passwords…"}{" "}
                                        {progress.total > 0
                                            ? `${progress.processed} of ${progress.total} checked`
                                            : ""}
                                    </Text>
                                </View>
                                {progress.total > 0 ? (
                                    <View
                                        style={{
                                            height: 3,
                                            backgroundColor: colors.border,
                                            borderRadius: 2,
                                        }}
                                    >
                                        <View
                                            style={{
                                                height: 3,
                                                backgroundColor: colors.primary,
                                                borderRadius: 2,
                                                width: `${Math.min(100, (progress.processed / progress.total) * 100)}%`,
                                            }}
                                        />
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                        {error ? (
                            <Text
                                accessibilityLiveRegion="polite"
                                style={{
                                    color: colors.primary,
                                    fontSize: 13,
                                    lineHeight: 20,
                                    marginTop: 18,
                                }}
                            >
                                {analysis
                                    ? "Report could not be updated. Previous results are still shown."
                                    : "Could not analyze this vault. Try again."}
                            </Text>
                        ) : null}

                        {analysis && !findings ? (
                            <>
                                <View style={{ paddingVertical: 24, gap: 8 }}>
                                    {analysis.analyzedCount === 0 ? (
                                        <>
                                            <KeyRound
                                                size={28}
                                                color={colors.muted}
                                            />
                                            <Text
                                                style={{
                                                    fontSize: 22,
                                                    fontWeight: "500",
                                                }}
                                            >
                                                No passwords to check
                                            </Text>
                                            <Text
                                                style={{
                                                    color: colors.muted,
                                                    fontSize: 13,
                                                    lineHeight: 20,
                                                }}
                                            >
                                                Add a password to a credential
                                                to include it in this report.
                                            </Text>
                                        </>
                                    ) : rows.length === 0 ? (
                                        <>
                                            <ShieldCheck
                                                size={28}
                                                color={colors.success}
                                            />
                                            <Text
                                                style={{
                                                    fontSize: 22,
                                                    fontWeight: "500",
                                                }}
                                            >
                                                No issues found
                                            </Text>
                                            <Text
                                                style={{
                                                    color: colors.muted,
                                                    fontSize: 13,
                                                    lineHeight: 20,
                                                }}
                                            >
                                                No weak, reused, or old
                                                passwords were found by these
                                                checks.
                                            </Text>
                                        </>
                                    ) : (
                                        <>
                                            <Text
                                                style={{
                                                    fontSize: 42,
                                                    lineHeight: 48,
                                                    fontWeight: "500",
                                                    letterSpacing: -1,
                                                    color: urgentCount
                                                        ? colors.primary
                                                        : colors.foreground,
                                                }}
                                            >
                                                {rows.length}
                                            </Text>
                                            <Text
                                                style={{
                                                    fontSize: 16,
                                                    fontWeight: "500",
                                                }}
                                            >
                                                credential
                                                {rows.length === 1 ? "" : "s"}{" "}
                                                to review
                                            </Text>
                                            <Text
                                                style={{
                                                    color: colors.muted,
                                                    fontSize: 13,
                                                    lineHeight: 20,
                                                }}
                                            >
                                                {urgentCount
                                                    ? `${urgentCount} with reused or critically weak passwords. Start there.`
                                                    : counts.weak
                                                      ? "Focus on making weak passwords stronger."
                                                      : "Only age reminders remain. Review whether changes are needed."}
                                            </Text>
                                        </>
                                    )}
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 12,
                                            marginTop: 4,
                                        }}
                                    >
                                        {analysis.analyzedCount} passwords
                                        checked on this device
                                    </Text>
                                </View>
                                {analysis.analyzedCount > 0 ? (
                                    <>
                                        {categories.map((category) => (
                                            <Pressable
                                                key={category.value}
                                                disabled={
                                                    counts[category.value] === 0
                                                }
                                                accessibilityRole={
                                                    counts[category.value]
                                                        ? "button"
                                                        : "text"
                                                }
                                                accessibilityLabel={`${category.label}, ${counts[category.value]}`}
                                                onPress={() =>
                                                    openFindings(category.value)
                                                }
                                                android_ripple={{
                                                    color: colors.border,
                                                }}
                                                style={{
                                                    minHeight: 76,
                                                    paddingVertical: 14,
                                                    borderBottomWidth: 1,
                                                    borderBottomColor:
                                                        colors.border,
                                                }}
                                            >
                                                <View
                                                    style={{
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        gap: 14,
                                                    }}
                                                >
                                                    <View style={{ flex: 1 }}>
                                                        <Text
                                                            style={{
                                                                fontSize: 14,
                                                                fontWeight:
                                                                    "500",
                                                            }}
                                                        >
                                                            {category.label}
                                                        </Text>
                                                        <Text
                                                            style={{
                                                                fontSize: 12,
                                                                lineHeight: 18,
                                                                marginTop: 5,
                                                                color: colors.muted,
                                                            }}
                                                        >
                                                            {category.hint}
                                                        </Text>
                                                    </View>
                                                    <Text
                                                        style={{
                                                            fontSize: 24,
                                                            fontWeight: "500",
                                                            color:
                                                                counts[
                                                                    category
                                                                        .value
                                                                ] > 0 &&
                                                                (category.value ===
                                                                    "reused" ||
                                                                    category.value ===
                                                                        "critical")
                                                                    ? colors.primary
                                                                    : colors.muted,
                                                        }}
                                                    >
                                                        {counts[category.value]}
                                                    </Text>
                                                    {counts[category.value] ? (
                                                        <ChevronRight
                                                            size={17}
                                                            color={colors.muted}
                                                        />
                                                    ) : (
                                                        <View
                                                            style={{
                                                                width: 17,
                                                            }}
                                                        />
                                                    )}
                                                </View>
                                            </Pressable>
                                        ))}
                                        <Text
                                            style={{
                                                color: colors.muted,
                                                fontSize: 11,
                                                lineHeight: 17,
                                                marginTop: 12,
                                            }}
                                        >
                                            A credential can appear in more than
                                            one category.
                                        </Text>
                                        {rows.length > 0 ? (
                                            <Button
                                                className="mt-5"
                                                onPress={() =>
                                                    openFindings("all")
                                                }
                                            >
                                                View all findings
                                            </Button>
                                        ) : null}
                                    </>
                                ) : null}
                            </>
                        ) : analysis && findings ? (
                            <>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    style={{ flexGrow: 0, marginVertical: 16 }}
                                    contentContainerStyle={{ gap: 20 }}
                                >
                                    {[
                                        { value: "all" as const, short: "All" },
                                        ...categories,
                                    ].map((category) => (
                                        <Pressable
                                            key={category.value}
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected:
                                                    filter === category.value,
                                            }}
                                            onPress={() =>
                                                openFindings(category.value)
                                            }
                                            android_ripple={{
                                                color: colors.border,
                                            }}
                                            style={{
                                                minHeight: 48,
                                                justifyContent: "center",
                                                borderBottomWidth: 2,
                                                borderBottomColor:
                                                    filter === category.value
                                                        ? colors.primary
                                                        : "transparent",
                                            }}
                                        >
                                            <Text
                                                style={{
                                                    color:
                                                        filter ===
                                                        category.value
                                                            ? colors.foreground
                                                            : colors.muted,
                                                    fontSize: 13,
                                                }}
                                            >
                                                {category.short}{" "}
                                                {counts[category.value]}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </ScrollView>
                                <Label>Filter findings</Label>
                                <Input
                                    value={search}
                                    onChangeText={setSearch}
                                    placeholder="Name, username, or website"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    accessibilityLabel="Filter security findings"
                                />
                                <Button
                                    variant="ghost"
                                    className="mt-3 flex-row justify-between gap-3 rounded-none border-b border-border px-0"
                                    accessibilityLabel={`Sort by ${SORT_LABELS[sort]}`}
                                    onPress={() =>
                                        setSort(
                                            SORT_CYCLE[
                                                (SORT_CYCLE.indexOf(sort) + 1) %
                                                    SORT_CYCLE.length
                                            ]!,
                                        )
                                    }
                                >
                                    <ArrowUpDown
                                        size={20}
                                        color={colors.muted}
                                    />
                                    <Text style={{ flex: 1, fontSize: 13 }}>
                                        Change sort
                                    </Text>
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 12,
                                        }}
                                    >
                                        {SORT_LABELS[sort]}
                                    </Text>
                                </Button>
                                <Text
                                    style={{
                                        color: colors.muted,
                                        fontSize: 12,
                                        marginTop: 20,
                                        marginBottom: 6,
                                    }}
                                >
                                    {filteredRows.length} credential
                                    {filteredRows.length === 1 ? "" : "s"}
                                </Text>
                                {filteredRows.length === 0 ? (
                                    <View
                                        style={{ paddingVertical: 24, gap: 12 }}
                                    >
                                        <Text
                                            style={{
                                                color: colors.muted,
                                                fontSize: 13,
                                                lineHeight: 20,
                                            }}
                                        >
                                            {search.trim()
                                                ? "No findings match your search."
                                                : "No findings in this category."}
                                        </Text>
                                        {search.trim() ? (
                                            <Button
                                                variant="outline"
                                                onPress={() => setSearch("")}
                                            >
                                                Clear search
                                            </Button>
                                        ) : null}
                                    </View>
                                ) : null}
                            </>
                        ) : null}
                    </>
                }
                ListFooterComponent={
                    <>
                        <View
                            style={{
                                marginTop: 24,
                                borderLeftWidth: 2,
                                borderLeftColor: colors.muted,
                                paddingLeft: 13,
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    lineHeight: 18,
                                }}
                            >
                                Checks password strength, reuse, and age.
                                Data breaches are not checked. Age alone does
                                not mean a password is compromised.
                            </Text>
                        </View>
                        <Button
                            className="mt-5"
                            variant="outline"
                            loading={running}
                            onPress={refresh}
                        >
                            {error ? "Try again" : "Refresh report"}
                        </Button>
                    </>
                }
            />
        </UnlockedTaskScreen>
    );
}

export default function SecurityReportRoute() {
    return <SecurityReportScreen />;
}
