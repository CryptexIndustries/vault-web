import {
    useCallback,
    useDeferredValue,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
} from "react";
import {
    ActivityIndicator,
    Animated,
    Easing,
    Keyboard,
    Pressable,
    View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAtomValue } from "jotai";
import {
    Check,
    ChevronDown,
    Plus,
    QrCode,
    RotateCw,
    Search,
    Send,
    X,
} from "lucide-react-native";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import { unlockedVaultAtom } from "@/utils/atoms";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
    UnlockedMenuRow,
    UnlockedScreen,
    UnlockedText as Text,
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedDialogTitle,
} from "@/components/unlocked/unlocked-ui";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import { DeviceDetails } from "@/components/devices/device-details-sheet";
import { DeviceDetailsDialog } from "@/components/devices/device-details-dialog";
import { useDeviceActions } from "@/components/devices/use-device-actions";
import { useDeviceTopology } from "@/components/devices/use-device-topology";
import type { DeviceNode } from "@/components/account/device-topology";
import {
    DeviceList,
    DeviceSelectionSummary,
    filterDeviceNodes,
    type DeviceFilter,
    type DeviceSelection,
} from "@/components/devices/device-browser";
import { DeviceNetwork } from "@/components/devices/device-network";
import { copyTextToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";

const ROOT_DESCRIPTION =
    "Root access allows this device to link and remove account devices, manage account recovery, and delete the Online Services account.";
const FILTERS: { value: DeviceFilter; label: string }[] = [
    { value: "all", label: "All devices" },
    { value: "local", label: "Linked to this vault" },
    { value: "remote", label: "No local name" },
    { value: "isolated", label: "No recorded links" },
];

export default function DevicesScreen() {
    const vault = useAtomValue(unlockedVaultAtom);
    const { isTablet } = useBreakpoint();
    const account = useDeviceTopology();
    const toggleRootRef = useRef(account.toggleRoot);
    useLayoutEffect(() => {
        toggleRootRef.current = account.toggleRoot;
    }, [account.toggleRoot]);
    const { map } = account;
    const actions = useDeviceActions();
    const reducedMotion = useReducedMotion();
    const [linkOpen, setLinkOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [screenFocused, setScreenFocused] = useState(false);
    useFocusEffect(
        useCallback(() => {
            setScreenFocused(true);
            return () => {
                setScreenFocused(false);
                setDetailOpen(false);
            };
        }, []),
    );
    const [detailBusy, setDetailBusy] = useState(false);
    const [detailDismissible, setDetailDismissible] = useState(true);
    const [detailSheetVariant, setDetailSheetVariant] = useState<
        "devices" | "device-detail"
    >("device-detail");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [dismissedAccountError, setDismissedAccountError] = useState<
        string | null
    >(null);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const hasQuery = !!query;
    const searchInputStyle = useMemo(
        () => ({
            minHeight: 48,
            height: 48,
            borderRadius: 4,
            paddingLeft: 44,
            paddingRight: hasQuery ? 44 : 12,
            fontSize: 14,
            backgroundColor: colors.secondary,
        }),
        [hasQuery],
    );
    const [filter, setFilter] = useState<DeviceFilter>("all");
    const [scope, setScope] = useState<"all" | "local">("all");
    const [view, setView] = useState<"list" | "map">("map");
    const [listMounted, setListMounted] = useState(false);
    const [tabProgress] = useState(() => new Animated.Value(1));
    const previousView = useRef(view);
    const tabStyles = useMemo(
        () => ({
            map: {
                opacity: tabProgress,
                transform: [
                    {
                        translateX: tabProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-12, 0],
                        }),
                    },
                ],
            },
            list: {
                opacity: tabProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0],
                }),
                transform: [
                    {
                        translateX: tabProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 12],
                        }),
                    },
                ],
            },
        }),
        [tabProgress],
    );
    useEffect(() => {
        const target = view === "map" ? 1 : 0;
        if (previousView.current === view) {
            if (reducedMotion) tabProgress.setValue(target);
            return;
        }
        previousView.current = view;
        tabProgress.stopAnimation();
        if (reducedMotion) {
            tabProgress.setValue(target);
            return;
        }
        const transition = Animated.timing(tabProgress, {
            toValue: target,
            duration: 190,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        });
        transition.start();
        return () => transition.stop();
    }, [view, reducedMotion, tabProgress]);
    const [mapMounted, setMapMounted] = useState(false);
    const [mapReady, setMapReady] = useState(false);
    const [, prepareMap] = useTransition();
    const [hasSelectedDevice, setHasSelectedDevice] = useState(false);
    const [selection, setSelection] = useState<DeviceSelection | null>(null);
    const [focusId, setFocusId] = useState<string | null>(null);
    const [quickActionId, setQuickActionId] = useState<string | null>(null);
    const quickInFlight = useRef(false);
    const [confirm, setConfirm] = useState<{
        title: string;
        description: string;
        label: string;
        action: () => Promise<void>;
    } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const refreshDeadline = useRef(0);
    const [cooldown, setCooldown] = useState(0);
    const coolingDown = cooldown > 0;
    const pending =
        account.busy || confirmBusy || !!actions.pendingId || !!quickActionId;
    const validSelection =
        selection &&
        (selection.kind === "node"
            ? map.nodes.some((node) => node.id === selection.id)
            : map.relationships.some((edge) => edge.id === selection.id))
            ? selection
            : null;
    const effectiveSelection = validSelection ?? {
        kind: "node" as const,
        id: map.currentDeviceId,
    };
    const scopedMap = useMemo(
        () =>
            scope === "all"
                ? map
                : {
                      ...map,
                      nodes: map.nodes.filter(
                          (node) =>
                              node.current || node.localDevices.length > 0,
                      ),
                  },
        [map, scope],
    );
    const results = useMemo(
        () => filterDeviceNodes(scopedMap, deferredQuery, filter),
        [scopedMap, deferredQuery, filter],
    );
    const linkedIds = useMemo(
        () =>
            new Set(
                map.relationships.flatMap((edge) => [
                    edge.fromDeviceId,
                    edge.toDeviceId,
                ]),
            ),
        [map.relationships],
    );
    const isolatedCount = map.nodes.filter(
        (node) => !linkedIds.has(node.id),
    ).length;
    const connectedIds = useMemo(
        () =>
            new Set(
                map.relationships
                    .filter(
                        (edge) =>
                            edge.localDevice &&
                            actions.connectionStatuses[edge.localDevice.ID]
                                ?.webRTCStatus === WebRTCStatus.Connected,
                    )
                    .map((edge) => edge.id),
            ),
        [map.relationships, actions.connectionStatuses],
    );
    useEffect(() => {
        if (view !== "map" || mapMounted) return;
        let cancelled = false;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (!cancelled) prepareMap(() => setMapMounted(true));
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [view, mapMounted, prepareMap]);
    const markMapReady = useCallback(() => setMapReady(true), []);

    useEffect(() => {
        if (!coolingDown) return;
        const timer = setInterval(
            () =>
                setCooldown(
                    Math.max(
                        0,
                        Math.ceil(
                            (refreshDeadline.current - Date.now()) / 1000,
                        ),
                    ),
                ),
            1000,
        );
        return () => clearInterval(timer);
    }, [coolingDown]);
    useEffect(() => {
        if (!status) return;
        const timer = setTimeout(() => setStatus(""), 4000);
        return () => clearTimeout(timer);
    }, [status]);

    const choose = useCallback(
        (next: DeviceSelection) => {
            if (pending || detailBusy) return;
            Keyboard.dismiss();
            if (next.kind === "node") setHasSelectedDevice(true);
            setSelection(next);
            setError("");
            setDetailOpen(true);
        },
        [pending, detailBusy],
    );
    const selectMap = useCallback(
        (next: DeviceSelection | null) => {
            if (pending || detailBusy) return;
            Keyboard.dismiss();
            if (next?.kind === "edge") {
                setSelection(next);
                setError("");
                setDetailOpen(true);
            } else {
                if (next?.kind === "node") setHasSelectedDevice(true);
                setSelection(next);
                setError("");
                if (!next) setFocusId(null);
            }
        },
        [pending, detailBusy],
    );
    const copy = useCallback(async (id: string) => {
        if (!(await copyTextToClipboard(id)))
            throw new Error("Could not copy the ID.");
    }, []);
    const refresh = () => {
        if (
            !account.bound ||
            account.loading ||
            pending ||
            detailBusy ||
            Date.now() < refreshDeadline.current
        )
            return;
        refreshDeadline.current = Date.now() + 10_000;
        setCooldown(10);
        void account.refresh();
    };
    const quickConnect = async (local: LinkedDevice) => {
        if (pending || detailBusy || quickInFlight.current) return;
        quickInFlight.current = true;
        setQuickActionId(local.ID);
        setError("");
        const connected =
            actions.connectionStatuses[local.ID]?.webRTCStatus ===
            WebRTCStatus.Connected;
        try {
            await actions.connectDevice(local.ID);
            if (!connected)
                setStatus(`Connection started for ${local.Name || "device"}.`);
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "Could not connect to this device.",
            );
        } finally {
            quickInFlight.current = false;
            setQuickActionId(null);
        }
    };
    const explore = useCallback(
        (nodeId: string) => {
            if (pending || detailBusy) return;
            setHasSelectedDevice(true);
            setSelection({ kind: "node", id: nodeId });
            setView("map");
            setScope("all");
            setFilter("all");
            setQuery("");
            setFocusId(nodeId);
            setDetailOpen(false);
        },
        [pending, detailBusy],
    );
    const showRootConfirmation = useCallback((target: DeviceNode) => {
        if (!target.serverId) return;
        setError("");
        setConfirm({
            title: `${target.root ? "Remove" : "Allow"} root access for ${target.displayName}?`,
            description: target.root
                ? "This device will keep its registration and sync links but lose root permissions."
                : ROOT_DESCRIPTION,
            label: target.root ? "Remove root access" : "Allow root access",
            action: () => toggleRootRef.current(target.serverId!, !target.root),
        });
    }, []);
    const details = (
        <DeviceDetails
            open={detailOpen && !confirm}
            sessionGeneration={getVaultSessionGeneration()}
            map={map}
            selection={selection ?? effectiveSelection}
            connectionStatuses={actions.connectionStatuses}
            signalingConfig={vault.LinkedDevices}
            isRoot={account.isRoot}
            hasSession={account.hasSession}
            canPromote={account.canPromote}
            pending={pending}
            onChoose={choose}
            onExplore={explore}
            onCopy={copy}
            onSave={actions.saveDeviceConfig}
            onConnect={actions.connectDevice}
            onUnlinkLocal={async (local, localOnly) => {
                await actions.unlinkDevice(local, localOnly);
                await account.refresh();
            }}
            onUnlinkRelationship={account.unlinkRelationship}
            onRemoveAccountDevice={account.removeAccountDevice}
            onToggleRoot={showRootConfirmation}
            onSuccess={setStatus}
            onBusyChange={setDetailBusy}
            onDismissibleChange={setDetailDismissible}
            onSheetVariantChange={setDetailSheetVariant}
            onClose={() => setDetailOpen(false)}
        />
    );
    const visibleError =
        !detailOpen && !confirm
            ? error ||
              (account.error !== dismissedAccountError ? account.error : "")
            : "";
    const accountNotice = !account.hasSession
        ? account.bound
            ? "Account access is not verified. Refresh to reconnect to Online Services."
            : "Showing links saved in this vault. Connect to Online Services to view account devices."
        : account.loading
          ? "Checking account devices and connections."
          : !account.isRoot
            ? "This device does not have root access. Saved links are available. Use a root device to manage account devices."
            : !map.topologyVerified && !account.error
              ? "Account relationships are not verified. Refresh before changing access or removing links."
              : "";

    return (
        <UnlockedScreen padded={false}>
            <View
                style={{
                    paddingHorizontal: 18,
                    paddingTop: 18,
                    paddingBottom: 12,
                    flexDirection: "row",
                    gap: 10,
                    alignItems: "center",
                }}
            >
                <View style={{ flex: 1, minWidth: 0, position: "relative" }}>
                    <Input
                        testID="device-search"
                        accessibilityLabel="Search devices by ID or saved name"
                        placeholder="Search devices"
                        value={query}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={setQuery}
                        style={searchInputStyle}
                    />
                    <Search
                        size={21}
                        strokeWidth={1.6}
                        color={colors.muted}
                        pointerEvents="none"
                        style={{ position: "absolute", left: 12, top: 13.5 }}
                    />
                    {query ? (
                        <Pressable
                            testID="device-search-clear"
                            accessibilityRole="button"
                            accessibilityLabel="Clear device search"
                            onPress={() => setQuery("")}
                            style={{
                                position: "absolute",
                                right: 0,
                                top: 2,
                                width: 44,
                                height: 44,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <X size={17} color={colors.muted} />
                        </Pressable>
                    ) : null}
                </View>
                <Pressable
                    testID="device-link"
                    accessibilityRole="button"
                    accessibilityLabel="Link a device"
                    accessibilityState={{ disabled: pending }}
                    disabled={pending}
                    onPress={() => {
                        Keyboard.dismiss();
                        setLinkOpen(true);
                    }}
                    style={{
                        width: 44,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pending ? 0.4 : 1,
                    }}
                >
                    <Plus size={24} color={colors.primary} strokeWidth={1.6} />
                </Pressable>
            </View>
            <View
                style={{
                    marginHorizontal: 18,
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 12,
                }}
            >
                {(["map", "list"] as const).map((item) => (
                    <Pressable
                        key={item}
                        testID={`device-view-${item}`}
                        accessibilityRole="tab"
                        accessibilityLabel={
                            item === "map" ? "Connection map" : "Device list"
                        }
                        accessibilityState={{ selected: view === item }}
                        onPress={() => {
                            if (item === "list") setListMounted(true);
                            setView(item);
                            Keyboard.dismiss();
                        }}
                        style={{
                            minHeight: 44,
                            paddingHorizontal: 12,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 12,
                                color:
                                    view === item
                                        ? colors.foreground
                                        : colors.muted,
                            }}
                        >
                            {item === "map" ? "Connections" : "List"}
                        </Text>
                        {view === item ? (
                            <View
                                style={{
                                    position: "absolute",
                                    height: 2,
                                    backgroundColor: colors.primary,
                                    bottom: 0,
                                    left: 10,
                                    right: 10,
                                }}
                            />
                        ) : null}
                    </Pressable>
                ))}
                <View style={{ flex: 1 }} />
                <Pressable
                    testID="device-filter"
                    accessibilityRole="button"
                    accessibilityLabel="Filter devices"
                    onPress={() => {
                        Keyboard.dismiss();
                        setFilterOpen(true);
                    }}
                    style={{
                        minHeight: 44,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 3,
                        maxWidth: 126,
                        paddingHorizontal: 7,
                    }}
                >
                    <Text
                        numberOfLines={1}
                        style={{
                            flexShrink: 1,
                            fontSize: 11,
                            color: colors.muted,
                        }}
                    >
                        {FILTERS.find((item) => item.value === filter)?.label}
                    </Text>
                    <ChevronDown size={12} color={colors.muted} />
                </Pressable>
                <Pressable
                    testID="device-refresh"
                    accessibilityRole="button"
                    accessibilityLabel={
                        coolingDown
                            ? `Refresh available in ${cooldown} seconds`
                            : "Refresh devices"
                    }
                    accessibilityState={{
                        disabled:
                            !account.bound ||
                            pending ||
                            account.loading ||
                            coolingDown,
                    }}
                    disabled={
                        !account.bound ||
                        pending ||
                        account.loading ||
                        coolingDown
                    }
                    onPress={refresh}
                    hitSlop={{ left: 3, right: 3 }}
                    style={{
                        width: 38,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity:
                            !account.bound ||
                            pending ||
                            account.loading ||
                            coolingDown
                                ? 0.4
                                : 1,
                    }}
                >
                    <RotateCw size={18} color={colors.muted} />
                </Pressable>
            </View>
            {accountNotice ? (
                <Text
                    style={{
                        marginHorizontal: 18,
                        marginBottom: 6,
                        fontSize: 11,
                        lineHeight: 17,
                        color: colors.muted,
                    }}
                >
                    {accountNotice}
                </Text>
            ) : null}
            <View
                style={{
                    minHeight: 38,
                    marginHorizontal: 18,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <Text style={{ fontSize: 10, color: colors.muted }}>
                    {results.length} devices
                </Text>
                <Text
                    style={{
                        fontSize: 10,
                        color: colors.muted,
                        borderLeftWidth: 1,
                        borderLeftColor: colors.border,
                        paddingLeft: 8,
                    }}
                >
                    {account.isRoot ? "Root" : "Non-root"}
                </Text>
                <View style={{ flex: 1 }} />
                <Pressable
                    testID="device-scope"
                    accessibilityRole="button"
                    accessibilityLabel={
                        scope === "all"
                            ? "Show devices linked to this device"
                            : "Show all devices"
                    }
                    onPress={() => {
                        setScope(scope === "all" ? "local" : "all");
                        setFilter("all");
                        setQuery("");
                        setFocusId(null);
                        setSelection(null);
                    }}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={{
                        minHeight: 36,
                        paddingHorizontal: 6,
                        justifyContent: "center",
                    }}
                >
                    <Text style={{ fontSize: 10, color: colors.muted }}>
                        {scope === "all" ? "This device" : "All devices"}
                    </Text>
                </Pressable>
                <Pressable
                    testID="device-isolated"
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${isolatedCount} devices with no recorded links`}
                    onPress={() => {
                        setScope("all");
                        setFilter("isolated");
                        setQuery("");
                        setFocusId(null);
                        setSelection(null);
                    }}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={{
                        minHeight: 36,
                        paddingHorizontal: 6,
                        justifyContent: "center",
                    }}
                >
                    <Text style={{ fontSize: 10, color: colors.muted }}>
                        No links ({isolatedCount})
                    </Text>
                </Pressable>
            </View>
            <View
                style={{
                    flex: 1,
                    minHeight: 0,
                    flexDirection: isTablet && detailOpen ? "row" : "column",
                }}
            >
                <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <Animated.View
                        testID="device-map-layer"
                        pointerEvents={
                            view === "map" && mapReady ? "auto" : "none"
                        }
                        accessibilityElementsHidden={
                            view !== "map" || !mapReady
                        }
                        importantForAccessibility={
                            view === "map" && mapReady
                                ? "auto"
                                : "no-hide-descendants"
                        }
                        style={[
                            {
                                position: "absolute",
                                top: 0,
                                right: 0,
                                bottom: 0,
                                left: 0,
                            },
                            tabStyles.map,
                            !mapReady ? { opacity: 0 } : undefined,
                        ]}
                    >
                        {mapMounted ? (
                            <DeviceNetwork
                                map={map}
                                nodes={results}
                                selection={validSelection}
                                connectedIds={connectedIds}
                                statuses={actions.connectionStatuses}
                                focusId={focusId}
                                active={
                                    view === "map" &&
                                    mapReady &&
                                    !detailOpen &&
                                    !linkOpen &&
                                    !filterOpen &&
                                    !confirm &&
                                    !visibleError
                                }
                                showHint={!hasSelectedDevice}
                                onReady={markMapReady}
                                onSelect={selectMap}
                            />
                        ) : (
                            <View style={{ flex: 1 }} />
                        )}
                        <DeviceSelectionSummary
                            map={map}
                            selection={effectiveSelection}
                            statuses={actions.connectionStatuses}
                            pending={pending}
                            onDetails={() => choose(effectiveSelection)}
                            onConnect={(local) => {
                                void quickConnect(local);
                            }}
                        />
                    </Animated.View>
                    {view === "map" && !mapReady ? (
                        <View
                            testID="device-map-loading"
                            accessibilityRole="progressbar"
                            accessibilityLabel="Loading connections"
                            style={{
                                flex: 1,
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 12,
                            }}
                        >
                            <ActivityIndicator color={colors.primary} />
                            <Text style={{ color: colors.muted, fontSize: 13 }}>
                                Loading connections…
                            </Text>
                        </View>
                    ) : null}
                    {listMounted ? (
                        <Animated.View
                            testID="device-list-layer"
                            pointerEvents={view === "list" ? "auto" : "none"}
                            accessibilityElementsHidden={view !== "list"}
                            importantForAccessibility={
                                view === "list" ? "auto" : "no-hide-descendants"
                            }
                            style={[
                                {
                                    position: "absolute",
                                    top: 0,
                                    right: 0,
                                    bottom: 0,
                                    left: 0,
                                },
                                tabStyles.list,
                            ]}
                        >
                            <DeviceList
                                nodes={results}
                                map={map}
                                statuses={actions.connectionStatuses}
                                pending={pending}
                                onSelect={choose}
                                onConnect={(local) => {
                                    void quickConnect(local);
                                }}
                                resetKey={`${deferredQuery}:${filter}:${scope}`}
                            />
                        </Animated.View>
                    ) : null}
                </View>
                {isTablet && detailOpen ? (
                    <View
                        style={{
                            flex: 1,
                            minWidth: 0,
                            borderLeftWidth: 1,
                            borderLeftColor: colors.border,
                            padding: 20,
                        }}
                    >
                        {details}
                    </View>
                ) : null}
            </View>
            {status && !detailOpen && !confirm ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: 18,
                        right: 18,
                        bottom: view === "map" ? 110 : 18,
                        padding: 13,
                        borderRadius: 7,
                        backgroundColor: colors.foreground,
                    }}
                >
                    <Text
                        accessibilityRole="alert"
                        style={{ color: colors.navigation, fontSize: 12 }}
                    >
                        {status}
                    </Text>
                </View>
            ) : null}
            <DeviceDetailsDialog
                open={!isTablet && detailOpen && !confirm}
                active={!isTablet && screenFocused}
                preload={!isTablet && screenFocused && mapReady}
                bottomSheetVariant={detailSheetVariant}
                dismissible={!pending && !detailBusy && detailDismissible}
                onOpenChange={(open) => {
                    if (!pending && !detailBusy && detailDismissible)
                        setDetailOpen(open);
                }}
            >
                {details}
            </DeviceDetailsDialog>
            <Dialog
                open={!!confirm}
                placement="bottom"
                bottomSheetVariant="devices"
                dismissible={!confirmBusy}
                onOpenChange={(open) => {
                    if (!open && !confirmBusy) {
                        setError("");
                        setConfirm(null);
                    }
                }}
            >
                <DialogHeader>
                    <UnlockedDialogTitle style={{ fontSize: 24 }}>
                        {error ? "Root access" : confirm?.title}
                    </UnlockedDialogTitle>
                    <DialogDescription>
                        {error || confirm?.description}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="secondary"
                        disabled={confirmBusy}
                        onPress={() => {
                            setError("");
                            setConfirm(null);
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        loading={confirmBusy}
                        testID="device-confirm-action"
                        onPress={() => {
                            if (!confirm || confirmBusy) return;
                            setConfirmBusy(true);
                            setError("");
                            void confirm
                                .action()
                                .then(() => {
                                    setStatus("Account device updated.");
                                    setConfirm(null);
                                })
                                .catch((cause: unknown) =>
                                    setError(
                                        cause instanceof Error
                                            ? cause.message
                                            : "Could not update the account device.",
                                    ),
                                )
                                .finally(() => setConfirmBusy(false));
                        }}
                    >
                        {error ? "Retry" : (confirm?.label ?? "Confirm")}
                    </Button>
                </DialogFooter>
            </Dialog>
            <Dialog
                open={!!visibleError}
                placement="bottom"
                bottomSheetVariant="devices"
                onOpenChange={(open) => {
                    if (!open) {
                        setError("");
                        setDismissedAccountError(account.error);
                    }
                }}
            >
                <DialogHeader>
                    <UnlockedDialogTitle style={{ fontSize: 24 }}>
                        Devices could not be updated
                    </UnlockedDialogTitle>
                    <DialogDescription>{visibleError}</DialogDescription>
                </DialogHeader>
                <Button
                    variant="secondary"
                    onPress={() => {
                        setError("");
                        setDismissedAccountError(account.error);
                    }}
                >
                    Close
                </Button>
            </Dialog>
            <Dialog
                open={filterOpen}
                onOpenChange={setFilterOpen}
                placement="bottom"
                bottomSheetVariant="devices"
            >
                <DialogHeader>
                    <UnlockedDialogTitle style={{ fontSize: 24 }}>
                        Filter devices
                    </UnlockedDialogTitle>
                    <DialogDescription>
                        Filters apply to the map and list.
                    </DialogDescription>
                </DialogHeader>
                {FILTERS.map((item) => (
                    <Pressable
                        key={item.value}
                        testID={`device-filter-${item.value}`}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: filter === item.value }}
                        onPress={() => {
                            setFilter(item.value);
                            setFocusId(null);
                            setSelection(null);
                            setFilterOpen(false);
                        }}
                        style={{
                            minHeight: 48,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <Text style={{ fontSize: 13 }}>{item.label}</Text>
                        {filter === item.value ? (
                            <Check size={17} color={colors.primary} />
                        ) : null}
                    </Pressable>
                ))}
            </Dialog>
            <Dialog
                open={linkOpen}
                onOpenChange={setLinkOpen}
                placement="bottom"
                bottomSheetVariant="devices"
            >
                <DialogHeader>
                    <UnlockedDialogTitle style={{ fontSize: 24 }}>
                        Link a device
                    </UnlockedDialogTitle>
                </DialogHeader>
                <UnlockedMenuRow
                    icon={Send}
                    title="Create invitation"
                    subtitle="Show a QR code or save an invitation file."
                    onPress={() => {
                        setLinkOpen(false);
                        router.push("/(app)/devices/link-send");
                    }}
                />
                <UnlockedMenuRow
                    icon={QrCode}
                    title="Use invitation"
                    subtitle="Scan a QR code or open an invitation file."
                    onPress={() => {
                        setLinkOpen(false);
                        router.push("/link-receive");
                    }}
                />
            </Dialog>
        </UnlockedScreen>
    );
}
