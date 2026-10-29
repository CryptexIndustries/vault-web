import { Pressable, View } from "react-native";
import { useLingui } from "@lingui/react/macro";
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
    const { t } = useLingui();
    const whole = scope === "device";
    const local = relationship?.localDevice;
    const reason = whole
        ? !isRoot
            ? t`Use a root device to remove an account device.`
            : !map.topologyVerified
              ? t`Refresh account data before removing this device.`
              : target?.current
                ? t`This is the current device.`
                : target?.root
                  ? t`Revoke this device's root access before removing it.`
                  : ""
        : local && relationship?.missingOnServer
          ? t`This relationship is no longer registered. Use recovery options to forget its saved link.`
          : local && !hasSession
            ? t`Sign in to Online Services before unlinking this connection.`
            : local && !relationship?.syncId
              ? t`This saved connection has no relationship ID.`
              : !local && !isRoot
                ? t`Use a root device to manage account connections.`
                : t`Verify this relationship with Online Services before unlinking.`;
    const targetName = target?.displayName;
    const removeDevice = targetName
        ? t`Remove ${targetName} from Online Services, all its server relationships, and matching links in this vault.`
        : t`Remove this device from Online Services, all its server relationships, and matching links in this vault.`;
    const description = whole
        ? local && relationship?.custom
            ? `${removeDevice} ${t`This does not delete anything from the custom server.`}`
            : removeDevice
        : !relationship
          ? t`Choose which connection to unlink.`
          : !local
            ? t`Remove only this relationship from Online Services. Keep both devices registered and preserve their other connections.`
            : LinkedDevices.isUsingOnlineServices(local)
              ? t`Remove this sync relationship from Online Services and its saved settings in this vault. Keep the device’s account registration.`
              : t`Remove this custom connection and its saved settings from this vault.`;
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
                {target?.displayName ?? t`Device`}
            </Text>
            {target?.serverId ? (
                <View
                    accessibilityLabel={t`Removal scope`}
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
                                    ? t`This connection`
                                    : t`Entire device`
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
                                    ? t`This connection`
                                    : t`Entire device`}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {!whole && chooseConnection && candidates.length > 1 ? (
                <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                        {t({
                            message: "Connection",
                            comment:
                                "Label above the connection picker when unlinking",
                        })}
                    </Text>
                    <Pressable
                        testID="device-choose-removal-connection"
                        accessibilityRole="button"
                        accessibilityLabel={t`Choose a connection`}
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
                                ? `${map.nodes.find((node) => node.id === (relationship.fromDeviceId === target?.id ? relationship.toDeviceId : relationship.fromDeviceId))?.displayName ?? t`Device`} / ${relationship.custom ? t`Custom signaling` : "Online Services"} / ${relationship.syncId}`
                                : t`Choose a connection`}
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
                {t`Vault contents remain on both devices.`}
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
    const { t } = useLingui();
    const message =
        completed && errorMessage
            ? errorMessage
            : completed && !localCleanupRequired
              ? t`Online Services completed the removal. Account data could not be refreshed. Refresh devices to verify the change.`
              : completed === "device-removed"
                ? t`Online Services removed this device and its server connections. Some saved links remain in this vault. Review the saved connections to finish local cleanup.`
                : completed === "connection-unlinked"
                  ? t`Online Services removed this relationship. Its saved link remains in this vault. Forget it locally to finish.`
                  : !failed
                    ? t`The latest account data confirms this relationship is no longer registered. You can forget its saved link in this vault.`
                    : scope === "device"
                      ? t`The device removal could not be completed. Refresh account data before trying again.`
                      : !canForget
                        ? t`The account relationship could not be unlinked. Both devices remain registered. Try again after checking account access.`
                        : t`The unlink could not be completed. Retry, or forget its saved link locally. The account relationship may remain.`;
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
