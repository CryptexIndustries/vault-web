import { memo, useEffect, useRef, type ReactElement } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    useWindowDimensions,
    View,
} from "react-native";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChevronRight, Clock3, Plus, RotateCw } from "lucide-react-native";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    type DeviceNode,
    type DeviceRelationshipMap,
} from "@/components/account/device-topology";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";
import { DeviceGlyph } from "./device-glyph";
import { formatDeviceActivity, formatDeviceDateTime } from "./device-dates";

export type DeviceSelection = { kind: "node" | "edge"; id: string };
export type DeviceFilter = "all" | "local" | "remote" | "isolated";
export type DeviceConnectionStatuses = Record<
    string,
    {
        webRTCStatus: WebRTCStatus;
        signalingServerStatus: SignalingStatus;
        lastSync?: Date | null;
    }
>;

export function filterDeviceNodes(
    map: DeviceRelationshipMap,
    query: string,
    filter: DeviceFilter,
) {
    const text = query.trim().toLowerCase();
    const linked = new Set(
        map.relationships.flatMap((edge) => [
            edge.fromDeviceId,
            edge.toDeviceId,
        ]),
    );
    return map.nodes
        .filter((node) => {
            const matches =
                !text ||
                node.displayName.toLowerCase().includes(text) ||
                node.serverId?.toLowerCase().includes(text) ||
                node.localDevices.some(
                    (device) =>
                        device.ID.toLowerCase().includes(text) ||
                        device.Name.toLowerCase().includes(text),
                );
            return (
                matches &&
                (filter === "all" ||
                    (filter === "local" &&
                        !node.current &&
                        node.localDevices.length > 0) ||
                    (filter === "remote" &&
                        !node.current &&
                        !node.localDevices.length) ||
                    (filter === "isolated" && !linked.has(node.id)))
            );
        })
        .sort(
            (a, b) =>
                Number(b.current) - Number(a.current) ||
                Number(b.localDevices.length > 0) -
                    Number(a.localDevices.length > 0) ||
                a.displayName.localeCompare(b.displayName),
        );
}

export function deviceLiveStatus(
    device: LinkedDevice | undefined,
    statuses: DeviceConnectionStatuses,
) {
    if (!device)
        return t({
            message: "Status unknown",
            comment: "Live connection status of a linked device",
        });
    const status = statuses[device.ID];
    if (status?.webRTCStatus === WebRTCStatus.Connected)
        return t({
            message: "Connected",
            comment: "Live connection status of a linked device",
        });
    if (
        status?.webRTCStatus === WebRTCStatus.Failed ||
        status?.signalingServerStatus === SignalingStatus.Failed
    )
        return status.signalingServerStatus === SignalingStatus.Failed
            ? t({
                  message: "Signaling failed",
                  comment: "Live connection status of a linked device",
              })
            : t({
                  message: "Connection failed",
                  comment: "Live connection status of a linked device",
              });
    if (status?.webRTCStatus === WebRTCStatus.Connecting)
        return t({
            message: "Connecting…",
            comment: "Live connection status of a linked device",
        });
    if (status?.signalingServerStatus === SignalingStatus.Connecting)
        return t({
            message: "Connecting to signaling…",
            comment: "Live connection status of a linked device",
        });
    if (status?.signalingServerStatus === SignalingStatus.Unavailable)
        return t({
            message: "Signaling unavailable",
            comment: "Live connection status of a linked device",
        });
    if (status?.signalingServerStatus === SignalingStatus.Connected)
        return t({
            message: "Ready to connect",
            comment: "Live connection status of a linked device",
        });
    return t({
        message: "Disconnected",
        comment: "Live connection status of a linked device",
    });
}

function deviceLastSync(
    device: LinkedDevice,
    statuses: DeviceConnectionStatuses,
) {
    const value = statuses[device.ID]?.lastSync ?? device.LastSync;
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return formatDeviceDateTime(date, true);
}

export function primaryLocalDevice(
    node: DeviceNode,
    statuses: DeviceConnectionStatuses,
) {
    return (
        node.localDevices.find(
            (device) =>
                statuses[device.ID]?.webRTCStatus === WebRTCStatus.Connected,
        ) ?? node.localDevices[0]
    );
}

function connectionPending(
    device: LinkedDevice | undefined,
    statuses: DeviceConnectionStatuses,
) {
    const status = device ? statuses[device.ID] : undefined;
    return (
        status?.webRTCStatus === WebRTCStatus.Connecting ||
        status?.signalingServerStatus === SignalingStatus.Connecting
    );
}

const DeviceRow = memo(function DeviceRow({
    node,
    map,
    statuses,
    pending = false,
    onPress,
    onConnect,
}: {
    node: DeviceNode;
    map: DeviceRelationshipMap;
    statuses: DeviceConnectionStatuses;
    pending?: boolean;
    onPress: () => void;
    onConnect: (device: LinkedDevice) => void;
}) {
    const { t } = useLingui();
    const local = primaryLocalDevice(node, statuses);
    const connected =
        !!local && statuses[local.ID]?.webRTCStatus === WebRTCStatus.Connected;
    const busy = connectionPending(local, statuses);
    const hasAction = !node.current && !!local;
    const relationCount = map.relationships.filter(
        (edge) => edge.fromDeviceId === node.id || edge.toDeviceId === node.id,
    ).length;
    const label = node.current
        ? t`This device`
        : local
          ? deviceLiveStatus(local, statuses)
          : relationCount
            ? t`No local link`
            : t`No recorded links`;
    const syncTime = local ? deviceLastSync(local, statuses) : null;
    const name = node.displayName;
    const lastSeen = formatDeviceDateTime(node.lastSeen);
    const seen = node.lastSeen ? formatDeviceActivity(node.lastSeen) : null;
    const lastSuccessfulSync = local
        ? formatDeviceDateTime(statuses[local.ID]?.lastSync ?? local.LastSync)
        : "";
    return (
        <View
            style={{
                height: 84,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
            }}
        >
            <Pressable
                testID={`device-row-${node.serverId ?? node.id}`}
                accessibilityRole="button"
                accessibilityLabel={
                    node.root
                        ? t`${name}, root device, ${label}`
                        : `${name}, ${label}`
                }
                disabled={pending}
                onPress={onPress}
                style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 83,
                    flexDirection: "row",
                    gap: 10,
                    alignItems: "center",
                    paddingTop: 9,
                    paddingBottom: 30,
                }}
            >
                <DeviceGlyph node={node} connected={connected} variant="list" />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text
                        numberOfLines={1}
                        style={{ fontSize: 13, lineHeight: 16 }}
                    >
                        {node.displayName}
                    </Text>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <Text
                            numberOfLines={1}
                            style={{
                                flexShrink: 1,
                                fontSize: 11,
                                lineHeight: 14,
                                color: connected
                                    ? colors.success
                                    : colors.muted,
                            }}
                        >
                            {label}
                        </Text>
                        {node.root ? (
                            <Text
                                className="font-mono"
                                style={{
                                    fontSize: 8,
                                    color: colors.muted,
                                    borderWidth: 1,
                                    borderColor: colors.border,
                                    borderRadius: 4,
                                    paddingHorizontal: 4,
                                    paddingVertical: 1,
                                }}
                            >
                                {t({
                                    message: "Root",
                                    comment:
                                        "Badge on a device with root access",
                                })}
                            </Text>
                        ) : null}
                    </View>
                </View>
                {!hasAction ? (
                    <ChevronRight size={16} color={colors.muted} />
                ) : null}
            </Pressable>
            {hasAction ? (
                <>
                    <Pressable
                        testID={`device-row-action-${node.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={
                            busy
                                ? t`Connecting to ${name}`
                                : connected
                                  ? t`Sync ${name}`
                                  : t`Connect ${name}`
                        }
                        accessibilityState={{ disabled: pending || busy, busy }}
                        disabled={pending || busy}
                        onPress={() => onConnect(local)}
                        style={{
                            minWidth: 68,
                            minHeight: 44,
                            paddingHorizontal: 6,
                            alignSelf: "flex-start",
                            marginTop: 10,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 5,
                            opacity: pending ? 0.5 : 1,
                        }}
                    >
                        {busy ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.muted}
                            />
                        ) : connected ? (
                            <RotateCw size={16} color={colors.foreground} />
                        ) : (
                            <Plus size={16} color={colors.muted} />
                        )}
                        <Text
                            style={{
                                fontSize: 12,
                                color: connected
                                    ? colors.foreground
                                    : colors.muted,
                            }}
                        >
                            {busy
                                ? t({
                                      message: "Wait",
                                      comment:
                                          "Short button label while a device connects",
                                  })
                                : connected
                                  ? t({
                                        message: "Sync",
                                        comment:
                                            "Short button: sync with a device",
                                    })
                                  : t({
                                        message: "Connect",
                                        comment:
                                            "Short button: connect to a device",
                                    })}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t`Open ${name} details`}
                        disabled={pending}
                        onPress={onPress}
                        style={{
                            width: 44,
                            minHeight: 44,
                            alignSelf: "flex-start",
                            marginTop: 10,
                            alignItems: "flex-end",
                            justifyContent: "center",
                        }}
                    >
                        <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                </>
            ) : null}
            <View
                pointerEvents="none"
                style={{
                    position: "absolute",
                    left: 46,
                    right: 0,
                    bottom: 10,
                    flexDirection: "row",
                    gap: 14,
                    alignItems: "center",
                }}
            >
                {node.serverId ? (
                    <View
                        style={{
                            flexShrink: 1,
                            flexDirection: "row",
                            gap: 5,
                            alignItems: "center",
                        }}
                    >
                        <Clock3 size={12} color={colors.muted} opacity={0.7} />
                        <Text
                            accessibilityLabel={t`Last seen by Online Services: ${lastSeen}`}
                            numberOfLines={1}
                            style={{
                                flexShrink: 1,
                                fontSize: 10,
                                lineHeight: 15,
                                color: colors.muted,
                            }}
                        >
                            {seen ? t`Seen ${seen}` : t`Seen unavailable`}
                        </Text>
                    </View>
                ) : null}
                {hasAction ? (
                    <View
                        style={{
                            flexShrink: 1,
                            flexDirection: "row",
                            gap: 5,
                            alignItems: "center",
                        }}
                    >
                        <RotateCw
                            size={12}
                            color={colors.muted}
                            opacity={0.7}
                        />
                        <Text
                            accessibilityLabel={t`Last successful sync: ${lastSuccessfulSync}`}
                            numberOfLines={1}
                            style={{
                                flexShrink: 1,
                                fontSize: 10,
                                lineHeight: 15,
                                color: colors.muted,
                            }}
                        >
                            {syncTime ? t`Synced ${syncTime}` : t`Never synced`}
                        </Text>
                    </View>
                ) : null}
            </View>
        </View>
    );
});

export function DeviceList({
    nodes,
    map,
    statuses,
    pending,
    onSelect,
    onConnect,
    resetKey,
    header,
    headerHeight = 0,
    footer,
}: {
    nodes: DeviceNode[];
    map: DeviceRelationshipMap;
    statuses: DeviceConnectionStatuses;
    pending: boolean;
    onSelect: (selection: DeviceSelection) => void;
    onConnect: (device: LinkedDevice) => void;
    resetKey: string;
    /** Section label above the rows; headerHeight must match its height. */
    header?: ReactElement;
    headerHeight?: number;
    /** More sections below the devices, such as connected agents. */
    footer?: ReactElement;
}) {
    const { t } = useLingui();
    const listRef = useRef<FlatList<DeviceNode>>(null);
    useEffect(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, [resetKey]);
    return (
        <FlatList
            ref={listRef}
            testID="device-list"
            accessibilityLabel={t`Devices`}
            data={nodes}
            keyExtractor={(node) => node.id}
            extraData={{ statuses, pending }}
            renderItem={({ item }) => (
                <DeviceRow
                    node={item}
                    map={map}
                    statuses={statuses}
                    pending={pending}
                    onPress={() => onSelect({ kind: "node", id: item.id })}
                    onConnect={onConnect}
                />
            )}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 14, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, index) => ({
                length: 84,
                offset: headerHeight + 84 * index,
                index,
            })}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={7}
            ListEmptyComponent={
                <Text
                    style={{
                        fontSize: 13,
                        color: colors.muted,
                        textAlign: "center",
                        paddingVertical: 35,
                    }}
                >
                    {t`No matching devices. Try an ID or a saved name.`}
                </Text>
            }
        />
    );
}

export function DeviceSelectionSummary({
    map,
    selection,
    statuses,
    pending,
    onDetails,
    onConnect,
}: {
    map: DeviceRelationshipMap;
    selection: DeviceSelection;
    statuses: DeviceConnectionStatuses;
    pending: boolean;
    onDetails: () => void;
    onConnect: (device: LinkedDevice) => void;
}) {
    const { t } = useLingui();
    const { fontScale } = useWindowDimensions();
    const edge =
        selection.kind === "edge"
            ? map.relationships.find((item) => item.id === selection.id)
            : undefined;
    const node =
        map.nodes.find(
            (item) =>
                item.id ===
                (edge
                    ? edge.fromDeviceId === map.currentDeviceId
                        ? edge.toDeviceId
                        : edge.fromDeviceId
                    : selection.id),
        ) ?? map.nodes.find((item) => item.current);
    if (!node) return null;
    const local =
        edge?.localDevice ??
        (!edge ? primaryLocalDevice(node, statuses) : undefined);
    const connected =
        !!local && statuses[local.ID]?.webRTCStatus === WebRTCStatus.Connected;
    const busy = connectionPending(local, statuses);
    const hasAction = !!local && (!node.current || !!edge);
    const count = map.relationships.filter(
        (item) => item.fromDeviceId === node.id || item.toDeviceId === node.id,
    ).length;
    const subtitle = edge
        ? deviceLiveStatus(local, statuses)
        : node.current || !local
          ? plural(count, {
                one: "# recorded connection",
                other: "# recorded connections",
            })
          : deviceLiveStatus(local, statuses);
    const name = node.displayName;
    const lastSync = local ? deviceLastSync(local, statuses) : null;
    return (
        <View
            style={{
                backgroundColor: colors.navigation,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                borderTopLeftRadius: 17,
                borderTopRightRadius: 17,
                paddingHorizontal: 18,
                paddingTop: 12,
                paddingBottom: 16,
            }}
        >
            <View
                style={{
                    width: 30,
                    height: 3,
                    borderRadius: 4,
                    backgroundColor: "#4b5469",
                    alignSelf: "center",
                    marginBottom: 12,
                }}
            />
            <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable
                    testID="device-selection-details"
                    accessibilityRole="button"
                    accessibilityLabel={t`Open selected details`}
                    disabled={pending}
                    onPress={onDetails}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: Math.max(48, 51 * fontScale + 8),
                        flexDirection: "row",
                        gap: 11,
                        alignItems: "center",
                    }}
                >
                    <DeviceGlyph
                        node={node}
                        connected={connected}
                        relationship={!!edge}
                        variant="summary"
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 13,
                                lineHeight: 18,
                                fontWeight: "500",
                            }}
                        >
                            {edge ? t`Connection to ${name}` : name}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={{
                                fontSize: 11,
                                lineHeight: 18,
                                color: connected
                                    ? colors.success
                                    : colors.muted,
                            }}
                        >
                            {subtitle}
                        </Text>
                        {hasAction ? (
                            <Text
                                numberOfLines={1}
                                style={{
                                    fontSize: 10,
                                    lineHeight: 15,
                                    color: colors.muted,
                                }}
                            >
                                {lastSync
                                    ? t`Last sync ${lastSync}`
                                    : t`Never synced`}
                            </Text>
                        ) : null}
                    </View>
                    {!hasAction ? (
                        <ChevronRight size={16} color={colors.muted} />
                    ) : null}
                </Pressable>
                {hasAction ? (
                    <>
                        <Pressable
                            testID="device-selection-action"
                            accessibilityRole="button"
                            accessibilityLabel={
                                connected ? t`Sync ${name}` : t`Connect ${name}`
                            }
                            disabled={pending || busy}
                            onPress={() => onConnect(local)}
                            style={{
                                minWidth: 72,
                                minHeight: 44,
                                paddingHorizontal: 7,
                                flexDirection: "row",
                                justifyContent: "center",
                                alignItems: "center",
                                gap: 5,
                            }}
                        >
                            {busy ? (
                                <ActivityIndicator
                                    size="small"
                                    color={colors.muted}
                                />
                            ) : connected ? (
                                <RotateCw size={16} color={colors.foreground} />
                            ) : (
                                <Plus size={16} color={colors.muted} />
                            )}
                            <Text
                                style={{
                                    fontSize: 12,
                                    color: connected
                                        ? colors.foreground
                                        : colors.muted,
                                }}
                            >
                                {busy
                                    ? t({
                                          message: "Wait",
                                          comment:
                                              "Short button label while a device connects",
                                      })
                                    : connected
                                      ? t({
                                            message: "Sync",
                                            comment:
                                                "Short button: sync with a device",
                                        })
                                      : t({
                                            message: "Connect",
                                            comment:
                                                "Short button: connect to a device",
                                        })}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t`Open selected details`}
                            disabled={pending}
                            onPress={onDetails}
                            style={{
                                width: 44,
                                minHeight: 44,
                                alignItems: "flex-end",
                                justifyContent: "center",
                            }}
                        >
                            <ChevronRight size={16} color={colors.muted} />
                        </Pressable>
                    </>
                ) : null}
            </View>
        </View>
    );
}
