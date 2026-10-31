import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLingui } from "@lingui/react/macro";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { Globe, RadioTower, Server } from "lucide-react-native";
import {
    LinkedDevices,
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TURNServerConfiguration,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { testSignalingServerConnection } from "@/utils/test-signaling";
import { testIceServer } from "@/utils/test-ice-server";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedMenuRow,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";

type ServerTab = "stun" | "turn" | "signaling";
export type ConnectivityRoute = "root" | ServerTab | `edit-${ServerTab}`;

type ConnectivityPanelProps = {
    stunServers: STUNServerConfiguration[];
    turnServers: TURNServerConfiguration[];
    signalingServers: SignalingServerConfiguration[];
    onSaved?: () => void;
    route: ConnectivityRoute;
    onRouteChange: (route: ConnectivityRoute, serverId?: string) => void;
    editingServerId?: string;
    nativeEditor?: boolean;
    onDeletePendingChange?: (pending: boolean) => void;
};

function normalizeHostKey(host: string): string {
    return host.trim().toLowerCase();
}

function hasDuplicateHosts(hosts: string[]): boolean {
    const seen = new Set<string>();
    for (const host of hosts) {
        const key = normalizeHostKey(host);
        if (!key) continue;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

export function ConnectivityPanel({
    stunServers,
    turnServers,
    signalingServers,
    onSaved,
    route,
    onRouteChange,
    editingServerId,
    nativeEditor = false,
    onDeletePendingChange,
}: ConnectivityPanelProps) {
    const { t } = useLingui();
    const confirm = useUnlockedConfirmation();
    const navigation = useNavigation();
    const newServerRef = useRef<
        | STUNServerConfiguration
        | TURNServerConfiguration
        | SignalingServerConfiguration
        | null
    >(null);
    if (editingServerId === "new" && newServerRef.current == null) {
        newServerRef.current =
            route === "edit-turn"
                ? new TURNServerConfiguration("", "", "", "")
                : route === "edit-signaling"
                  ? new SignalingServerConfiguration(
                        "",
                        "",
                        "",
                        "",
                        "",
                        "6001",
                        "0",
                    )
                  : new STUNServerConfiguration("", "");
    }
    const [stunSheetHidden, setStunSheetHidden] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(
        editingServerId === "new"
            ? (newServerRef.current?.ID ?? null)
            : (editingServerId ?? null),
    );
    const [draftStun, setDraftStun] = useState(() => [
        ...stunServers.map((server) =>
            Object.assign(new STUNServerConfiguration(), server),
        ),
        ...(newServerRef.current instanceof STUNServerConfiguration
            ? [newServerRef.current]
            : []),
    ]);
    const [draftTurn, setDraftTurn] = useState(() => [
        ...turnServers.map((server) =>
            Object.assign(new TURNServerConfiguration(), server),
        ),
        ...(newServerRef.current instanceof TURNServerConfiguration
            ? [newServerRef.current]
            : []),
    ]);
    const [draftSignaling, setDraftSignaling] = useState(() => [
        ...signalingServers.map((server) =>
            Object.assign(new SignalingServerConfiguration(), server),
        ),
        ...(newServerRef.current instanceof SignalingServerConfiguration
            ? [newServerRef.current]
            : []),
    ]);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [dirty, setDirty] = useState(editingServerId === "new");
    const [allowRemove, setAllowRemove] = useState(false);
    const pendingActionRef = useRef<
        Parameters<typeof navigation.dispatch>[0] | null
    >(null);
    const finishEditorRef = useRef(false);

    const editing = route.startsWith("edit-");
    useEffect(() => {
        if (dirty && editing) return;
        setDraftStun(
            stunServers.map((s) =>
                Object.assign(new STUNServerConfiguration(), s),
            ),
        );
        setDraftTurn(
            turnServers.map((s) =>
                Object.assign(new TURNServerConfiguration(), s),
            ),
        );
        setDraftSignaling(
            signalingServers.map((s) =>
                Object.assign(new SignalingServerConfiguration(), s),
            ),
        );
        setDirty(false);
        setError("");
        setStatus("");
    }, [stunServers, turnServers, signalingServers, dirty, editing]);

    const markDirty = () => {
        setAllowRemove(false);
        setDirty(true);
    };

    usePreventRemove(nativeEditor && dirty && !allowRemove, ({ data }) => {
        confirm({
            title: t`Discard server changes?`,
            description: t`Your server changes have not been saved.`,
            cancelLabel: t`Keep editing`,
            confirmLabel: t`Discard`,
            onConfirm: () => {
                pendingActionRef.current = data.action;
                setAllowRemove(true);
            },
        });
    });

    useEffect(() => {
        if (!allowRemove) return;
        if (pendingActionRef.current) {
            const action = pendingActionRef.current;
            pendingActionRef.current = null;
            navigation.dispatch(action);
        } else if (finishEditorRef.current) {
            finishEditorRef.current = false;
            onRouteChange(
                route.startsWith("edit-")
                    ? (route.slice(5) as ServerTab)
                    : route,
            );
        }
    }, [allowRemove, navigation, onRouteChange, route]);

    const finishEditor = (tab: ServerTab) => {
        if (!nativeEditor) {
            onRouteChange(tab);
            return;
        }
        finishEditorRef.current = true;
        setAllowRemove(true);
    };

    const save = async () => {
        setError("");
        setStatus("");

        const cleanStun = draftStun.map((server) =>
            Object.assign(new STUNServerConfiguration(), server, {
                Name: server.Name.trim(),
                Host: server.Host.trim().replace(/^stun:(?:\/\/)?/i, ""),
            }),
        );
        const cleanTurn = draftTurn.map((server) =>
            Object.assign(new TURNServerConfiguration(), server, {
                Name: server.Name.trim(),
                Host: server.Host.trim().replace(/^turn:(?:\/\/)?/i, ""),
                Username: server.Username.trim(),
                Password: server.Password,
            }),
        );
        const cleanSignaling = draftSignaling.map((server) =>
            Object.assign(new SignalingServerConfiguration(), server, {
                Name: server.Name.trim(),
                AppID: server.AppID.trim(),
                Key: server.Key.trim(),
                Secret: server.Secret,
                Host: server.Host.trim(),
                ServicePort: server.ServicePort.trim(),
                SecureServicePort: server.SecureServicePort.trim(),
            }),
        );

        if (
            [...cleanStun, ...cleanTurn].some((s) =>
                /^(?:stuns?|turns?|https?|wss?):/i.test(s.Host),
            )
        ) {
            setError(
                t`Enter a host and port for STUN or TURN. Secure URL schemes are not supported by this connection configuration.`,
            );
            return;
        }

        if (cleanStun.some((s) => !s.Name || !s.Host)) {
            setError(t`Each STUN server needs a name and host.`);
            return;
        }
        if (cleanTurn.some((s) => !s.Name || !s.Host)) {
            setError(t`Each TURN server needs a name and host.`);
            return;
        }
        if (
            cleanSignaling.some(
                (s) =>
                    !s.Name ||
                    !s.AppID ||
                    !s.Key ||
                    !s.Secret ||
                    !s.Host ||
                    (!s.ServicePort && !s.SecureServicePort),
            )
        ) {
            setError(
                t`Each signaling server needs name, app ID, key, secret, host, and a service port.`,
            );
            return;
        }

        if (
            hasDuplicateHosts(cleanStun.map((s) => s.Host)) ||
            hasDuplicateHosts(cleanTurn.map((s) => s.Host)) ||
            hasDuplicateHosts(cleanSignaling.map((s) => s.Host))
        ) {
            setError(
                t`Duplicate host entries are not allowed within a section.`,
            );
            return;
        }

        setSaving(true);
        try {
            const result = await persistVaultMutation(
                "vault.configuration",
                (current) => {
                    const updated = Object.assign(new Vault(), current);
                    updated.LinkedDevices = LinkedDevices.fromGeneric(
                        current.LinkedDevices,
                    );
                    if (tab === "stun")
                        updated.LinkedDevices.STUNServers = cleanStun;
                    else if (tab === "turn")
                        updated.LinkedDevices.TURNServers = cleanTurn;
                    else
                        updated.LinkedDevices.SignalingServers = cleanSignaling;
                    return { vault: updated, result: undefined };
                },
            );
            if (result.isErr()) {
                throw new Error(t`Failed to save connectivity configuration.`);
            }
            setDirty(false);
            setStatus(t`Connectivity configuration saved.`);
            onSaved?.();
            finishEditor(tab);
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t`Failed to save connectivity configuration.`,
            );
        } finally {
            setSaving(false);
        }
    };

    const testServer = async () => {
        const server = activeServers.find((item) => item.ID === editingId);
        if (!server) return;
        setTestingId(server.ID);
        setError("");
        setStatus("");
        try {
            const result =
                tab === "signaling"
                    ? await testSignalingServerConnection(
                          server as SignalingServerConfiguration,
                      )
                    : await testIceServer(tab, server);
            if (result.ok) setStatus(result.message);
            else setError(result.message);
        } finally {
            setTestingId(null);
        }
    };

    if (route === "root") {
        return (
            <View>
                <Text className="mb-1 mt-6 text-[10px] uppercase tracking-[1.1px] text-muted-foreground">
                    {t`Custom servers`}
                </Text>
                <UnlockedMenuRow
                    icon={Globe}
                    title={t`STUN servers`}
                    subtitle={t`Help devices find a direct connection`}
                    value={String(stunServers.length)}
                    onPress={() => onRouteChange("stun")}
                />
                <UnlockedMenuRow
                    icon={Server}
                    title={t`TURN servers`}
                    subtitle={t`Relay encrypted traffic when needed`}
                    value={String(turnServers.length)}
                    onPress={() => onRouteChange("turn")}
                />
                <UnlockedMenuRow
                    icon={RadioTower}
                    title={t`Signaling servers`}
                    subtitle={t`Introduce your devices to each other`}
                    value={String(signalingServers.length)}
                    onPress={() => onRouteChange("signaling")}
                />
                <View className="mt-5 border-l-2 border-muted pl-3">
                    <Text className="text-xs leading-5 text-muted-foreground">
                        {t`For links without Online Services, configure signaling and at least one STUN or TURN server.`}
                    </Text>
                </View>
            </View>
        );
    }

    const tab: ServerTab = route.startsWith("edit-")
        ? (route.slice(5) as ServerTab)
        : (route as ServerTab);
    const activeServers =
        tab === "stun"
            ? draftStun
            : tab === "turn"
              ? draftTurn
              : draftSignaling;

    const savedServers =
        tab === "stun"
            ? stunServers
            : tab === "turn"
              ? turnServers
              : signalingServers;

    const addServer = () => {
        setStunSheetHidden(false);
        markDirty();
        if (tab === "stun") {
            const server = new STUNServerConfiguration("", "");
            setDraftStun((list) => [...list, server]);
            setEditingId(server.ID);
            onRouteChange("edit-stun", server.ID);
        } else if (tab === "turn") {
            onRouteChange("edit-turn", "new");
        } else {
            onRouteChange("edit-signaling", "new");
        }
    };

    const title =
        tab === "stun"
            ? t`STUN servers`
            : tab === "turn"
              ? t`TURN servers`
              : t`Signaling servers`;
    const emptyText =
        tab === "stun"
            ? t`No custom STUN servers configured.`
            : tab === "turn"
              ? t`No custom TURN servers configured.`
              : t`No custom signaling servers configured.`;
    const untitled =
        tab === "stun"
            ? t`Untitled STUN server`
            : tab === "turn"
              ? t`Untitled TURN server`
              : t`Untitled signaling server`;
    const addLabel =
        tab === "stun"
            ? t`Add STUN server`
            : tab === "turn"
              ? t`Add TURN server`
              : t`Add signaling server`;
    const Icon = tab === "stun" ? Globe : tab === "turn" ? Server : RadioTower;
    const serverList = (
        <View className="gap-3">
            <View className="mb-1 border-b border-border pb-[22px]">
                <Text
                    style={{
                        marginTop: 10,
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    {title}
                </Text>
                <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    {tab === "stun"
                        ? t`Discover a direct route between devices.`
                        : tab === "turn"
                          ? t`Relay encrypted traffic when a direct route is unavailable.`
                          : t`Let devices discover each other and exchange connection information.`}
                </Text>
            </View>
            {savedServers.length === 0 ? (
                <View className="my-5 border-l-2 border-border pl-[13px]">
                    <Text className="text-xs leading-[18px] text-muted-foreground">
                        {emptyText}
                    </Text>
                </View>
            ) : (
                savedServers.map((server) => (
                    <UnlockedMenuRow
                        key={server.ID}
                        icon={Icon}
                        title={server.Name || untitled}
                        subtitle={server.Host || t`Configuration incomplete`}
                        onPress={() => {
                            setStunSheetHidden(false);
                            setEditingId(server.ID);
                            onRouteChange(`edit-${tab}`, server.ID);
                        }}
                    />
                ))
            )}
            <Button className="mt-6" onPress={addServer}>
                {addLabel}
            </Button>
        </View>
    );

    if (!route.startsWith("edit-")) return serverList;

    const editingExisting =
        tab === "stun"
            ? stunServers.some((server) => server.ID === editingId)
            : tab === "turn"
              ? turnServers.some((server) => server.ID === editingId)
              : signalingServers.some((server) => server.ID === editingId);

    const deleteServer = async () => {
        setSaving(true);
        setError("");
        onDeletePendingChange?.(true);
        try {
            const result = await persistVaultMutation(
                "vault.configuration",
                (current) => {
                    const updated = Object.assign(new Vault(), current);
                    updated.LinkedDevices = LinkedDevices.fromGeneric(
                        current.LinkedDevices,
                    );
                    if (tab === "stun")
                        updated.LinkedDevices.STUNServers =
                            updated.LinkedDevices.STUNServers.filter(
                                (s) => s.ID !== editingId,
                            );
                    else if (tab === "turn")
                        updated.LinkedDevices.TURNServers =
                            updated.LinkedDevices.TURNServers.filter(
                                (s) => s.ID !== editingId,
                            );
                    else
                        updated.LinkedDevices.SignalingServers =
                            updated.LinkedDevices.SignalingServers.filter(
                                (s) => s.ID !== editingId,
                            );
                    return { vault: updated, result: undefined };
                },
            );
            if (result.isErr())
                throw new Error(t`Could not delete server. Please try again.`);
            setDirty(false);
            onSaved?.();
            finishEditor(tab);
        } catch (e) {
            setError(
                e instanceof Error ? e.message : t`Could not delete server.`,
            );
            onDeletePendingChange?.(false);
        } finally {
            setSaving(false);
        }
    };

    const serverNameLabel = t({
        message: "Name",
        comment: "Name of a custom server",
    });
    const editor = (
        <View className="gap-3">
            {tab !== "stun" ? (
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        {tab === "turn"
                            ? editingExisting
                                ? t`Edit TURN server`
                                : t`Add TURN server`
                            : editingExisting
                              ? t`Edit signaling server`
                              : t`Add signaling server`}
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        {t`Saved inside this vault.`}
                    </Text>
                </View>
            ) : (
                <Text className="text-sm text-muted-foreground">
                    {t`Saved inside this vault.`}
                </Text>
            )}

            {tab === "stun" ? (
                <View className="gap-3">
                    {draftStun.every((server) => server.ID !== editingId) ? (
                        <Text className="text-sm text-muted-foreground">
                            {t`No custom STUN servers.`}
                        </Text>
                    ) : (
                        draftStun
                            .filter((server) => server.ID === editingId)
                            .map((server) => (
                                <View key={server.ID} className="gap-5">
                                    <View>
                                        <Label>{serverNameLabel}</Label>
                                        <Input
                                            value={server.Name}
                                            accessibilityLabel={serverNameLabel}
                                            onChangeText={(value) => {
                                                markDirty();
                                                setDraftStun((list) =>
                                                    list.map((item) =>
                                                        item.ID === server.ID
                                                            ? Object.assign(
                                                                  new STUNServerConfiguration(),
                                                                  item,
                                                                  {
                                                                      Name: value,
                                                                  },
                                                              )
                                                            : item,
                                                    ),
                                                );
                                            }}
                                            placeholder={t({
                                                message: "Home STUN",
                                                comment:
                                                    "Example name for a STUN server",
                                            })}
                                        />
                                    </View>
                                    <View>
                                        <Label>{t`Host / URL`}</Label>
                                        <Input
                                            value={server.Host}
                                            accessibilityLabel={t`Host / URL`}
                                            onChangeText={(value) => {
                                                markDirty();
                                                setDraftStun((list) =>
                                                    list.map((item) =>
                                                        item.ID === server.ID
                                                            ? Object.assign(
                                                                  new STUNServerConfiguration(),
                                                                  item,
                                                                  {
                                                                      Host: value,
                                                                  },
                                                              )
                                                            : item,
                                                    ),
                                                );
                                            }}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            // i18n-ignore: example host
                                            placeholder="stun.example.com:3478"
                                        />
                                    </View>
                                </View>
                            ))
                    )}
                </View>
            ) : null}

            {tab === "turn" ? (
                <View className="gap-3">
                    {draftTurn.every((server) => server.ID !== editingId) ? (
                        <Text className="text-sm text-muted-foreground">
                            {t`No custom TURN servers.`}
                        </Text>
                    ) : (
                        draftTurn
                            .filter((server) => server.ID === editingId)
                            .map((server) => {
                                return (
                                    <View key={server.ID} className="gap-5">
                                        <View>
                                            <Label>{serverNameLabel}</Label>
                                            <Input
                                                value={server.Name}
                                                accessibilityLabel={
                                                    serverNameLabel
                                                }
                                                onChangeText={(value) => {
                                                    markDirty();
                                                    setDraftTurn((list) =>
                                                        list.map((item) =>
                                                            item.ID ===
                                                            server.ID
                                                                ? Object.assign(
                                                                      new TURNServerConfiguration(),
                                                                      item,
                                                                      {
                                                                          Name: value,
                                                                      },
                                                                  )
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                                placeholder={t({
                                                    message: "Home TURN",
                                                    comment:
                                                        "Example name for a TURN server",
                                                })}
                                            />
                                        </View>
                                        <View>
                                            <Label>{t`Host / URL`}</Label>
                                            <Input
                                                value={server.Host}
                                                accessibilityLabel={t`Host / URL`}
                                                onChangeText={(value) => {
                                                    markDirty();
                                                    setDraftTurn((list) =>
                                                        list.map((item) =>
                                                            item.ID ===
                                                            server.ID
                                                                ? Object.assign(
                                                                      new TURNServerConfiguration(),
                                                                      item,
                                                                      {
                                                                          Host: value,
                                                                      },
                                                                  )
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                // i18n-ignore: example host
                                                placeholder="turn.example.com:3478"
                                            />
                                        </View>
                                        <View>
                                            <Label>{t`Username`}</Label>
                                            <Input
                                                value={server.Username}
                                                accessibilityLabel={t`Username`}
                                                onChangeText={(value) => {
                                                    markDirty();
                                                    setDraftTurn((list) =>
                                                        list.map((item) =>
                                                            item.ID ===
                                                            server.ID
                                                                ? Object.assign(
                                                                      new TURNServerConfiguration(),
                                                                      item,
                                                                      {
                                                                          Username:
                                                                              value,
                                                                      },
                                                                  )
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                            />
                                        </View>
                                        <View>
                                            <Label>
                                                {t({
                                                    message: "Credential",
                                                    context:
                                                        "TURN server password",
                                                })}
                                            </Label>
                                            <Input
                                                value={server.Password}
                                                onChangeText={(value) => {
                                                    markDirty();
                                                    setDraftTurn((list) =>
                                                        list.map((item) =>
                                                            item.ID ===
                                                            server.ID
                                                                ? Object.assign(
                                                                      new TURNServerConfiguration(),
                                                                      item,
                                                                      {
                                                                          Password:
                                                                              value,
                                                                      },
                                                                  )
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                                secureTextEntry
                                                revealButtonHeight={54}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                accessibilityLabel={t`TURN credential`}
                                            />
                                        </View>
                                    </View>
                                );
                            })
                    )}
                </View>
            ) : null}

            {tab === "signaling" ? (
                <View className="gap-3">
                    {draftSignaling.every(
                        (server) => server.ID !== editingId,
                    ) ? (
                        <Text className="text-sm text-muted-foreground">
                            {t`No custom signaling servers.`}
                        </Text>
                    ) : (
                        draftSignaling
                            .filter((server) => server.ID === editingId)
                            .map((server) => {
                                return (
                                    <View key={server.ID} className="gap-5">
                                        {(
                                            [
                                                [
                                                    serverNameLabel,
                                                    "Name",
                                                    t({
                                                        message: "Home Pusher",
                                                        comment:
                                                            "Example name for a signaling server",
                                                    }),
                                                ],
                                                [
                                                    t({
                                                        message: "Host",
                                                        comment:
                                                            "Signaling server host name",
                                                    }),
                                                    "Host",
                                                    "pusher.example.com",
                                                ],
                                                [t`App ID`, "AppID", "app-id"],
                                                [
                                                    t({
                                                        message: "Key",
                                                        comment:
                                                            "Signaling server app key",
                                                    }),
                                                    "Key",
                                                    "app-key",
                                                ],
                                                [
                                                    t({
                                                        message: "Secret",
                                                        comment:
                                                            "Signaling server app secret",
                                                    }),
                                                    "Secret",
                                                    "",
                                                ],
                                                [
                                                    t`WS port`,
                                                    "ServicePort",
                                                    "6001",
                                                ],
                                                [
                                                    t`WSS port (0 = disable TLS)`,
                                                    "SecureServicePort",
                                                    "0",
                                                ],
                                            ] as const
                                        ).map(([label, field, placeholder]) => (
                                            <View key={field}>
                                                <Label>{label}</Label>
                                                <Input
                                                    value={String(
                                                        server[field],
                                                    )}
                                                    onChangeText={(value) => {
                                                        markDirty();
                                                        setDraftSignaling(
                                                            (list) =>
                                                                list.map(
                                                                    (item) =>
                                                                        item.ID ===
                                                                        server.ID
                                                                            ? Object.assign(
                                                                                  new SignalingServerConfiguration(),
                                                                                  item,
                                                                                  {
                                                                                      [field]:
                                                                                          value,
                                                                                  },
                                                                              )
                                                                            : item,
                                                                ),
                                                        );
                                                    }}
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    placeholder={placeholder}
                                                    accessibilityLabel={label}
                                                    secureTextEntry={
                                                        field === "Secret"
                                                    }
                                                    revealButtonHeight={54}
                                                    keyboardType={
                                                        field ===
                                                            "ServicePort" ||
                                                        field ===
                                                            "SecureServicePort"
                                                            ? "number-pad"
                                                            : "default"
                                                    }
                                                />
                                            </View>
                                        ))}
                                    </View>
                                );
                            })
                    )}
                </View>
            ) : null}

            {error ? <InlineNotice tone="error" message={error} /> : null}
            {status ? <InlineNotice tone="success" message={status} /> : null}

            {editingExisting ? (
                <Button
                    variant="outline"
                    loading={testingId !== null}
                    disabled={saving}
                    onPress={() => void testServer()}
                >
                    {t`Test connection`}
                </Button>
            ) : null}
            {editingExisting ? (
                <Button
                    variant="destructive"
                    disabled={saving || testingId !== null}
                    onPress={() => {
                        if (tab === "stun") setStunSheetHidden(true);
                        confirm({
                            title: t`Delete server?`,
                            description: t`Remove this custom server from the vault.`,
                            confirmLabel: t`Delete server`,
                            cancelLabel: t`Keep server`,
                            onCancel: () => setStunSheetHidden(false),
                            onConfirm: () => {
                                setStunSheetHidden(false);
                                void deleteServer();
                            },
                        });
                    }}
                >
                    {t`Delete server`}
                </Button>
            ) : null}
            <Button
                className="mt-6"
                loading={saving}
                disabled={!dirty || testingId !== null}
                onPress={() => void save()}
            >
                {t`Save server`}
            </Button>
        </View>
    );
    if (tab !== "stun") return editor;
    const closeStunEditor = () => {
        if (saving || testingId !== null) return;
        if (!dirty) {
            onRouteChange("stun");
            return;
        }
        setStunSheetHidden(true);
        confirm({
            title: t`Discard server changes?`,
            description: t`Your STUN server changes have not been saved.`,
            confirmLabel: t`Discard changes`,
            cancelLabel: t`Keep editing`,
            onConfirm: () => onRouteChange("stun"),
            onCancel: () => setStunSheetHidden(false),
        });
    };
    return (
        <>
            {serverList}
            <Dialog
                open={!stunSheetHidden}
                onOpenChange={(open) => !open && closeStunEditor()}
                placement="bottom"
                scroll
                dismissible={!saving && testingId === null}
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {editingExisting
                            ? t`Edit STUN server`
                            : t`Add STUN server`}
                    </UnlockedDialogTitle>
                </DialogHeader>
                {editor}
            </Dialog>
        </>
    );
}
