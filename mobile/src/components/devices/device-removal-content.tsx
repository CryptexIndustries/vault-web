import { Pressable, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { LinkedDevices } from "@cryptex-industries/vault-core/vault-utils/vault";
import type {
    DeviceNode,
    DeviceRelationship,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import type { DeviceConnectionStatus } from "@/components/sync-controller-provider";
import type { CompletedDeviceAction } from "./device-action-error";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { DeviceConnectionRow, Note } from "./device-detail-presentation";
import { colors } from "@/theme";

export function DeviceUnlinkContent({
    target,
    relationship,
    candidates,
    map,
    chooseConnection,
    scope,
    pending: busy,
    isRoot,
    hasSession,
    allowed,
    onScopeChange,
    onChooseConnection,
}: {
    target?: DeviceNode;
    relationship?: DeviceRelationship;
    candidates: DeviceRelationship[];
    map: DeviceRelationshipMap;
    chooseConnection: boolean;
    scope: "connection" | "device";
    pending: boolean;
    isRoot: boolean;
    hasSession: boolean;
    allowed: boolean;
    onScopeChange: (scope: "connection" | "device") => void;
    onChooseConnection: () => void;
}) {
    const whole = scope === "device";
    const local = relationship?.localDevice;
    const reason = whole
        ? !isRoot
            ? "Use a root device to remove an account device."
            : !map.topologyVerified
              ? "Refresh account data before removing this device."
              : target?.current
                ? "This is the current device."
                : target?.root
                  ? "Revoke this device's root access before removing it."
                  : ""
        : local && relationship?.missingOnServer
          ? "This relationship is no longer registered. Use recovery options to forget its saved link."
          : local && !hasSession
            ? "Sign in to Online Services before unlinking this connection."
            : local && !relationship?.syncId
              ? "This saved connection has no relationship ID."
              : !local && !isRoot
                ? "Use a root device to manage account connections."
                : "Verify this relationship with Online Services before unlinking.";
    const description = whole
        ? `Remove ${target?.displayName ?? "this device"} from Online Services, all its server relationships, and matching links in this vault.${local && relationship?.custom ? " This does not delete anything from the custom server." : ""}`
        : !relationship
          ? "Choose which connection to unlink."
          : !local
            ? "Remove only this relationship from Online Services. Keep both devices registered and preserve their other connections."
            : LinkedDevices.isUsingOnlineServices(local)
              ? "Remove this sync relationship from Online Services and its saved settings in this vault. Keep the device’s account registration."
              : "Remove this custom connection and its saved settings from this vault.";
    return (
        <>
            <Text
                style={{
                    fontSize: 16,
                    lineHeight: 25.6,
                    marginBottom: target?.serverId ? 16 : 8,
                    color: colors.foreground,
                }}
            >
                {target?.displayName ?? "Device"}
            </Text>
            {target?.serverId ? (
                <View
                    accessibilityLabel="Removal scope"
                    style={{
                        flexDirection: "row",
                        gap: 4,
                        padding: 4,
                        backgroundColor: colors.secondary,
                        borderRadius: 9,
                        marginBottom: 16,
                    }}
                >
                    {(["connection", "device"] as const).map((option) => (
                        <Pressable
                            key={option}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: scope === option,
                            }}
                            testID={`device-unlink-scope-${option}`}
                            accessibilityLabel={
                                option === "connection"
                                    ? "This connection"
                                    : "Entire device"
                            }
                            disabled={
                                busy ||
                                (option === "connection" && !candidates.length)
                            }
                            onPress={() => onScopeChange(option)}
                            style={{
                                flex: 1,
                                minHeight: 44,
                                borderRadius: 6,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                                ...(scope === option
                                    ? {
                                          boxShadow:
                                              "0px 1px 4px rgba(0,0,0,0.2)",
                                      }
                                    : {}),
                                opacity:
                                    option === "connection" &&
                                    !candidates.length
                                        ? 0.4
                                        : 1,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 12,
                                    color:
                                        scope === option
                                            ? colors.foreground
                                            : colors.muted,
                                }}
                            >
                                {option === "connection"
                                    ? "This connection"
                                    : "Entire device"}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {!whole && chooseConnection && candidates.length > 1 ? (
                <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                        Connection
                    </Text>
                    <Pressable
                        testID="device-choose-removal-connection"
                        accessibilityRole="button"
                        accessibilityLabel="Choose a connection"
                        disabled={busy}
                        onPress={onChooseConnection}
                        style={{
                            marginTop: 8,
                            minHeight: 46,
                            padding: 14,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 4,
                            backgroundColor: colors.secondary,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <Text
                            numberOfLines={1}
                            style={{ flex: 1, fontSize: 12 }}
                        >
                            {relationship
                                ? `${map.nodes.find((node) => node.id === (relationship.fromDeviceId === target?.id ? relationship.toDeviceId : relationship.fromDeviceId))?.displayName ?? "Device"} / ${relationship.custom ? "Custom signaling" : "Online Services"} / ${relationship.syncId}`
                                : "Choose a connection"}
                        </Text>
                        <ChevronDown size={15} color={colors.muted} />
                    </Pressable>
                </View>
            ) : null}
            <Text
                style={{
                    fontSize: 12,
                    lineHeight: 19.2,
                    color: colors.muted,
                    marginBottom: 8,
                }}
            >
                {description}
            </Text>
            {!allowed && (whole || relationship) ? (
                <Text
                    style={{
                        fontSize: 12,
                        lineHeight: 18,
                        color: colors.muted,
                        marginBottom: 8,
                    }}
                >
                    {reason}
                </Text>
            ) : null}
            <Text
                style={{
                    fontSize: 12,
                    lineHeight: 18,
                    color: colors.muted,
                }}
            >
                Vault contents remain on both devices.
            </Text>
        </>
    );
}

export function DeviceConnectionChoices({
    target,
    candidates,
    map,
    connectionStatuses,
    pending,
    selectedId,
    onSelect,
}: {
    target: DeviceNode;
    candidates: DeviceRelationship[];
    map: DeviceRelationshipMap;
    connectionStatuses: Record<string, DeviceConnectionStatus>;
    pending: boolean;
    selectedId?: string;
    onSelect: (relationship: DeviceRelationship) => void;
}) {
    return (
        <>
            {candidates.map((relationship) => (
                <DeviceConnectionRow
                    key={relationship.id}
                    relationship={relationship}
                    owner={target}
                    map={map}
                    status={
                        relationship.localDevice
                            ? connectionStatuses[relationship.localDevice.ID]
                            : undefined
                    }
                    pending={pending}
                    selected={selectedId === relationship.id}
                    onOpen={onSelect}
                />
            ))}
        </>
    );
}

export function DeviceUnlinkRecovery({
    completed,
    scope,
    failed,
    canForget,
    errorMessage,
    localCleanupRequired,
}: {
    completed?: CompletedDeviceAction;
    scope: "connection" | "device";
    failed: boolean;
    canForget: boolean;
    errorMessage?: string;
    localCleanupRequired?: boolean;
}) {
    const message =
        completed && errorMessage
            ? errorMessage
            : completed && !localCleanupRequired
              ? "Online Services completed the removal. Account data could not be refreshed. Refresh devices to verify the change."
              : completed === "device-removed"
                ? "Online Services removed this device and its server connections. Some saved links remain in this vault. Review the saved connections to finish local cleanup."
                : completed === "connection-unlinked"
                  ? "Online Services removed this relationship. Its saved link remains in this vault. Forget it locally to finish."
                  : !failed
                    ? "The latest account data confirms this relationship is no longer registered. You can forget its saved link in this vault."
                    : scope === "device"
                      ? "The device removal could not be completed. Refresh account data before trying again."
                      : !canForget
                        ? "The account relationship could not be unlinked. Both devices remain registered. Try again after checking account access."
                        : "The unlink could not be completed. Retry, or forget its saved link locally. The account relationship may remain.";
    return (
        <>
            <Text style={{ fontSize: 13, lineHeight: 21 }}>{message}</Text>
            {errorMessage && !completed ? (
                <View style={{ marginTop: 16 }}>
                    <Note>{errorMessage}</Note>
                </View>
            ) : null}
        </>
    );
}
