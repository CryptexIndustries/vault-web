import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useLingui } from "@lingui/react/macro";

import { Snackbar, useSnackbar } from "@/components/snackbar";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { saveMobileShareSettings } from "@/app_lib/share-links";
import { env } from "@/env";
import { getUnlockedVault } from "@/utils/atoms";
import { colors } from "@/theme";

export default function ShareServerScreen() {
    const { t } = useLingui();
    const [origin, setOrigin] = useState("");
    const [token, setToken] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const { feedback, show, dismiss } = useSnackbar("share-server");

    useEffect(() => {
        const settings = getUnlockedVault().ShareSettings;
        setOrigin(settings?.ServerOrigin ?? "");
        setToken(settings?.CreationToken ?? "");
    }, []);

    const save = async () => {
        setError("");
        let serverOrigin = "";
        if (origin.trim()) {
            try {
                const url = new URL(origin.trim());
                const local =
                    url.hostname === "localhost" ||
                    url.hostname === "127.0.0.1" ||
                    url.hostname === "10.0.2.2";
                if (url.protocol !== "https:" && !local) {
                    setError(t`Use an https:// address.`);
                    return;
                }
                serverOrigin = url.origin;
            } catch {
                setError(
                    t`Enter a full address, like https://vault.example.com.`,
                );
                return;
            }
        }
        setSaving(true);
        try {
            await saveMobileShareSettings({
                ServerOrigin: serverOrigin,
                CreationToken: token.trim(),
            });
            router.back();
        } catch {
            show(t`Couldn't save the share server settings.`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <UnlockedTaskScreen
            title={t`Share server`}
            footer={
                <View style={{ gap: 10 }}>
                    <Snackbar
                        feedback={feedback}
                        onDismiss={dismiss}
                        floating={false}
                    />
                    <Button disabled={saving} onPress={() => void save()}>
                        {saving ? t`Saving…` : t`Save`}
                    </Button>
                </View>
            }
        >
            <View style={{ gap: 18 }}>
                <Text style={{ color: colors.muted, lineHeight: 21 }}>
                    {t`Use the Cryptex Vault server with Online Services, or your own share server. This setting stays on this phone.`}
                </Text>
                <View style={{ gap: 8 }}>
                    <Label>{t`Share server`}</Label>
                    <Input
                        value={origin}
                        onChangeText={setOrigin}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        placeholder={new URL(env.APP_URL).origin}
                    />
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                        {t`Leave empty to use the Cryptex Vault server.`}
                    </Text>
                </View>
                <View style={{ gap: 8 }}>
                    <Label>{t`Creation token`}</Label>
                    <Input
                        value={token}
                        onChangeText={setToken}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={t`Only for self-hosted servers`}
                    />
                </View>
                {error ? <InlineNotice tone="error" message={error} /> : null}
            </View>
        </UnlockedTaskScreen>
    );
}
