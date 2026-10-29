import { View } from "react-native";
import { useLingui } from "@lingui/react/macro";
import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import type {
    LinkedDevices,
    LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import type { DeviceConfigurationDraft } from "./device-configuration-draft";
import { Switch } from "@/components/ui/switch";
import {
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { dateTime } from "./device-detail-presentation";
import { colors } from "@/theme";

function ServerBlock({
    label,
    custom,
    hosts,
    description,
}: {
    label: string;
    custom: boolean;
    hosts: string;
    description: string;
}) {
    const { t } = useLingui();
    return (
        <View
            style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Text
                style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}
            >
                {label}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: "500" }}>
                {custom ? t`Custom server` : "Online Services"}
            </Text>
            {custom ? (
                <Text
                    selectable
                    style={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        marginTop: 9,
                    }}
                >
                    {hosts}
                </Text>
            ) : null}
            <Text
                style={{
                    fontSize: 12,
                    lineHeight: 19.2,
                    color: colors.muted,
                    marginTop: 8,
                }}
            >
                {description}
            </Text>
        </View>
    );
}

export function DeviceServerDetails({
    local,
    signalingConfig,
}: {
    local: LinkedDevice;
    signalingConfig: Pick<
        LinkedDevices,
        "SignalingServers" | "STUNServers" | "TURNServers"
    >;
}) {
    const { t } = useLingui();
    const hosts = (ids: string[], servers: { ID: string; Host: string }[]) =>
        ids
            .map(
                (id) =>
                    servers.find((server) => server.ID === id)?.Host ??
                    t`Configuration unavailable`,
            )
            .join("\n");
    return (
        <>
            <Text
                style={{
                    fontSize: 12,
                    lineHeight: 19.2,
                    color: colors.muted,
                    marginBottom: 8,
                }}
            >
                {local.Name}
            </Text>
            <ServerBlock
                label={t({
                    message: "Signaling",
                    comment:
                        "Heading for the signaling server of a device link",
                })}
                custom={
                    local.SignalingServerID !== ONLINE_SERVICES_SELECTION_ID
                }
                hosts={hosts(
                    [local.SignalingServerID],
                    signalingConfig.SignalingServers,
                )}
                description={t`Finds the other device and coordinates the connection.`}
            />
            <ServerBlock
                // i18n-ignore: protocol name
                label="STUN"
                custom={local.STUNServerIDs.length > 0}
                hosts={hosts(local.STUNServerIDs, signalingConfig.STUNServers)}
                description={t`Helps devices discover their public network address.`}
            />
            <ServerBlock
                // i18n-ignore: protocol name
                label="TURN"
                custom={local.TURNServerIDs.length > 0}
                hosts={hosts(local.TURNServerIDs, signalingConfig.TURNServers)}
                description={t`Can relay traffic when a direct connection is unavailable.`}
            />
            <Text
                style={{
                    color: colors.muted,
                    fontSize: 11,
                    lineHeight: 17.6,
                    marginTop: 8,
                    borderLeftWidth: 2,
                    borderLeftColor: colors.primary,
                    paddingLeft: 10,
                }}
            >
                {t`These are configured servers. This view does not confirm whether the active connection uses a TURN relay.`}
            </Text>
        </>
    );
}

function SettingsInformation({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <View
            style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                flexDirection: "row",
                gap: 12,
                alignItems: "flex-start",
            }}
        >
            <Text style={{ minWidth: 100, color: colors.muted, fontSize: 12 }}>
                {label}
            </Text>
            <Text
                selectable
                style={{
                    flex: 1,
                    fontSize: mono ? 11 : 12,
                    fontFamily: mono ? "monospace" : undefined,
                }}
            >
                {value}
            </Text>
        </View>
    );
}

export function DeviceConnectionSettings({
    draft,
    local,
    timeout,
    pending: busy,
    onDraftChange: setDraft,
    onTimeoutChange: setTimeout,
}: {
    draft: DeviceConfigurationDraft;
    local?: LinkedDevice;
    timeout: string;
    pending: boolean;
    onDraftChange: (draft: DeviceConfigurationDraft) => void;
    onTimeoutChange: (timeout: string) => void;
}) {
    const { t } = useLingui();
    const inputStyle = {
        minHeight: 46,
        height: 46,
        backgroundColor: colors.secondary,
        borderRadius: 4,
        paddingHorizontal: 14,
        fontSize: 14,
    };
    const setting = (
        label: string,
        key: "AutoConnect" | "AutoSync" | "SyncTimeout",
    ) => (
        <View
            style={{
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 18,
            }}
        >
            <Text style={{ flex: 1, fontSize: 13 }}>{label}</Text>
            <Switch
                accessibilityLabel={label}
                value={draft[key]}
                disabled={busy}
                onValueChange={(value) => setDraft({ ...draft, [key]: value })}
            />
        </View>
    );
    return (
        <>
            <View style={{ marginTop: 4, marginBottom: 16 }}>
                <Label style={{ fontSize: 11, lineHeight: 15 }}>
                    {t`Display name`}
                </Label>
                <Input
                    accessibilityLabel={t`Device display name`}
                    maxLength={150}
                    value={draft.Name}
                    editable={!busy}
                    style={inputStyle}
                    onChangeText={(Name) => setDraft({ ...draft, Name })}
                />
            </View>
            {setting(t`Connect automatically`, "AutoConnect")}
            {setting(t`Sync after connecting`, "AutoSync")}
            {setting(t`Disconnect after inactivity`, "SyncTimeout")}
            <View style={{ marginVertical: 16 }}>
                <Label style={{ fontSize: 11, lineHeight: 15 }}>
                    {t`Timeout seconds`}
                </Label>
                <Input
                    accessibilityLabel={t`Sync timeout in seconds`}
                    keyboardType="number-pad"
                    value={timeout}
                    editable={!busy && draft.SyncTimeout}
                    style={[
                        inputStyle,
                        !draft.SyncTimeout ? { opacity: 0.4 } : undefined,
                    ]}
                    onChangeText={setTimeout}
                />
            </View>
            {local ? (
                <>
                    <SettingsInformation
                        label={t`Local device ID`}
                        value={local.ID}
                        mono
                    />
                    <SettingsInformation
                        label={t`Sync ID`}
                        value={local.SyncID || t`Not set`}
                        mono
                    />
                    <SettingsInformation
                        label={t({
                            message: "Linked",
                            comment: "Date the device link was created",
                        })}
                        value={dateTime(local.LinkedAtTimestamp)}
                    />
                    <SettingsInformation
                        label={t`Last sync`}
                        value={
                            local.LastSync
                                ? dateTime(local.LastSync)
                                : t`Never synced`
                        }
                    />
                </>
            ) : null}
        </>
    );
}
