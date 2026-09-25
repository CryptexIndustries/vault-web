import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    ArrowUpDown,
    CheckCircle2,
    ExternalLink,
    LoaderCircle,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
} from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type {
    SecurityAnalysisProgress,
    SecurityAnalysisResult,
    SecurityFindingIdentity,
    WeakPasswordFinding,
} from "@cryptex-industries/vault-core/vault-utils/security-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SecurityReportProps = {
    analysis: SecurityAnalysisResult | null;
    progress: SecurityAnalysisProgress | null;
    isAnalyzing: boolean;
    error: boolean;
    analyzedAt: number | null;
    onBack: () => void;
    onEditCredential: (credentialId: string) => void;
    onOpenCredentialUrl: (credentialId: string) => void;
    onRefresh: () => void;
};

type FindingFilter = "all" | "critical" | "improve" | "review";

type FindingSort = "risk" | "name" | "strength" | "reuse" | "age";

type SecurityFindingRow = SecurityFindingIdentity & {
    strength?: WeakPasswordFinding;
    reuseCount: number;
    reuseGroup?: SecurityFindingIdentity[];
    passwordAgeDays?: number;
};

const findingFilters: Array<{ value: FindingFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "critical", label: "Critical" },
    { value: "improve", label: "Improve" },
    { value: "review", label: "Review only" },
];

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

function isActionableFinding(row: SecurityFindingRow): boolean {
    return row.reuseCount > 1 || row.strength !== undefined;
}

function getFindingPriority(
    row: SecurityFindingRow,
): Exclude<FindingFilter, "all"> {
    if (isCriticalFinding(row)) return "critical";
    if (row.strength?.score === 2) return "improve";
    return "review";
}

function formatPasswordAge(days: number): string {
    const years = Math.floor(days / 365);
    const months = Math.min(11, Math.floor((days % 365) / 30));

    if (years === 0) return `${months}m`;
    return months > 0 ? `${years}y ${months}m` : `${years}y`;
}

function StrengthFinding({ finding }: { finding?: WeakPasswordFinding }) {
    if (!finding) {
        return <span className="text-xs text-foreground/60">No issue</span>;
    }

    return (
        <Badge
            variant="outline"
            className={
                finding.severity === "critical"
                    ? "border-destructive/60 bg-destructive/15 text-foreground"
                    : "border-primary/60 bg-primary/15 text-foreground"
            }
        >
            {finding.strengthLabel}
        </Badge>
    );
}

function ReuseFinding({
    credentialId,
    group,
}: {
    credentialId: string;
    group?: SecurityFindingIdentity[];
}) {
    if (!group || group.length < 2) {
        return <span className="text-xs text-foreground/60">-</span>;
    }

    const otherCount = group.length - 1;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`Show ${otherCount} ${otherCount === 1 ? "credential" : "credentials"} using the same password`}
                >
                    <Badge
                        variant="outline"
                        className="cursor-pointer border-destructive/60 bg-destructive/15 text-foreground"
                    >
                        With {otherCount}{" "}
                        {otherCount === 1 ? "other" : "others"}
                    </Badge>
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-3">
                <p className="text-sm font-medium">Reused with</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    These credentials use the same password.
                </p>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {group.map((credential) => {
                        if (credential.credentialId === credentialId)
                            return null;
                        const context = [credential.username, credential.domain]
                            .filter(Boolean)
                            .join(" - ");

                        return (
                            <div
                                key={credential.credentialId}
                                className="min-w-0 rounded-md border border-border px-2.5 py-2"
                            >
                                <p className="truncate text-sm font-medium">
                                    {credential.name}
                                </p>
                                {context ? (
                                    <p className="truncate text-xs text-muted-foreground">
                                        {context}
                                    </p>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function SecurityFindingGridRow({
    row,
    onEditCredential,
    onOpenCredentialUrl,
}: {
    row: SecurityFindingRow;
    onEditCredential: (credentialId: string) => void;
    onOpenCredentialUrl: (credentialId: string) => void;
}) {
    const context = [row.username, row.domain].filter(Boolean).join(" - ");

    return (
        <div className="border-b border-border px-3 py-3 sm:px-4">
            <div className="hidden min-w-0 grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.8fr)_auto] items-center gap-4 md:grid">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                        {row.name}
                    </p>
                    {context ? (
                        <p className="truncate text-xs text-foreground/65">
                            {context}
                        </p>
                    ) : null}
                </div>
                <StrengthFinding finding={row.strength} />
                <ReuseFinding
                    credentialId={row.credentialId}
                    group={row.reuseGroup}
                />
                <span className="text-sm text-foreground/75">
                    {row.passwordAgeDays === undefined
                        ? "-"
                        : formatPasswordAge(row.passwordAgeDays)}
                </span>
                <div className="flex items-center justify-end gap-1">
                    {row.domain ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                onOpenCredentialUrl(row.credentialId)
                            }
                        >
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            Open site
                        </Button>
                    ) : null}
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-foreground hover:text-foreground"
                        onClick={() => onEditCredential(row.credentialId)}
                    >
                        Edit
                    </Button>
                </div>
            </div>

            <div className="md:hidden">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                            {row.name}
                        </p>
                        {context ? (
                            <p className="truncate text-xs text-foreground/65">
                                {context}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {row.domain ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    onOpenCredentialUrl(row.credentialId)
                                }
                            >
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                Open site
                            </Button>
                        ) : null}
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-foreground hover:text-foreground"
                            onClick={() => onEditCredential(row.credentialId)}
                        >
                            Edit
                        </Button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {row.strength ? (
                        <StrengthFinding finding={row.strength} />
                    ) : null}
                    {row.reuseCount > 1 ? (
                        <ReuseFinding
                            credentialId={row.credentialId}
                            group={row.reuseGroup}
                        />
                    ) : null}
                    {row.passwordAgeDays !== undefined ? (
                        <Badge
                            variant="outline"
                            className="border-border bg-muted/40 text-foreground"
                        >
                            Age {formatPasswordAge(row.passwordAgeDays)}
                        </Badge>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function SecurityFindingGrid({
    rows,
    filter,
    onFilterChange,
    analyzedCount,
    onEditCredential,
    onOpenCredentialUrl,
}: {
    rows: SecurityFindingRow[];
    filter: FindingFilter;
    onFilterChange: (filter: FindingFilter) => void;
    analyzedCount: number;
    onEditCredential: (credentialId: string) => void;
    onOpenCredentialUrl: (credentialId: string) => void;
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const [sort, setSort] = useState<FindingSort>("risk");
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const visibleRows = useMemo(() => {
        const filtered = rows.filter((row) => {
            const matchesFilter =
                filter === "all" || getFindingPriority(row) === filter;
            if (!matchesFilter) return false;
            if (!normalizedSearch) return true;

            return [row.name, row.username, row.domain].some((value) =>
                value?.toLowerCase().includes(normalizedSearch),
            );
        });

        return filtered.sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "strength") {
                const strengthDifference =
                    (a.strength?.score ?? 5) - (b.strength?.score ?? 5);
                if (strengthDifference !== 0) return strengthDifference;
            }
            if (sort === "age") {
                const ageDifference =
                    (b.passwordAgeDays ?? -1) - (a.passwordAgeDays ?? -1);
                if (ageDifference !== 0) return ageDifference;
            }
            if (sort === "reuse") {
                const reuseDifference = b.reuseCount - a.reuseCount;
                if (reuseDifference !== 0) return reuseDifference;
            }
            if (sort === "risk") {
                const riskDifference =
                    (isCriticalFinding(a)
                        ? 0
                        : a.strength?.score === 2
                          ? 1
                          : 2) -
                    (isCriticalFinding(b)
                        ? 0
                        : b.strength?.score === 2
                          ? 1
                          : 2);
                if (riskDifference !== 0) return riskDifference;
            }

            return a.name.localeCompare(b.name);
        });
    }, [filter, normalizedSearch, rows, sort]);

    useEffect(() => {
        virtuosoRef.current?.scrollToIndex({ index: 0 });
    }, [filter, normalizedSearch, rows, sort]);

    const filterCounts = useMemo(() => {
        const counts: Record<FindingFilter, number> = {
            all: rows.length,
            critical: 0,
            improve: 0,
            review: 0,
        };
        for (const row of rows) counts[getFindingPriority(row)] += 1;
        return counts;
    }, [rows]);

    const emptyMessage =
        analyzedCount === 0
            ? "No active credential passwords were available to analyze."
            : normalizedSearch
              ? "No findings match your search."
              : "No findings match this filter.";

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className="pb-4">
                <CardTitle className="text-base">Credential findings</CardTitle>
                <CardDescription className="text-foreground/70">
                    Each credential appears once in a single priority category.
                </CardDescription>
                <div className="flex flex-wrap gap-2 pt-2">
                    {findingFilters.map((item) => (
                        <Button
                            key={item.value}
                            variant={
                                filter === item.value ? "secondary" : "outline"
                            }
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => onFilterChange(item.value)}
                            aria-pressed={filter === item.value}
                        >
                            {item.label}
                            <span className="text-foreground/60">
                                {filterCounts[item.value]}
                            </span>
                        </Button>
                    ))}
                </div>
                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(event) =>
                                setSearchQuery(event.target.value)
                            }
                            className="pl-9"
                            placeholder="Search findings"
                            aria-label="Search security findings"
                        />
                    </div>
                    <Select
                        value={sort}
                        onValueChange={(value: FindingSort) => setSort(value)}
                    >
                        <SelectTrigger
                            className="w-full sm:w-48"
                            aria-label="Sort security findings"
                        >
                            <ArrowUpDown className="mr-2 h-4 w-4 shrink-0" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="risk">Risk first</SelectItem>
                            <SelectItem value="name">
                                Credential name
                            </SelectItem>
                            <SelectItem value="strength">
                                Password strength
                            </SelectItem>
                            <SelectItem value="reuse">
                                Password reuse
                            </SelectItem>
                            <SelectItem value="age">Password age</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>

            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.8fr)_auto] gap-4 border-y border-border bg-muted/30 px-4 py-2 text-xs font-medium text-foreground/70 md:grid">
                <span>Credential</span>
                <span>Strength</span>
                <span>Reuse</span>
                <span>Password age</span>
                <span className="sr-only">Actions</span>
            </div>

            <CardContent className="h-[60vh] max-h-[42rem] min-h-80 p-0">
                {visibleRows.length > 0 ? (
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: "100%" }}
                        data={visibleRows}
                        computeItemKey={(_index, row) => row.credentialId}
                        increaseViewportBy={200}
                        itemContent={(_index, row) => (
                            <SecurityFindingGridRow
                                row={row}
                                onEditCredential={onEditCredential}
                                onOpenCredentialUrl={onOpenCredentialUrl}
                            />
                        )}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center p-8 text-center">
                        <div className="max-w-md">
                            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-primary" />
                            <p className="text-sm text-foreground/70">
                                {emptyMessage}
                            </p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function SecurityReport({
    analysis,
    progress,
    isAnalyzing,
    error,
    analyzedAt,
    onBack,
    onEditCredential,
    onOpenCredentialUrl,
    onRefresh,
}: SecurityReportProps) {
    const [filter, setFilter] = useState<FindingFilter>("all");
    const rows = useMemo(
        () => (analysis ? buildFindingRows(analysis) : []),
        [analysis],
    );
    const progressValue =
        progress && progress.total > 0
            ? Math.round((progress.processed / progress.total) * 100)
            : 0;
    const lastChecked = analyzedAt ? new Date(analyzedAt) : null;

    const actionCount = rows.filter(isActionableFinding).length;
    const actionHeadline =
        analysis?.healthBand === "good"
            ? "No password changes recommended"
            : analysis?.healthBand === "needs-attention"
              ? `${actionCount} ${actionCount === 1 ? "credential could" : "credentials could"} use a stronger password`
              : `${actionCount} ${actionCount === 1 ? "credential needs" : "credentials need"} attention`;
    const actionDescription =
        analysis?.healthBand === "good"
            ? "No reused or weak passwords were found."
            : analysis?.healthBand === "needs-attention"
              ? "Some passwords could be made stronger."
              : "Reused or critically weak passwords need your attention.";

    return (
        <main className="relative z-10 min-w-0 flex-1 overflow-y-auto bg-background text-foreground shadow-2xl">
            <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 mb-2 text-foreground/80 hover:text-foreground"
                        onClick={onBack}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to credentials
                    </Button>
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg border border-primary/20 bg-primary/10 p-2">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold text-foreground">
                                Security Report
                            </h1>
                            <p className="mt-1 text-sm text-foreground/75">
                                Passwords are analyzed only in this browser and
                                are never shown in the report.
                            </p>
                            {analysis ? (
                                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                    {lastChecked ? (
                                        <span>
                                            Last checked{" "}
                                            <time
                                                dateTime={lastChecked.toISOString()}
                                                title={lastChecked.toLocaleString()}
                                            >
                                                {lastChecked.toLocaleTimeString(
                                                    undefined,
                                                    {
                                                        hour: "numeric",
                                                        minute: "2-digit",
                                                    },
                                                )}
                                            </time>
                                        </span>
                                    ) : null}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1.5 px-2 text-xs"
                                        onClick={onRefresh}
                                        disabled={isAnalyzing}
                                    >
                                        <RefreshCw
                                            className={cn(
                                                "h-3.5 w-3.5",
                                                isAnalyzing && "animate-spin",
                                            )}
                                        />
                                        {isAnalyzing
                                            ? "Scanning…"
                                            : "Scan again"}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                {analysis ? (
                    <>
                        {isAnalyzing ? (
                            <div
                                className="flex items-center gap-3 border-y border-border py-3"
                                role="status"
                                aria-live="polite"
                            >
                                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="font-medium">
                                            Updating report…
                                        </span>
                                        {progress ? (
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {progress.processed} of{" "}
                                                {progress.total}
                                            </span>
                                        ) : null}
                                    </div>
                                    <Progress
                                        value={progressValue}
                                        className="mt-2 h-1"
                                        aria-label="Security report update progress"
                                    />
                                </div>
                            </div>
                        ) : error ? (
                            <div
                                className="flex items-center gap-3 border-y border-destructive/50 py-3 text-sm"
                                role="alert"
                            >
                                <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
                                The report could not be refreshed. Your last
                                completed results are still shown.
                            </div>
                        ) : null}

                        <div
                            className={cn(
                                "border-l-2 py-1 pl-3",
                                analysis.healthBand === "at-risk"
                                    ? "border-destructive"
                                    : "border-primary",
                            )}
                            role="status"
                        >
                            <p className="text-sm font-medium">
                                {actionHeadline}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {actionDescription}
                                {analysis.ageFindings.length > 0
                                    ? ` ${analysis.ageFindings.length} age-only ${analysis.ageFindings.length === 1 ? "review is" : "reviews are"} also available.`
                                    : ""}
                            </p>
                        </div>

                        <SecurityFindingGrid
                            rows={rows}
                            filter={filter}
                            onFilterChange={setFilter}
                            analyzedCount={analysis.analyzedCount}
                            onEditCredential={onEditCredential}
                            onOpenCredentialUrl={onOpenCredentialUrl}
                        />
                    </>
                ) : (
                    <Card
                        className={cn(
                            "shadow-sm",
                            error
                                ? "border-destructive/50 bg-destructive/10"
                                : "border-primary/40 bg-primary/5",
                        )}
                        role={error ? "alert" : "status"}
                        aria-live="polite"
                    >
                        <CardContent className="flex flex-col items-center p-8 text-center sm:p-10">
                            {error ? (
                                <ShieldAlert className="mb-4 h-8 w-8 text-destructive" />
                            ) : (
                                <LoaderCircle className="mb-4 h-8 w-8 animate-spin text-primary" />
                            )}
                            <p className="font-medium">
                                {error
                                    ? "Could not analyze this vault"
                                    : "Analyzing your vault"}
                            </p>
                            <p className="mt-1 max-w-md text-sm text-foreground/70">
                                {error
                                    ? "The local security analysis could not be completed. Return to credentials and try again."
                                    : "Checking active credential passwords locally in this browser."}
                            </p>
                            {!error ? (
                                <div className="mt-5 w-full max-w-md">
                                    <Progress
                                        value={progressValue}
                                        aria-label="Security report analysis progress"
                                        aria-valuetext={
                                            progress
                                                ? `${progress.processed} of ${progress.total} credentials analyzed`
                                                : "Preparing local analysis"
                                        }
                                    />
                                    <p className="mt-2 text-xs text-foreground/70">
                                        {progress
                                            ? `Analyzing ${progress.processed} of ${progress.total} credentials`
                                            : "Preparing local analysis…"}
                                    </p>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                )}
            </div>
        </main>
    );
}
