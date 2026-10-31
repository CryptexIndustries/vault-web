import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useLingui } from "@lingui/react/macro";
import {
    BatteryCharging,
    ChevronRight,
    Cloud,
    Server,
} from "lucide-react-native";
import {
    normalizeRelayUrlInput,
    type CustomRelay,
} from "@cryptex-industries/vault-core/agent/runtime";

import { InlineNotice } from "@/components/inline-notice";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import { AgentSectionLabel } from "@/components/agents/agent-rows";
import { agentRuntime } from "@/agent/agent-app";
import { agentService } from "@/agent/agent-service";
import {
    loadCustomRelays,
    removeCustomRelay,
    saveCustomRelay,
} from "@/agent/agent-storage";
import { env } from "@/env";
import { colors } from "@/theme";

function RelayRow({
    icon: Icon,
    title,
    subtitle,
    testID,
    onPress,
}: {
    icon: typeof Server;
    title: string;
    subtitle: string;
    testID?: string;
    onPress?: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            accessibilityRole={onPress ? "button" : undefined}
            accessibilityLabel={`${title}, ${subtitle}`}
            disabled={!onPress}
            onPress={onPress}
            android_ripple={onPress ? { color: colors.border } : undefined}
            style={{
                minHeight: 70,
                flexDirection: "row",
                alignItems: "center",
                gap: 13,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Icon size={22} color={colors.muted} strokeWidth={1.7} />
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                <Text numberOfLines={1} style={{ fontSize: 14 }}>
                    {title}
                </Text>
                <Text
                    numberOfLines={1}
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 5,
                    }}
                >
                    {subtitle}
                </Text>
            </View>
            {onPress ? <ChevronRight size={17} color={colors.muted} /> : null}
        </Pressable>
    );
}

export default function AgentRelayScreen() {
    const { t } = useLingui();
    const showSnackbar = useUnlockedSnackbar();
    const [relays, setRelays] = useState<CustomRelay[]>([]);
    const [editing, setEditing] = useState<CustomRelay | "new" | null>(null);
    const [url, setUrl] = useState("");
    const [token, setToken] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    const refresh = useCallback(
        async () => setRelays(await loadCustomRelays()),
        [],
    );
    useEffect(() => {
        void refresh();
    }, [refresh]);

    const open = (relay: CustomRelay | "new") => {
        setEditing(relay);
        setUrl(relay === "new" ? "" : relay.origin);
        setToken(relay === "new" ? "" : relay.token);
        setError("");
    };

    const save = async () => {
        const origin = normalizeRelayUrlInput(url);
        if (!origin) {
            setError(
                t`Enter a full https:// address, like https://relay.example.com.`,
            );
            return;
        }
        if (!token.trim()) {
            setError(t`Enter the relay's access token.`);
            return;
        }
        setSaving(true);
        try {
            if (editing && editing !== "new" && editing.origin !== origin)
                await removeCustomRelay(editing.origin);
            await saveCustomRelay({ origin, token: token.trim() });
            await refresh();
            await agentRuntime.reload();
            setEditing(null);
        } catch {
            showSnackbar(t`Couldn't save the relay.`);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!editing || editing === "new") return;
        await removeCustomRelay(editing.origin);
        await refresh();
        await agentRuntime.reload();
        setEditing(null);
        showSnackbar(t`Relay removed`);
    };

    const hostedRelayHost = new URL(env.RELAY_URL).host;

    return (
        <UnlockedTaskScreen title={t`Agent relays`}>
            <View className="w-full max-w-[480px] self-center">
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                    }}
                >
                    {t`Connected agents reach this phone through a relay. The agent picks it when you run cryptex-agent pair; agents keep the relay they were paired on.`}
                </Text>
                <AgentSectionLabel
                    title={t({
                        message: "Hosted",
                        comment:
                            "Section heading: the relay run by Cryptex Online Services",
                    })}
                />
                <RelayRow
                    icon={Cloud}
                    title={t({
                        message: "Online Services",
                        comment: "Product name of the hosted Cryptex service",
                    })}
                    subtitle={t`${hostedRelayHost}, included with your plan`}
                />
                <AgentSectionLabel
                    title={t`Your own relays`}
                    right={String(relays.length)}
                />
                {relays.length ? (
                    relays.map((relay) => (
                        <RelayRow
                            key={relay.origin}
                            testID={`agent-relay-${new URL(relay.origin).host}`}
                            icon={Server}
                            title={relay.origin.replace(/^https?:\/\//, "")}
                            subtitle={t`Access token saved on this phone`}
                            onPress={() => open(relay)}
                        />
                    ))
                ) : (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                            paddingVertical: 14,
                        }}
                    >
                        {t`No relays of your own yet. Add one to pair agents through a relay-server you run.`}
                    </Text>
                )}
                <Button
                    testID="agent-relay-add"
                    variant="outline"
                    className="mt-5"
                    onPress={() => open("new")}
                >
                    {t`Add relay`}
                </Button>
                {agentService.available ? (
                    <>
                        <AgentSectionLabel
                            title={t`On this phone`}
                            style={{ marginTop: 24 }}
                        />
                        <RelayRow
                            testID="agent-battery-settings"
                            icon={BatteryCharging}
                            title={t`Battery settings`}
                            subtitle={t`Let the app run in the background for agents`}
                            onPress={() =>
                                void agentService.openBatterySettings()
                            }
                        />
                    </>
                ) : null}
            </View>
            <Dialog
                open={editing !== null}
                onOpenChange={(value) => !value && !saving && setEditing(null)}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>
                        {editing === "new" ? t`Add relay` : t`Edit relay`}
                    </DialogTitle>
                    <DialogDescription>
                        {t`A relay-server you run in token mode. The token stays on this phone.`}
                    </DialogDescription>
                </DialogHeader>
                <View className="gap-2">
                    <Label>{t`Relay URL`}</Label>
                    <Input
                        testID="agent-relay-url"
                        value={url}
                        onChangeText={(value) => {
                            setUrl(value);
                            setError("");
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        // i18n-ignore: example URL
                        placeholder="https://relay.example.com"
                    />
                </View>
                <View className="gap-2">
                    <Label>{t`Access token`}</Label>
                    <Input
                        testID="agent-relay-token"
                        value={token}
                        onChangeText={(value) => {
                            setToken(value);
                            setError("");
                        }}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
                {error ? <InlineNotice tone="error" message={error} /> : null}
                <Button
                    loading={saving}
                    loadingLabel={t`Saving…`}
                    onPress={() => void save()}
                >
                    {t`Save`}
                </Button>
                {editing && editing !== "new" ? (
                    <Button
                        variant="ghost"
                        disabled={saving}
                        onPress={() => void remove()}
                    >
                        {t`Remove relay`}
                    </Button>
                ) : null}
            </Dialog>
        </UnlockedTaskScreen>
    );
}
