import {
    memo,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Pressable, View } from "react-native";
import {
    ChevronRight,
    Copy,
    Plus,
    RotateCw,
    Unlink,
} from "lucide-react-native";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import type { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import type {
    DeviceNode,
    DeviceRelationship,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import type { DeviceConnectionStatus } from "@/components/sync-controller-provider";
import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { DeviceGlyph } from "./device-glyph";
export { formatDeviceDateTime as dateTime } from "./device-dates";
import { colors } from "@/theme";
import type { ButtonProps } from "@/components/ui/button";

export function DeviceSheetButton({ style, variant, ...props }: ButtonProps) {
    const height = variant === "ghost" ? 44 : variant === "secondary" ? 48 : 46;
    return (
        <Button
            {...props}
            size="default"
            variant={variant}
            textClassName={
                variant === "secondary"
                    ? "text-[13px] font-medium"
                    : "text-[12px] font-semibold"
            }
            style={(state) => [
                {
                    minHeight: height,
                    height,
                    paddingVertical: 0,
                    borderRadius: 6,
                },
                typeof style === "function" ? style(state) : style,
            ]}
        />
    );
}

export function liveLabel(
    local: LinkedDevice | undefined,
    status?: DeviceConnectionStatus,
) {
    if (!local) return "Status unknown";
    if (status?.webRTCStatus === WebRTCStatus.Connected) return "Connected";
    if (status?.webRTCStatus === WebRTCStatus.Failed)
        return "Connection failed";
    if (status?.signalingServerStatus === SignalingStatus.Failed)
        return "Signaling failed";
    if (
        status?.webRTCStatus === WebRTCStatus.Connecting ||
        status?.signalingServerStatus === SignalingStatus.Connecting
    )
        return "Connecting…";
    if (status?.signalingServerStatus === SignalingStatus.Unavailable)
        return "Signaling unavailable";
    if (status?.signalingServerStatus === SignalingStatus.Connected)
        return "Ready to connect";
    return "Disconnected";
}

export function Note({ children }: { children: ReactNode }) {
    return (
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
            {children}
        </Text>
    );
}

export function Information({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <View style={{ marginBottom: 16, gap: 6 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
            <Text
                selectable
                style={{
                    fontSize: mono ? 11 : 12,
                    lineHeight: 18,
                    fontFamily: mono ? "monospace" : undefined,
                }}
            >
                {value}
            </Text>
        </View>
    );
}

export function MiniAction({
    label,
    testID,
    disabled,
    onPress,
    icon,
    accent = false,
    paddingHorizontal = 4,
}: {
    label: string;
    testID?: string;
    disabled?: boolean;
    onPress: () => void;
    icon?: ReactNode;
    accent?: boolean;
    paddingHorizontal?: number;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={testID}
            disabled={disabled}
            onPress={onPress}
            style={{
                minHeight: 44,
                paddingHorizontal,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                opacity: disabled ? 0.45 : 1,
            }}
        >
            {icon}
            <Text
                style={{
                    fontSize: 11,
                    color: accent ? colors.primary : colors.muted,
                }}
            >
                {label}
            </Text>
        </Pressable>
    );
}

export function CopyIdButton({
    id,
    pending,
    onCopy,
    testID = "device-copy-id",
    onCopyError,
    accent = false,
}: {
    id: string;
    pending: boolean;
    onCopy: (id: string) => Promise<void | boolean>;
    testID?: string;
    onCopyError: (id: string) => void;
    accent?: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const request = useRef(0);
    useLayoutEffect(() => {
        request.current += 1;
        setCopied(false);
        return () => {
            request.current += 1;
        };
    }, [id]);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1800);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <MiniAction
            label={copied ? "Copied" : "Copy ID"}
            testID={testID}
            disabled={pending}
            accent={accent}
            paddingHorizontal={accent ? 0 : 4}
            onPress={() => {
                const current = ++request.current;
                void onCopy(id)
                    .then((completed) => {
                        if (completed !== false && request.current === current)
                            setCopied(true);
                    })
                    .catch(() => {
                        if (request.current === current) onCopyError(id);
                    });
            }}
            icon={
                <Copy
                    size={14}
                    color={accent ? colors.primary : colors.muted}
                />
            }
        />
    );
}

export function DeviceSyncButton({
    device,
    status,
    pending,
    working = false,
    onConnect,
}: {
    device: LinkedDevice;
    status?: DeviceConnectionStatus;
    pending: boolean;
    working?: boolean;
    onConnect: (device: LinkedDevice) => void;
}) {
    const connecting =
        status?.webRTCStatus === WebRTCStatus.Connecting ||
        status?.signalingServerStatus === SignalingStatus.Connecting;
    const connected = status?.webRTCStatus === WebRTCStatus.Connected;
    return (
        <Button
            testID="device-detail-sync"
            size="default"
            disabled={pending || connecting}
            loading={working || connecting}
            onPress={() => onConnect(device)}
            style={{
                minHeight: 48,
                height: 48,
                paddingVertical: 0,
                borderRadius: 6,
            }}
        >
            <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
                {!connecting ? (
                    connected ? (
                        <RotateCw size={17} color="#111520" />
                    ) : (
                        <Plus size={17} color="#111520" />
                    )
                ) : null}
                <Text
                    style={{
                        color: "#111520",
                        fontSize: 13,
                        fontWeight: "500",
                    }}
                >
                    {connecting
                        ? "Connecting…"
                        : connected
                          ? "Sync now"
                          : status?.webRTCStatus === WebRTCStatus.Failed
                            ? "Retry connection"
                            : "Connect"}
                </Text>
            </View>
        </Button>
    );
}

export function DeviceUnlinkButton({
    testID,
    pending,
    onPress,
}: {
    testID: string;
    pending: boolean;
    onPress: () => void;
}) {
    return (
        <DeviceSheetButton
            testID={testID}
            variant="ghost"
            disabled={pending}
            onPress={onPress}
        >
            <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
                <Unlink size={16} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12 }}>
                    Unlink
                </Text>
            </View>
        </DeviceSheetButton>
    );
}

export const DeviceConnectionRow = memo(function DeviceConnectionRow({
    relationship,
    owner,
    map,
    status,
    pending,
    selected,
    onOpen,
    onUnlink,
}: {
    relationship: DeviceRelationship;
    owner: DeviceNode;
    map: DeviceRelationshipMap;
    status?: DeviceConnectionStatus;
    pending: boolean;
    selected?: boolean;
    onOpen: (relationship: DeviceRelationship) => void;
    onUnlink?: (target: DeviceNode, relationship: DeviceRelationship) => void;
}) {
    const peer = map.nodes.find(
        (node) =>
            node.id ===
            (relationship.fromDeviceId === owner.id
                ? relationship.toDeviceId
                : relationship.fromDeviceId),
    );
    const local = relationship.localDevice;
    return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open connection to ${peer?.displayName ?? "device"}`}
                testID={`device-connection-${relationship.id}`}
                disabled={pending}
                onPress={() => onOpen(relationship)}
                style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 74,
                    paddingVertical: 12,
                    paddingRight: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                }}
            >
                {peer ? (
                    <DeviceGlyph
                        node={peer}
                        variant="connection-row"
                        connected={
                            status?.webRTCStatus === WebRTCStatus.Connected
                        }
                    />
                ) : null}
                <View style={{ flex: 1, gap: 4 }}>
                    <Text
                        style={{
                            fontSize: 14,
                            lineHeight: 19,
                            fontWeight: "500",
                        }}
                    >
                        {peer?.displayName ?? "Device unavailable"}
                    </Text>
                    <Text
                        style={{
                            fontSize: 11,
                            lineHeight: 15,
                            color:
                                status?.webRTCStatus === WebRTCStatus.Connected
                                    ? colors.success
                                    : colors.muted,
                        }}
                    >
                        {liveLabel(local, status)}
                    </Text>
                    <Text
                        style={{
                            fontSize: 11,
                            lineHeight: 15,
                            color: colors.muted,
                        }}
                    >
                        {relationship.custom
                            ? "Custom signaling"
                            : "Online Services"}
                    </Text>
                    {selected !== undefined ? (
                        <Text
                            selectable
                            style={{
                                fontSize: 10,
                                color: colors.muted,
                                fontFamily: "monospace",
                            }}
                        >
                            {relationship.syncId}
                        </Text>
                    ) : null}
                </View>
                {selected !== undefined ? (
                    <Text style={{ color: colors.primary, fontSize: 11 }}>
                        {selected ? "Selected" : "Choose"}
                    </Text>
                ) : !onUnlink ? (
                    <ChevronRight size={15} color={colors.muted} />
                ) : null}
            </Pressable>
            {onUnlink ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unlink connection to ${peer?.displayName ?? "device"}`}
                    testID={`device-unlink-connection-${relationship.id}`}
                    disabled={pending}
                    onPress={() => {
                        const target = peer?.current ? owner : peer;
                        if (target) onUnlink(target, relationship);
                    }}
                    style={{
                        minHeight: 44,
                        flexShrink: 0,
                        flexDirection: "row",
                        gap: 5,
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 8,
                    }}
                >
                    <Unlink size={12} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 12 }}>
                        Unlink
                    </Text>
                </Pressable>
            ) : null}
            {onUnlink && selected === undefined ? (
                <Pressable
                    accessible={false}
                    importantForAccessibility="no"
                    disabled={pending}
                    onPress={() => onOpen(relationship)}
                    style={{
                        width: 28,
                        minHeight: 44,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <ChevronRight size={15} color={colors.muted} />
                </Pressable>
            ) : null}
        </View>
    );
});
