"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Plus,
    List,
    Network,
    RefreshCw,
    Crown,
    Globe,
    HelpCircle,
    Monitor,
    Server,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { DeviceMap } from "./device-map";
import { getDeviceConnectionDisplay } from "./device-status";
import {
    formatRelativeAccountDate,
    isCustomSignaling,
    type DeviceRelationshipMap,
    type DeviceNode,
} from "./account-dialog/device-topology";
import type { DeviceControls } from "./device-controls";
export type DeviceSelection = { kind: "node" | "edge"; id: string };
export type DevicesPanelProps = {
    refresh?: {
        loading: boolean;
        message: string;
        available: boolean;
        onRefresh: () => void;
    };
    map: DeviceRelationshipMap;
    controls: DeviceControls;
    selectedLocalId?: string;
    selectionToken?: number;
    requestedSection?: "remove";
    isRoot: boolean;
    canPromote: boolean;
    busy: boolean;
    onRemove: (id: string) => Promise<void>;
    onToggleRoot: (id: string, root: boolean) => Promise<void>;
    expanded: boolean;
    onExpand: () => void;
};
const PAGE_SIZE = 10;
const ROOT_DESCRIPTION =
    "Root access allows this device to link and remove account devices, manage account recovery, and delete the Online Services account.";
function NodeIcon({
    node,
    selected = false,
}: {
    node: DeviceNode;
    selected?: boolean;
}) {
    const Icon = node.current
        ? Globe
        : node.localDevices.length
          ? Monitor
          : HelpCircle;
    const custom = node.localDevices.some((d) => isCustomSignaling(d));
    return (
        <span
            className={cn(
                "relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-muted/30",
                selected &&
                    "border-blue-500/30 bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-400/10",
            )}
        >
            <Icon
                className={cn(
                    "h-4 w-4",
                    selected
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground",
                )}
            />
            {custom && (
                <Server
                    aria-label="Uses custom signaling"
                    className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-sm bg-card text-violet-600 dark:text-violet-400"
                />
            )}
        </span>
    );
}
export function DevicesPanel({
    map,
    refresh,
    controls,
    selectedLocalId,
    selectionToken,
    requestedSection,
    isRoot,
    canPromote,
    busy,
    onRemove,
    onToggleRoot,
    expanded,
    onExpand,
}: DevicesPanelProps) {
    const refreshDeadline = useRef(0);
    const [cooldown, setCooldown] = useState(0);
    const coolingDown = cooldown > 0;
    useEffect(() => {
        if (!coolingDown) return;
        const timer = window.setInterval(() => {
            setCooldown(
                Math.max(
                    0,
                    Math.ceil((refreshDeadline.current - Date.now()) / 1000),
                ),
            );
        }, 1000);
        return () => window.clearInterval(timer);
    }, [coolingDown]);
    const refreshLabel = refresh?.loading
        ? "Refreshing devices"
        : cooldown
          ? `Refresh available in ${cooldown}s`
          : "Refresh devices";
    const refreshDevices = () => {
        if (!refresh || refresh.loading || Date.now() < refreshDeadline.current)
            return;
        refreshDeadline.current = Date.now() + 10_000;
        setCooldown(10);
        refresh.onRefresh();
    };
    const [selection, setSelection] = useState<DeviceSelection>({
        kind: "node",
        id: map.currentDeviceId,
    });
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [page, setPage] = useState(0);
    const [view, setView] = useState<"list" | "map">("map");
    const [focusRequest, setFocusRequest] = useState<{
        nodeId: string;
        token: number;
    }>();
    const [linkOpen, setLinkOpen] = useState(false);
    const [confirm, setConfirm] = useState<{
        title: string;
        description: string;
        label: string;
        action: () => Promise<void>;
    } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [failedUnlinks, setFailedUnlinks] = useState<Set<string>>(
        () => new Set(),
    );
    const requestedNodeId = map.nodes.find((n) =>
        n.localDevices.some((d) => d.ID === selectedLocalId),
    )?.id;
    useEffect(() => {
        if (requestedNodeId) {
            setSelection({ kind: "node", id: requestedNodeId });
            setFocusRequest(undefined);
        }
    }, [requestedNodeId, selectionToken]);
    const effectiveSelection = (
        selection.kind === "node"
            ? map.nodes.some((n) => n.id === selection.id)
            : map.relationships.some((r) => r.id === selection.id)
    )
        ? selection
        : { kind: "node" as const, id: map.currentDeviceId };
    const node =
        effectiveSelection.kind === "node"
            ? map.nodes.find((n) => n.id === effectiveSelection.id)
            : undefined;
    const edge =
        effectiveSelection.kind === "edge"
            ? map.relationships.find((r) => r.id === effectiveSelection.id)
            : undefined;
    const removalRef = useRef<HTMLElement>(null);
    const handledRemovalRequest = useRef<number | undefined>(undefined);
    const [highlightRemoval, setHighlightRemoval] = useState(false);
    useEffect(() => {
        setHighlightRemoval(false);
        if (
            requestedSection !== "remove" ||
            !requestedNodeId ||
            node?.id !== requestedNodeId ||
            handledRemovalRequest.current === selectionToken ||
            !removalRef.current
        )
            return;
        handledRemovalRequest.current = selectionToken;
        setHighlightRemoval(true);
        removalRef.current.scrollIntoView({
            block: "nearest",
            behavior: "instant",
        });
        removalRef.current.focus({ preventScroll: true });
        const timeout = window.setTimeout(
            () => setHighlightRemoval(false),
            2400,
        );
        return () => window.clearTimeout(timeout);
    }, [requestedSection, requestedNodeId, node?.id, selectionToken]);
    const status = (local: DeviceNode["localDevices"][number] | undefined) => {
        if (!local) return { label: "Live status unknown", tone: "idle" };
        const current = controls.statuses[local.ID];
        if (!current) return { label: "Live status unknown", tone: "idle" };
        return getDeviceConnectionDisplay({
            ...current,
            lastSyncLabel: current.lastSync
                ? `synced ${formatRelativeAccountDate(current.lastSync)}`
                : "never synced",
        });
    };
    const connectedLinkIds = new Set(
        map.relationships
            .filter(
                (r) =>
                    r.localDevice &&
                    controls.statuses[r.localDevice.ID]?.webRTCStatus ===
                        WebRTCStatus.Connected,
            )
            .map((r) => r.id),
    );
    const unknownLinkIds = new Set(
        map.relationships
            .filter(
                (r) => !r.localDevice || !controls.statuses[r.localDevice.ID],
            )
            .map((r) => r.id),
    );
    const relationshipCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of map.relationships)
            for (const id of [r.fromDeviceId, r.toDeviceId])
                counts.set(id, (counts.get(id) ?? 0) + 1);
        return counts;
    }, [map]);
    const results = map.nodes
        .filter((n) => {
            const text = query.trim().toLowerCase();
            const matches =
                !text ||
                n.serverId?.toLowerCase().includes(text) ||
                n.localDevices.some(
                    (d) =>
                        d.ID.toLowerCase().includes(text) ||
                        d.Name.toLowerCase().includes(text),
                ) ||
                (n.current && "this device".includes(text));
            return (
                matches &&
                (filter === "all" ||
                    (filter === "local" && n.localDevices.length > 0) ||
                    (filter === "remote" &&
                        !n.current &&
                        !n.localDevices.length) ||
                    (filter === "isolated" && !relationshipCounts.has(n.id)))
            );
        })
        .sort(
            (a, b) =>
                Number(b.current) - Number(a.current) ||
                Number(b.localDevices.length > 0) -
                    Number(a.localDevices.length > 0) ||
                a.displayName.localeCompare(b.displayName),
        );
    const currentPage = Math.max(
        0,
        Math.min(page, Math.ceil(results.length / PAGE_SIZE) - 1),
    );
    const pending = busy || confirmBusy || !!controls.unlinkingId;
    const chooseSelection = (next: DeviceSelection) => {
        setSelection(next);
        setFocusRequest(undefined);
    };
    const copy = async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            toast.success("ID copied.");
        } catch {
            toast.error(
                "Could not copy the ID. Select and copy it from the details.",
            );
        }
    };
    const relationshipButtons = (id: string) =>
        map.relationships
            .filter((r) => r.fromDeviceId === id || r.toDeviceId === id)
            .map((r) => {
                const peer = map.nodes.find(
                    (n) =>
                        n.id ===
                        (r.fromDeviceId === id ? r.toDeviceId : r.fromDeviceId),
                );
                return (
                    <button
                        key={r.id}
                        className="w-full rounded-md border p-2 text-left text-xs hover:bg-muted/40"
                        onClick={() =>
                            chooseSelection({ kind: "edge", id: r.id })
                        }
                    >
                        {peer?.displayName ?? "Unknown device"}
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                            {r.custom ? "Custom signaling" : "Online Services"}
                            <br />
                            {status(r.localDevice).label}
                        </span>
                    </button>
                );
            });
    const localDetail = (local: DeviceNode["localDevices"][number]) => {
        const relationship = map.relationships.find(
            (r) => r.localDevice?.ID === local.ID,
        );
        const custom = isCustomSignaling(local);
        const connected =
            controls.statuses[local.ID]?.webRTCStatus ===
            WebRTCStatus.Connected;
        const connecting =
            controls.statuses[local.ID]?.webRTCStatus ===
            WebRTCStatus.Connecting;
        const lastSync =
            controls.statuses[local.ID]?.lastSync ?? local.LastSync;
        return (
            <section key={local.ID} className="space-y-3 border-t pt-4">
                <Badge
                    variant="outline"
                    className={
                        custom
                            ? "gap-1 border-violet-500/25 bg-violet-500/5 text-violet-700 dark:text-violet-300"
                            : ""
                    }
                >
                    {custom && <Server className="h-3 w-3" />}
                    {custom ? "Custom signaling" : "Online Services link"}
                </Badge>
                {relationship?.missingOnServer && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                        This saved link uses Online Services, but its
                        relationship was not found in the latest account data.
                    </p>
                )}
                {!custom && !map.topologyVerified && (
                    <p className="text-xs text-muted-foreground">
                        Account relationship could not be verified.
                    </p>
                )}
                <dl className="space-y-2 text-xs">
                    <Field label="Connection" value={status(local).label} />
                    <Field
                        label="Last successful sync"
                        value={
                            lastSync
                                ? formatRelativeAccountDate(lastSync)
                                : "Never synced"
                        }
                    />
                    <Field
                        label="Linked"
                        value={formatRelativeAccountDate(
                            local.LinkedAtTimestamp,
                        )}
                    />
                </dl>
                <div className="flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        disabled={pending || connecting}
                        onClick={() =>
                            connected
                                ? controls.onSync(local)
                                : controls.onConnect(local)
                        }
                    >
                        {connected ? "Sync now" : "Connect"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => controls.onEdit(local)}
                    >
                        Edit name and sync settings
                    </Button>
                </div>
                {custom && (
                    <dl className="space-y-2 text-xs">
                        <Field
                            label="Signaling server"
                            value={
                                controls.signalingConfig.signalingServers.find(
                                    (s) => s.ID === local.SignalingServerID,
                                )?.Host ?? "Configuration unavailable"
                            }
                        />
                        <Field
                            label="STUN servers"
                            value={
                                local.STUNServerIDs.length
                                    ? local.STUNServerIDs.map(
                                          (id) =>
                                              controls.signalingConfig.stunServers.find(
                                                  (s) => s.ID === id,
                                              )?.Host ??
                                              "Configuration unavailable",
                                      ).join(", ")
                                    : "Online Services"
                            }
                        />
                        <Field
                            label="TURN servers"
                            value={
                                local.TURNServerIDs.length
                                    ? local.TURNServerIDs.map(
                                          (id) =>
                                              controls.signalingConfig.turnServers.find(
                                                  (s) => s.ID === id,
                                              )?.Host ??
                                              "Configuration unavailable",
                                      ).join(", ")
                                    : "Online Services"
                            }
                        />
                    </dl>
                )}
                <dl className="space-y-2 text-xs text-muted-foreground">
                    <Field
                        label="Connect automatically"
                        value={local.AutoConnect ? "On" : "Off"}
                    />
                    <Field
                        label="Sync automatically"
                        value={local.AutoSync ? "On" : "Off"}
                    />
                </dl>
            </section>
        );
    };
    const removalActions = (local: DeviceNode["localDevices"][number]) => {
        const relationship = map.relationships.find(
            (r) => r.localDevice?.ID === local.ID,
        );
        const custom = isCustomSignaling(local);
        const confirmedMissing =
            !custom && map.topologyVerified && !!relationship?.missingOnServer;
        const canCleanup =
            !custom && (confirmedMissing || failedUnlinks.has(local.ID));
        const unlinkUnverified =
            !custom &&
            (!map.topologyVerified || !relationship?.recordedOnServer);
        const unlinkDescription = custom
            ? "Remove this direct sync link from this vault's Linked Devices list."
            : "Remove this sync relationship from Online Services and its entry from this vault's Linked Devices list. Keep the device's account registration.";
        return (
            <div key={local.ID} className="space-y-2">
                {node && node.localDevices.length > 1 && (
                    <p className="text-xs font-medium">
                        {local.Name || local.ID}
                    </p>
                )}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span
                                className="block"
                                tabIndex={unlinkUnverified ? 0 : undefined}
                            >
                                <Button
                                    variant="outline"
                                    className="w-full text-destructive"
                                    size="sm"
                                    disabled={pending || unlinkUnverified}
                                    onClick={() =>
                                        setConfirm({
                                            title: `Unlink ${local.Name || "this device"}?`,
                                            description:
                                                unlinkDescription +
                                                " Vault contents already stored on either device will remain.",
                                            label: custom
                                                ? "Unlink from this vault"
                                                : "Unlink devices",
                                            action: async () => {
                                                try {
                                                    await controls.onUnlink(
                                                        local,
                                                    );
                                                    setFailedUnlinks(
                                                        (previous) => {
                                                            const next =
                                                                new Set(
                                                                    previous,
                                                                );
                                                            next.delete(
                                                                local.ID,
                                                            );
                                                            return next;
                                                        },
                                                    );
                                                } catch (error) {
                                                    if (!custom) {
                                                        setFailedUnlinks(
                                                            (previous) =>
                                                                new Set(
                                                                    previous,
                                                                ).add(local.ID),
                                                        );
                                                        setConfirm(null);
                                                    }
                                                    throw error;
                                                }
                                            },
                                        })
                                    }
                                >
                                    {custom
                                        ? "Unlink from this vault"
                                        : "Unlink devices"}
                                </Button>
                            </span>
                        </TooltipTrigger>
                        {unlinkUnverified && (
                            <TooltipContent className="max-w-xs">
                                {confirmedMissing
                                    ? "The latest account lookup confirms this relationship is missing. Remove the saved link from this vault below."
                                    : "Verify this relationship with Online Services before unlinking. A failed lookup or lack of root access does not mean the link is missing."}
                            </TooltipContent>
                        )}
                    </Tooltip>
                </TooltipProvider>
                <p className="text-xs text-muted-foreground">
                    {unlinkDescription}
                </p>
                {canCleanup && (
                    <div className="space-y-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-3">
                        <p className="text-xs text-muted-foreground">
                            {confirmedMissing
                                ? "The latest account lookup confirms this sync relationship is missing. Remove its saved link from this vault's Linked Devices list."
                                : "Unlinking failed. You can remove the saved link from this vault's Linked Devices list, but its Online Services sync relationship may remain."}
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-muted-foreground"
                            disabled={pending}
                            onClick={() =>
                                setConfirm({
                                    title: "Remove this saved link from the vault?",
                                    description:
                                        "Remove this link from this vault's Linked Devices list, including its saved device name, connection settings, and automatic connection and sync preferences. This does not change Online Services; any sync relationship there may remain. Vault contents already stored on either device will remain.",
                                    label: "Remove saved link",
                                    action: () =>
                                        controls.onUnlink(local, true),
                                })
                            }
                        >
                            Remove saved link from this vault
                        </Button>
                    </div>
                )}
            </div>
        );
    };
    return (
        <div className="flex min-h-0 flex-col lg:h-full">
            <div
                className={cn(
                    "grid shrink-0 overflow-hidden rounded-lg border lg:min-h-0 lg:flex-1 lg:shrink lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
                    expanded && "lg:grid-cols-[minmax(0,1fr)_20rem]",
                )}
            >
                <div
                    className={cn(
                        "flex min-h-0 flex-col lg:h-full lg:border-r",
                        view === "map" && "h-[30rem]",
                    )}
                >
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b p-2">
                        <label className="min-w-[7rem] flex-1">
                            <span className="sr-only">
                                Find device by ID or local name
                            </span>
                            <Input
                                className="h-8"
                                title="Search by device ID or a name saved in this vault"
                                placeholder="Search devices…"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setPage(0);
                                    setView("list");
                                }}
                            />
                        </label>
                        <select
                            aria-label="Filter devices"
                            className="h-8 w-[6.5rem] rounded-md border bg-background px-1 text-xs"
                            value={filter}
                            onChange={(e) => {
                                setFilter(e.target.value);
                                setPage(0);
                                setView("list");
                            }}
                        >
                            <option value="all">All devices</option>
                            <option value="local">Linked to this vault</option>
                            <option value="remote">No local name</option>
                            <option value="isolated">No recorded links</option>
                        </select>
                        {refresh?.available && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span
                                            className="inline-flex"
                                            tabIndex={
                                                refresh.loading || cooldown > 0
                                                    ? 0
                                                    : undefined
                                            }
                                            aria-label={refreshLabel}
                                        >
                                            <Button
                                                className="h-8 w-8"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Refresh devices"
                                                disabled={
                                                    refresh.loading ||
                                                    cooldown > 0
                                                }
                                                onClick={refreshDevices}
                                            >
                                                <RefreshCw
                                                    className={cn(
                                                        "h-4 w-4",
                                                        refresh.loading &&
                                                            "animate-spin",
                                                    )}
                                                />
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {refreshLabel}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        <Button
                            className="ml-auto h-8 w-8 shrink-0"
                            size="icon"
                            variant="outline"
                            aria-label={
                                view === "list"
                                    ? "View connection map"
                                    : "View device list"
                            }
                            title={
                                view === "list"
                                    ? "View connection map"
                                    : "View device list"
                            }
                            onClick={() => {
                                setView(view === "list" ? "map" : "list");
                                if (expanded) onExpand();
                            }}
                        >
                            {view === "list" ? (
                                <Network className="h-4 w-4" />
                            ) : (
                                <List className="h-4 w-4" />
                            )}
                        </Button>
                        <Button
                            size="sm"
                            className="h-8 shrink-0 gap-1 px-2"
                            aria-label="Link device"
                            onClick={() => setLinkOpen(true)}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Link
                        </Button>
                    </div>
                    {refresh?.message && (
                        <p
                            role="status"
                            className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground"
                        >
                            {refresh.message}
                        </p>
                    )}
                    {view === "map" ? (
                        <DeviceMap
                            focusRequest={focusRequest}
                            map={map}
                            selection={effectiveSelection}
                            onSelect={chooseSelection}
                            connectedLinkIds={connectedLinkIds}
                            unknownLinkIds={unknownLinkIds}
                            expanded={expanded}
                            onExpand={onExpand}
                        />
                    ) : (
                        <>
                            <div className="border-b p-3 text-xs text-muted-foreground">
                                {results.length} matching / {map.nodes.length}{" "}
                                known devices
                            </div>
                            <div className="min-h-0 flex-1 p-2 lg:overflow-y-auto">
                                {results
                                    .slice(
                                        currentPage * PAGE_SIZE,
                                        (currentPage + 1) * PAGE_SIZE,
                                    )
                                    .map((n) => (
                                        <button
                                            key={n.id}
                                            aria-pressed={
                                                effectiveSelection.kind ===
                                                    "node" &&
                                                effectiveSelection.id === n.id
                                            }
                                            className={cn(
                                                "mb-1 flex w-full items-start gap-3 rounded-lg border border-transparent p-3 text-left hover:bg-muted/30",
                                                effectiveSelection.kind ===
                                                    "node" &&
                                                    effectiveSelection.id ===
                                                        n.id &&
                                                    "border-blue-500/30 bg-blue-500/[0.07] hover:bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-400/10",
                                            )}
                                            onClick={() =>
                                                chooseSelection({
                                                    kind: "node",
                                                    id: n.id,
                                                })
                                            }
                                        >
                                            <NodeIcon
                                                node={n}
                                                selected={
                                                    effectiveSelection.kind ===
                                                        "node" &&
                                                    effectiveSelection.id ===
                                                        n.id
                                                }
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center justify-between gap-2">
                                                    <span className="truncate text-sm font-medium">
                                                        {n.displayName}
                                                    </span>
                                                    {n.root && (
                                                        <Badge
                                                            variant="outline"
                                                            className="gap-1 border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                                        >
                                                            <Crown className="h-3 w-3" />
                                                            Root
                                                        </Badge>
                                                    )}
                                                </span>
                                                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                                                    {n.current
                                                        ? n.serverId
                                                            ? "Registered with Online Services"
                                                            : "Current vault"
                                                        : n.localDevices.length
                                                          ? "Name saved in this vault"
                                                          : "Name and device type unknown"}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "mt-1 block text-xs",
                                                        !n.current &&
                                                            status(
                                                                n
                                                                    .localDevices[0],
                                                            ).tone ===
                                                                "connected"
                                                            ? "text-emerald-700 dark:text-emerald-400"
                                                            : "text-muted-foreground",
                                                    )}
                                                >
                                                    {n.current
                                                        ? "Current session"
                                                        : status(
                                                              n.localDevices[0],
                                                          ).label}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                {results.length === 0 && (
                                    <p className="p-4 text-sm text-muted-foreground">
                                        No matching devices. Try an ID or a name
                                        saved in this vault.
                                    </p>
                                )}
                            </div>
                            <div className="mt-auto flex shrink-0 items-center justify-between border-t p-3">
                                <span className="text-xs text-muted-foreground">
                                    {results.length
                                        ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, results.length)} of ${results.length}`
                                        : "0 results"}
                                </span>
                                <div className="flex gap-1">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Previous devices"
                                        disabled={currentPage === 0}
                                        onClick={() => setPage(currentPage - 1)}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Next devices"
                                        disabled={
                                            (currentPage + 1) * PAGE_SIZE >=
                                            results.length
                                        }
                                        onClick={() => setPage(currentPage + 1)}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <div className="min-h-0 space-y-4 border-t bg-muted/10 p-4 lg:h-full lg:overflow-y-auto lg:border-t-0">
                    {node && (
                        <>
                            <div className="flex items-center gap-3">
                                <NodeIcon node={node} selected />
                                <h3 className="min-w-0 break-all text-sm font-semibold">
                                    {node.displayName}
                                </h3>
                                {node.root && (
                                    <Badge
                                        variant="outline"
                                        className="ml-auto shrink-0 gap-1 border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    >
                                        <Crown className="h-3 w-3" />
                                        Root
                                    </Badge>
                                )}
                            </div>
                            <div className="rounded-md border p-3">
                                <p className="text-xs text-muted-foreground">
                                    {node.serverId
                                        ? "Online Services device ID"
                                        : "Local device record ID"}
                                </p>
                                <button
                                    type="button"
                                    aria-label="Copy device ID"
                                    title="Copy device ID"
                                    disabled={
                                        !node.serverId && !node.localDevices[0]
                                    }
                                    className="mt-2 block w-full rounded text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                                    onClick={() =>
                                        void copy(
                                            node.serverId ??
                                                node.localDevices[0]!.ID,
                                        )
                                    }
                                >
                                    <code className="break-all text-xs">
                                        {node.serverId ??
                                            node.localDevices[0]?.ID ??
                                            "Current device"}
                                    </code>
                                </button>
                            </div>
                            {node.serverId && (
                                <dl className="space-y-2 text-xs">
                                    <Field
                                        label="Last seen by Online Services"
                                        value={formatRelativeAccountDate(
                                            node.lastSeen,
                                        )}
                                    />
                                    <Field
                                        label="Root access"
                                        value={
                                            node.root
                                                ? "Allowed"
                                                : "Not allowed"
                                        }
                                    />
                                </dl>
                            )}
                            {node.localDevices.map(localDetail)}
                            {(node.localDevices.length > 0 ||
                                (node.serverId &&
                                    isRoot &&
                                    !node.current &&
                                    !node.root)) && (
                                <section
                                    ref={removalRef}
                                    tabIndex={-1}
                                    className={cn(
                                        "space-y-3 border-t pt-4 outline-none transition-colors duration-500 motion-reduce:transition-none",
                                        highlightRemoval &&
                                            "rounded-md bg-blue-500/5 ring-2 ring-blue-500/30 ring-offset-4 ring-offset-background",
                                    )}
                                    aria-label="Remove device"
                                >
                                    <h4 className="text-xs font-medium">
                                        Remove device
                                    </h4>
                                    {node.localDevices.map(removalActions)}
                                    {node.serverId &&
                                        isRoot &&
                                        !node.current &&
                                        !node.root && (
                                            <div className="space-y-2 border-t pt-3">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="w-full text-destructive"
                                                    disabled={pending}
                                                    onClick={() =>
                                                        setConfirm({
                                                            title: `Remove ${node.displayName} from Online Services?`,
                                                            description:
                                                                "Remove this device's Online Services registration and all its Online Services sync relationships. Also remove its matching entries from this vault's Linked Devices list. Vault contents already stored on either device will remain.",
                                                            label: "Remove from Online Services",
                                                            action: () =>
                                                                onRemove(
                                                                    node.serverId!,
                                                                ),
                                                        })
                                                    }
                                                >
                                                    Remove from Online Services
                                                </Button>
                                                <p className="text-xs text-muted-foreground">
                                                    Remove the account
                                                    registration and all its
                                                    Online Services sync
                                                    relationships. Also remove
                                                    this device's matching
                                                    entries from this vault's
                                                    Linked Devices list.
                                                </p>
                                            </div>
                                        )}
                                    <p className="text-[11px] text-muted-foreground">
                                        Vault contents already stored on either
                                        device will remain.
                                    </p>
                                </section>
                            )}
                            <section className="space-y-2 border-t pt-4">
                                <h4 className="text-xs font-medium">
                                    Known relationships (
                                    {relationshipCounts.get(node.id) ?? 0})
                                </h4>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setView("map");
                                        setFocusRequest((previous) => ({
                                            nodeId: node.id,
                                            token: (previous?.token ?? 0) + 1,
                                        }));
                                    }}
                                >
                                    Explore connections
                                </Button>
                                <div className="space-y-2">
                                    {relationshipButtons(node.id)}
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Only relationships recorded in Online
                                    Services or this vault are shown.
                                </p>
                            </section>
                            {node.serverId && (
                                <section className="space-y-3 border-t pt-4">
                                    <h4 className="text-xs font-medium">
                                        Account permissions
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        {ROOT_DESCRIPTION}
                                    </p>
                                    {isRoot && canPromote && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                pending ||
                                                (node.root &&
                                                    map.rootCount <= 1)
                                            }
                                            onClick={() =>
                                                setConfirm({
                                                    title: `${node.root ? "Remove" : "Allow"} root access?`,
                                                    description: node.root
                                                        ? "This device will keep its registration and sync links but lose root permissions."
                                                        : ROOT_DESCRIPTION,
                                                    label: node.root
                                                        ? "Remove root access"
                                                        : "Allow root access",
                                                    action: () =>
                                                        onToggleRoot(
                                                            node.serverId!,
                                                            !node.root,
                                                        ),
                                                })
                                            }
                                        >
                                            {node.root
                                                ? "Remove root access"
                                                : "Allow root access"}
                                        </Button>
                                    )}
                                    {node.root && map.rootCount <= 1 && (
                                        <p className="text-xs text-muted-foreground">
                                            At least one device must retain root
                                            access.
                                        </p>
                                    )}
                                </section>
                            )}
                        </>
                    )}
                    {edge && (
                        <>
                            <h3 className="text-sm font-semibold">
                                Sync relationship
                            </h3>
                            <dl className="space-y-3 text-xs">
                                <Field
                                    label="Recorded in"
                                    value={
                                        edge.recordedOnServer
                                            ? edge.localDevice
                                                ? "Online Services and this vault"
                                                : "Online Services"
                                            : "This vault"
                                    }
                                />
                                <Field
                                    label="Signaling"
                                    value={
                                        edge.custom
                                            ? "Custom server"
                                            : "Online Services"
                                    }
                                />
                                <Field
                                    label="Connection"
                                    value={status(edge.localDevice).label}
                                />
                            </dl>
                            <button
                                type="button"
                                aria-label="Copy relationship ID"
                                title="Copy relationship ID"
                                className="block rounded text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                                onClick={() => void copy(edge.syncId)}
                            >
                                <code className="break-all text-xs">
                                    {edge.syncId}
                                </code>
                            </button>
                            {!edge.localDevice && (
                                <p className="text-xs text-muted-foreground">
                                    Online Services records this relationship.
                                    This device cannot observe its live
                                    connection or sync activity.
                                </p>
                            )}
                            {edge.missingOnServer && (
                                <p className="text-xs text-amber-600">
                                    This saved link uses Online Services, but
                                    its relationship was not found in the latest
                                    account data.
                                </p>
                            )}
                            <section
                                aria-label="Devices in this relationship"
                                className="border-t pt-3"
                            >
                                <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                                    Linked devices
                                </h4>
                                <div className="relative">
                                    <span
                                        aria-hidden="true"
                                        className="absolute bottom-7 left-[25px] top-7 border-l border-dashed border-muted-foreground/35"
                                    />
                                    {[edge.fromDeviceId, edge.toDeviceId].map(
                                        (id) => {
                                            const endpoint = map.nodes.find(
                                                (n) => n.id === id,
                                            );
                                            if (!endpoint) return null;
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    className="group relative flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                    onClick={() =>
                                                        chooseSelection({
                                                            kind: "node",
                                                            id,
                                                        })
                                                    }
                                                    aria-label={`View ${endpoint.displayName} details`}
                                                >
                                                    <span className="rounded-lg bg-background">
                                                        <NodeIcon
                                                            node={endpoint}
                                                        />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-sm font-medium">
                                                            {
                                                                endpoint.displayName
                                                            }
                                                        </span>
                                                        <span className="mt-0.5 block text-xs text-muted-foreground">
                                                            {endpoint.current
                                                                ? "Current session"
                                                                : endpoint
                                                                        .localDevices
                                                                        .length
                                                                  ? "Saved in this vault"
                                                                  : "Registered with Online Services"}
                                                        </span>
                                                    </span>
                                                    <ChevronRight
                                                        aria-hidden="true"
                                                        className="group-hover:translate-x-0.5 group-hover:text-foreground h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform"
                                                    />
                                                </button>
                                            );
                                        },
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>
            <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Link a device</DialogTitle>
                        <DialogDescription>
                            Choose how to start linking.
                        </DialogDescription>
                    </DialogHeader>
                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start whitespace-normal p-4 text-left"
                        onClick={() => {
                            setLinkOpen(false);
                            controls.onCreateInvitation();
                        }}
                    >
                        Create invitation
                        <span className="mt-2 text-xs font-normal text-muted-foreground">
                            Name the device, choose a transfer method, then
                            start linking.
                        </span>
                    </Button>
                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start whitespace-normal p-4 text-left"
                        onClick={() => {
                            setLinkOpen(false);
                            controls.onReceiveInvitation();
                        }}
                    >
                        Receive invitation
                        <span className="mt-2 text-xs font-normal text-muted-foreground">
                            Import a link package from the sending device.
                            Existing items stay; only missing data is added.
                        </span>
                    </Button>
                </DialogContent>
            </Dialog>
            <AlertDialog
                open={!!confirm}
                onOpenChange={(open) => {
                    if (!open && !confirmBusy) setConfirm(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirm?.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={confirmBusy}>
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            disabled={pending}
                            onClick={async () => {
                                if (!confirm) return;
                                setConfirmBusy(true);
                                try {
                                    await confirm.action();
                                    setConfirm(null);
                                } catch {
                                    /* The operation already displayed its error and any recovery action. */
                                } finally {
                                    setConfirmBusy(false);
                                }
                            }}
                        >
                            {confirmBusy ? "Working…" : confirm?.label}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-right">{value}</dd>
        </div>
    );
}
