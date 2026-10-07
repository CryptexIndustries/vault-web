import { memo } from "react";
import { Pressable, View } from "react-native";
import {
    ChevronDown,
    ChevronRight,
    LocateFixed,
    Server,
    Settings2,
    Shield,
} from "lucide-react-native";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    type DeviceNode,
    type DeviceRelationship,
    type DeviceRelationshipMap,
} from "@/components/account/device-topology";
import type { DeviceConnectionStatus } from "@/components/sync-controller-provider";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { DeviceGlyph } from "./device-glyph";
import { formatDeviceActivity } from "./device-dates";
import {
    CopyIdButton,
    DeviceConnectionRow,
    DeviceSyncButton,
    Information,
    MiniAction,
    Note,
    dateTime,
    liveLabel,
} from "./device-detail-presentation";
import { colors } from "@/theme";

type OverviewProps = {
    map: DeviceRelationshipMap;
    connectionStatuses: Record<string, DeviceConnectionStatus>;
    pending: boolean;
    working: boolean;
    onChoose: (selection: { kind: "node" | "edge"; id: string }) => void;
    onCopy: (id: string) => Promise<void | boolean>;
    onCopyError: (id: string) => void;
    onConnect: (device: LinkedDevice) => void;
};

export const DeviceOverview = memo(function DeviceOverview({
    node,
    map,
    connectionStatuses,
    pending: busy,
    working,
    isRoot,
    canPromote,
    onExplore,
    onCopy,
    onCopyError,
    onChoose,
    onConnect,
    onToggleRoot,
    onUnlink,
    headerOnly = false,
}: OverviewProps & {
    node: DeviceNode;
    isRoot: boolean;
    canPromote: boolean;
    activityMinute: number;
    headerOnly?: boolean;
    onExplore: (nodeId: string) => void;
    onToggleRoot: (node: DeviceNode) => void;
    onUnlink: (node: DeviceNode, relationship: DeviceRelationship) => void;
}) {
    const statusFor = (local?: LinkedDevice) =>
        local ? connectionStatuses[local.ID] : undefined;
    const lastSyncFor = (local: LinkedDevice) =>
        statusFor(local)?.lastSync ?? local.LastSync;
    const connections = map.relationships.filter(
        (entry) =>
            entry.fromDeviceId === node.id || entry.toDeviceId === node.id,
    );
    const localLinks = connections.flatMap((entry) =>
        entry.localDevice ? [entry.localDevice] : [],
    );
    const synced = localLinks
        .map((local) => lastSyncFor(local))
        .filter((value) => value && Number.isFinite(new Date(value).getTime()));
    const latest = synced.length
        ? Math.max(...synced.map((value) => new Date(value!).getTime()))
        : undefined;
    const copyId = node.serverId ?? node.localDevices[0]?.ID;
    return (
        <>
            <View
                style={{
                    flexDirection: "row",
                    gap: 11,
                    alignItems: "center",
                    paddingTop: 4,
                    paddingBottom: 14,
                }}
            >
                <DeviceGlyph
                    node={node}
                    connected={localLinks.some(
                        (local) =>
                            statusFor(local)?.webRTCStatus ===
                            WebRTCStatus.Connected,
                    )}
                />
                <View style={{ flex: 1 }}>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 8,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 18,
                                lineHeight: 24,
                                fontWeight: "500",
                                letterSpacing: -0.3,
                                marginTop: 2,
                                flex: 1,
                                flexBasis: 120,
                                flexShrink: 1,
                            }}
                        >
                            {node.displayName}
                        </Text>
                        {node.root ? (
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 5,
                                }}
                            >
                                <Shield size={13} color={colors.muted} />
                                <Text
                                    style={{
                                        color: colors.muted,
                                        fontSize: 10,
                                    }}
                                >
                                    Root
                                </Text>
                            </View>
                        ) : null}
                        {copyId ? (
                            <CopyIdButton
                                id={copyId}
                                pending={busy}
                                onCopy={onCopy}
                                onCopyError={onCopyError}
                            />
                        ) : null}
                    </View>
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            lineHeight: 16.5,
                            marginTop: 4,
                        }}
                    >
                        {node.current
                            ? "Current device"
                            : node.localDevices.length
                              ? "Saved in this vault"
                              : "Registered with Online Services"}
                    </Text>
                </View>
            </View>
            <View
                testID="device-activity"
                style={{
                    flexDirection: "row",
                    gap: 16,
                    marginBottom: 20,
                }}
            >
                {node.serverId ? (
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, lineHeight: 17 }}>
                            Last seen
                        </Text>
                        <Text
                            style={{
                                fontSize: 10,
                                lineHeight: 13,
                                color: colors.muted,
                                marginTop: 4,
                            }}
                        >
                            Online Services
                        </Text>
                        <Text
                            testID="device-last-seen"
                            style={{
                                fontSize: 12,
                                lineHeight: 18,
                                marginTop: 8,
                            }}
                        >
                            {dateTime(node.lastSeen)}
                        </Text>
                    </View>
                ) : null}
                {!node.current ? (
                    <View
                        style={{
                            flex: 1,
                            ...(node.serverId
                                ? {
                                      borderLeftWidth: 1,
                                      borderLeftColor: colors.border,
                                      paddingLeft: 16,
                                  }
                                : {}),
                        }}
                    >
                        <Text style={{ fontSize: 12, lineHeight: 17 }}>
                            Last sync
                        </Text>
                        <Text
                            style={{
                                fontSize: 10,
                                lineHeight: 13,
                                color: colors.muted,
                                marginTop: 4,
                            }}
                        >
                            With this device
                        </Text>
                        <Text
                            testID="device-last-sync"
                            style={{
                                fontSize: 12,
                                lineHeight: 18,
                                marginTop: 8,
                            }}
                        >
                            {localLinks.length
                                ? latest
                                    ? formatDeviceActivity(latest)
                                    : "Never synced"
                                : "Unavailable in this vault"}
                        </Text>
                    </View>
                ) : null}
            </View>
            {!node.current && localLinks.length === 1 ? (
                <View style={{ marginBottom: 20 }}>
                    {
                        <DeviceSyncButton
                            device={localLinks[0]}
                            status={statusFor(localLinks[0])}
                            pending={busy}
                            working={working}
                            onConnect={onConnect}
                        />
                    }
                </View>
            ) : null}
            <View>
                <View
                    style={{
                        minHeight: 45,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <Text
                        style={{
                            fontSize: 12,
                            fontWeight: "500",
                            color: colors.muted,
                        }}
                    >
                        Connections{" "}
                        <Text
                            style={{
                                fontSize: 10,
                                fontFamily: "monospace",
                                color: colors.foreground,
                            }}
                        >
                            {" "}
                            {connections.length}
                        </Text>
                    </Text>
                    <MiniAction
                        label="Explore"
                        testID="device-explore-connections"
                        disabled={busy}
                        onPress={() => onExplore(node.id)}
                        accent
                        paddingHorizontal={0}
                        icon={<LocateFixed size={15} color={colors.primary} />}
                    />
                </View>
                {!headerOnly &&
                    connections.map((entry) => (
                        <DeviceConnectionRow
                            key={entry.id}
                            relationship={entry}
                            owner={node}
                            map={map}
                            status={statusFor(entry.localDevice)}
                            pending={busy}
                            onOpen={(relationship) =>
                                onChoose({ kind: "edge", id: relationship.id })
                            }
                            onUnlink={onUnlink}
                        />
                    ))}
                {!connections.length ? (
                    <View style={{ paddingTop: 8, paddingBottom: 15 }}>
                        <Note>No recorded connections to other devices.</Note>
                    </View>
                ) : null}
            </View>
            {!headerOnly ? (
                <DeviceAccountAccess
                    node={node}
                    map={map}
                    pending={busy}
                    isRoot={isRoot}
                    canPromote={canPromote}
                    onToggleRoot={onToggleRoot}
                />
            ) : null}
        </>
    );
});

export function DeviceAccountAccess({
    node,
    map,
    pending: busy,
    isRoot,
    canPromote,
    onToggleRoot,
}: {
    node: DeviceNode;
    map: DeviceRelationshipMap;
    pending: boolean;
    isRoot: boolean;
    canPromote: boolean;
    onToggleRoot: (node: DeviceNode) => void;
}) {
    const canManageRoot = isRoot && canPromote && map.topologyVerified;
    const lastRoot = node.root && map.rootCount <= 1;
    return (
        <>
            {node.serverId ? (
                <View style={{ marginTop: 20 }}>
                    <Text
                        style={{
                            fontSize: 12,
                            lineHeight: 17,
                            fontWeight: "500",
                            color: colors.muted,
                        }}
                    >
                        Account access
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            node.root
                                ? "Remove root access"
                                : "Allow root access"
                        }
                        testID="device-toggle-root"
                        disabled={busy || !canManageRoot || lastRoot}
                        onPress={() => onToggleRoot(node)}
                        style={{
                            minHeight: 70,
                            paddingVertical: 10,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 11,
                        }}
                    >
                        <Shield size={19} color={colors.muted} />
                        <View style={{ flex: 1, gap: 5 }}>
                            <Text style={{ fontSize: 13 }}>Root access</Text>
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: colors.muted,
                                }}
                            >
                                {node.root ? "Granted" : "Not granted"}
                            </Text>
                        </View>
                        {canManageRoot && !lastRoot ? (
                            <ChevronRight size={15} color={colors.muted} />
                        ) : null}
                    </Pressable>
                    {lastRoot || !canManageRoot ? (
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 11,
                                lineHeight: 17.6,
                                marginBottom: 16,
                            }}
                        >
                            {lastRoot
                                ? "This is the last root device. Keep at least one root on the account."
                                : !isRoot
                                  ? "Manage root access from a root device."
                                  : !map.topologyVerified
                                    ? "Refresh account data before changing access."
                                    : !canPromote
                                      ? "Root changes are restricted on this account."
                                      : ""}
                        </Text>
                    ) : null}
                </View>
            ) : null}
        </>
    );
}

export const DeviceRelationshipOverview = memo(
    function DeviceRelationshipOverview({
        edge,
        map,
        connectionStatuses,
        pending: busy,
        working,
        onChoose,
        onCopy,
        onCopyError,
        onConnect,
        onSettings,
        onServers,
        informationOpen,
        onInformationChange: setInformationOpen,
    }: OverviewProps & {
        edge: DeviceRelationship;
        informationOpen: boolean;
        onInformationChange: (open: boolean) => void;
        onSettings: (relationship: DeviceRelationship) => void;
        onServers: (relationship: DeviceRelationship) => void;
    }) {
        const statusFor = (local?: LinkedDevice) =>
            local ? connectionStatuses[local.ID] : undefined;
        const nodeById = (id: string) =>
            map.nodes.find((entry) => entry.id === id);
        const syncLabel = (local: LinkedDevice) => {
            const lastSync = statusFor(local)?.lastSync ?? local.LastSync;
            return lastSync ? dateTime(lastSync) : "Never synced";
        };
        const local = edge.localDevice;
        const status = statusFor(local);
        const online = status?.webRTCStatus === WebRTCStatus.Connected;
        const connecting =
            status?.webRTCStatus === WebRTCStatus.Connecting ||
            status?.signalingServerStatus === SignalingStatus.Connecting;
        return (
            <>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                        marginBottom: 19,
                    }}
                >
                    <View
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            borderWidth: 1,
                            borderColor: online
                                ? colors.success
                                : connecting
                                  ? colors.primary
                                  : colors.muted,
                            backgroundColor: online
                                ? colors.success
                                : connecting
                                  ? colors.primary
                                  : "transparent",
                        }}
                    />
                    <Text
                        style={{
                            fontSize: 12,
                            lineHeight: 17,
                            color: online ? colors.success : colors.muted,
                        }}
                    >
                        {liveLabel(local, status)}
                    </Text>
                    <Text
                        style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: colors.muted,
                        }}
                    >
                        {edge.custom ? "Custom signaling" : "Online Services"}
                    </Text>
                </View>
                <View style={{ marginBottom: 18, position: "relative" }}>
                    <View
                        style={{
                            position: "absolute",
                            left: 19,
                            top: 39,
                            bottom: 39,
                            borderLeftWidth: 1,
                            borderLeftColor: colors.border,
                        }}
                    />
                    {[edge.fromDeviceId, edge.toDeviceId].map((id, index) => {
                        const endpoint = nodeById(id);
                        return (
                            <Pressable
                                key={`${id}:${index}`}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${endpoint?.displayName ?? "device"} details`}
                                disabled={busy}
                                onPress={() => onChoose({ kind: "node", id })}
                                style={{
                                    minHeight: 64,
                                    paddingVertical: 4,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 12,
                                }}
                            >
                                {endpoint ? (
                                    <DeviceGlyph
                                        node={endpoint}
                                        variant="connection"
                                        connected={
                                            status?.webRTCStatus ===
                                            WebRTCStatus.Connected
                                        }
                                    />
                                ) : null}
                                <View style={{ flex: 1, gap: 5 }}>
                                    <Text
                                        style={{
                                            fontSize: 15,
                                            lineHeight: 20,
                                            fontWeight: "500",
                                        }}
                                    >
                                        {endpoint?.displayName ??
                                            "Device unavailable"}
                                    </Text>
                                    <Text
                                        style={{
                                            color: colors.muted,
                                            fontSize: 11,
                                            lineHeight: 15,
                                        }}
                                    >
                                        {endpoint?.current
                                            ? "Current session"
                                            : endpoint?.localDevices.length
                                              ? "Saved in this vault"
                                              : "Account device"}
                                    </Text>
                                </View>
                                <ChevronRight size={16} color={colors.muted} />
                            </Pressable>
                        );
                    })}
                </View>
                {local ? (
                    <>
                        <View style={{ gap: 6, marginBottom: 17 }}>
                            <Text style={{ fontSize: 11, color: colors.muted }}>
                                Last successful sync
                            </Text>
                            <Text style={{ fontSize: 13 }}>
                                {syncLabel(local)}
                            </Text>
                        </View>
                        <View style={{ marginBottom: 15 }}>
                            <DeviceSyncButton
                                device={local}
                                status={statusFor(local)}
                                pending={busy}
                                working={working}
                                onConnect={onConnect}
                            />
                        </View>
                        <View
                            style={{
                                marginTop: 6,
                                marginBottom: 12,
                                backgroundColor: colors.secondary,
                                borderRadius: 10,
                                paddingHorizontal: 12,
                            }}
                        >
                            <Pressable
                                accessibilityRole="button"
                                testID="device-sync-settings"
                                accessibilityLabel="Sync settings"
                                disabled={busy}
                                onPress={() => onSettings(edge)}
                                style={{
                                    minHeight: 49,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 11,
                                }}
                            >
                                <Settings2 size={18} color={colors.muted} />
                                <Text style={{ flex: 1, fontSize: 13 }}>
                                    Sync settings
                                </Text>
                                <ChevronRight size={15} color={colors.muted} />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                testID="device-servers"
                                accessibilityLabel="Servers"
                                disabled={busy}
                                onPress={() => onServers(edge)}
                                style={{
                                    minHeight: 49,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 11,
                                }}
                            >
                                <Server size={18} color={colors.muted} />
                                <Text style={{ flex: 1, fontSize: 13 }}>
                                    Servers
                                </Text>
                                <ChevronRight size={15} color={colors.muted} />
                            </Pressable>
                        </View>
                    </>
                ) : (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 13,
                            lineHeight: 20.8,
                            marginBottom: 20,
                        }}
                    >
                        This account relation has no saved link in this vault.
                        Open either device above to inspect it. Live status and
                        sync controls are unavailable here.
                    </Text>
                )}
                <View style={{ marginBottom: 14 }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Link information"
                        accessibilityState={{ expanded: informationOpen }}
                        testID="device-link-information"
                        onPress={() => setInformationOpen(!informationOpen)}
                        style={{
                            minHeight: 49,
                            flexDirection: "row",
                            alignItems: "center",
                        }}
                    >
                        <Text
                            style={{
                                flex: 1,
                                fontSize: 12,
                                color: colors.muted,
                            }}
                        >
                            Link information
                        </Text>
                        <ChevronDown
                            size={15}
                            color={colors.muted}
                            style={
                                informationOpen
                                    ? { transform: [{ rotate: "180deg" }] }
                                    : undefined
                            }
                        />
                    </Pressable>
                    {informationOpen ? (
                        <View style={{ paddingBottom: 8 }}>
                            <Information
                                label="Recorded in"
                                value={
                                    edge.recordedOnServer
                                        ? local
                                            ? "Online Services and this vault"
                                            : "Online Services"
                                        : "This vault"
                                }
                            />
                            {edge.recordedOnServer ? (
                                <Information
                                    label="Created"
                                    value={dateTime(edge.createdAt)}
                                />
                            ) : local ? (
                                <Information
                                    label="Linked locally"
                                    value={dateTime(local.LinkedAtTimestamp)}
                                />
                            ) : null}
                            <Information
                                label="Relationship ID"
                                value={edge.syncId || "Not available"}
                                mono
                            />
                            {edge.syncId ? (
                                <CopyIdButton
                                    id={edge.syncId}
                                    pending={busy}
                                    onCopy={onCopy}
                                    onCopyError={onCopyError}
                                    testID="device-copy-relationship-id"
                                    accent
                                />
                            ) : null}
                        </View>
                    ) : null}
                </View>
            </>
        );
    },
);
