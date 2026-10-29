import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useLingui } from "@lingui/react/macro";
import {
    Accessibility,
    Globe,
    KeyRound,
    Settings2,
    Shield,
} from "lucide-react-native";

import {
    UnlockedButton,
    UnlockedMenuRow,
    UnlockedTaskScreen,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Switch } from "@/components/ui/switch";
import {
    androidCredentials,
    type AndroidBrowserAutofillIntegration,
} from "@/utils/android-credentials";
import {
    getCachedAutoCopyTotp,
    loadAutoCopyTotp,
    saveAutoCopyTotp,
} from "@/utils/autofill-settings";
import { colors } from "@/theme";

type Pane = "root" | "browsers" | "accessibility";

function Intro({ title, body }: { title: string; body: string }) {
    return (
        <View
            style={{
                paddingBottom: 22,
                marginBottom: 6,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <UnlockedText
                style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}
            >
                {title}
            </UnlockedText>
            <UnlockedText
                style={{
                    color: colors.muted,
                    fontSize: 13,
                    lineHeight: 20,
                    marginTop: 6,
                }}
            >
                {body}
            </UnlockedText>
        </View>
    );
}

function SectionLabel({ children }: { children: string }) {
    return (
        <UnlockedText
            style={{
                color: colors.muted,
                fontSize: 11,
                letterSpacing: 1,
                marginTop: 26,
                marginBottom: 6,
                textTransform: "uppercase",
            }}
        >
            {children}
        </UnlockedText>
    );
}

export default function AutofillSettingsScreen() {
    const { t } = useLingui();
    const on = t({ message: "On", comment: "Setting status: enabled" });
    const off = t({ message: "Off", comment: "Setting status: disabled" });
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [pane, setPane] = useState<Pane>("root");
    const [enabled, setEnabled] = useState(false);
    const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
    const [inlineEnabled, setInlineEnabled] = useState(true);
    const [autoCopyTotp, setAutoCopyTotp] = useState(getCachedAutoCopyTotp());
    const [browsers, setBrowsers] = useState<
        AndroidBrowserAutofillIntegration[]
    >([]);
    const credentialProviderAvailable =
        androidCredentials.isCredentialProviderAvailable();

    const refresh = useCallback(() => {
        setEnabled(androidCredentials.isAutofillEnabled());
        setAccessibilityEnabled(
            androidCredentials.isAccessibilityAutofillEnabled(),
        );
        setInlineEnabled(androidCredentials.isInlineSuggestionsEnabled());
        setBrowsers(
            androidCredentials
                .getBrowserAutofillIntegrations()
                .filter((browser) => browser.available),
        );
        void loadAutoCopyTotp().then(setAutoCopyTotp);
    }, []);
    useFocusEffect(refresh);
    useEffect(() => {
        const subscription = AppState.addEventListener(
            "change",
            (state) => state === "active" && refresh(),
        );
        return () => subscription.remove();
    }, [refresh]);

    return (
        <UnlockedTaskScreen title={t`Autofill`}>
            <Dialog
                open={suggestionsOpen}
                onOpenChange={setSuggestionsOpen}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {t`Suggestion display`}
                    </UnlockedDialogTitle>
                </DialogHeader>
                {[
                    {
                        value: true,
                        label: t`Above keyboard`,
                        hint: t`Uses the keyboard suggestion strip when supported.`,
                    },
                    {
                        value: false,
                        label: t`Popup / dropdown`,
                        hint: t`Shows suggestions next to the login field.`,
                    },
                ].map((option) => (
                    <Pressable
                        key={option.label}
                        accessibilityRole="radio"
                        accessibilityState={{
                            checked: inlineEnabled === option.value,
                        }}
                        onPress={() => {
                            androidCredentials.setInlineSuggestionsEnabled(
                                option.value,
                            );
                            setInlineEnabled(option.value);
                            setSuggestionsOpen(false);
                        }}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            minHeight: 58,
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <View
                            style={{
                                width: 18,
                                height: 18,
                                borderRadius: 9,
                                borderWidth: 1,
                                borderColor:
                                    inlineEnabled === option.value
                                        ? colors.primary
                                        : colors.muted,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {inlineEnabled === option.value ? (
                                <View
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: 5,
                                        backgroundColor: colors.primary,
                                    }}
                                />
                            ) : null}
                        </View>
                        <View style={{ flex: 1 }}>
                            <UnlockedText style={{ fontSize: 14 }}>
                                {option.label}
                            </UnlockedText>
                            <UnlockedText
                                style={{
                                    fontSize: 12,
                                    lineHeight: 18,
                                    color: colors.muted,
                                    marginTop: 5,
                                }}
                            >
                                {option.hint}
                            </UnlockedText>
                        </View>
                    </Pressable>
                ))}
            </Dialog>
            <>
                <Intro
                    title={t`Fill from your vault`}
                    body={t`Use your saved passwords and passkeys in apps and browsers.`}
                />
                <SectionLabel>{t`Android integration`}</SectionLabel>
                <UnlockedMenuRow
                    icon={KeyRound}
                    title={t`Password autofill`}
                    subtitle={
                        enabled
                            ? t`Cryptex Vault is selected`
                            : t`Select Cryptex Vault in Android settings`
                    }
                    value={enabled ? on : off}
                    onPress={() => androidCredentials.openAutofillSettings()}
                />
                <UnlockedMenuRow
                    icon={Globe}
                    title={t`Browser integrations`}
                    subtitle={t`Use browser-protected autofill where available`}
                    onPress={() => setPane("browsers")}
                />
                <UnlockedMenuRow
                    icon={Shield}
                    title={t`Passkey provider`}
                    subtitle={
                        credentialProviderAvailable
                            ? t`Create and use passkeys on Android 14+`
                            : t`Requires Android 14 or newer`
                    }
                    onPress={() =>
                        androidCredentials.openCredentialProviderSettings()
                    }
                />
                <SectionLabel>{t`Preferences`}</SectionLabel>
                <UnlockedMenuRow
                    icon={Settings2}
                    title={t`Suggestion display`}
                    subtitle={t`Choose where suggestions appear`}
                    value={
                        inlineEnabled ? t`Above keyboard` : t`Popup / dropdown`
                    }
                    onPress={() => setSuggestionsOpen(true)}
                />
                <View
                    style={{
                        minHeight: 70,
                        paddingVertical: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <View style={{ flex: 1, paddingRight: 12 }}>
                        <UnlockedText style={{ fontSize: 14 }}>
                            {t`Copy verification codes`}
                        </UnlockedText>
                        <UnlockedText
                            style={{
                                color: colors.muted,
                                fontSize: 12,
                                lineHeight: 18,
                                marginTop: 5,
                            }}
                        >
                            {t`Copy the current code after autofill. It clears after 30 seconds.`}
                        </UnlockedText>
                    </View>
                    <Switch
                        value={autoCopyTotp}
                        onValueChange={(value) => {
                            setAutoCopyTotp(value);
                            void saveAutoCopyTotp(value);
                        }}
                        accessibilityLabel={t`Copy verification codes after autofill`}
                    />
                </View>
                <SectionLabel>
                    {t({
                        message: "Optional",
                        comment:
                            "Section heading for optional autofill features",
                    })}
                </SectionLabel>
                <UnlockedMenuRow
                    icon={Accessibility}
                    title={t`Accessibility fallback`}
                    subtitle={t`For apps that do not support Android autofill`}
                    value={accessibilityEnabled ? on : off}
                    onPress={() => setPane("accessibility")}
                />
            </>
            <Dialog
                open={pane !== "root"}
                onOpenChange={(open) => !open && setPane("root")}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {pane === "browsers"
                            ? t`Browser integrations`
                            : t`Accessibility fallback`}
                    </UnlockedDialogTitle>
                </DialogHeader>
                {pane === "browsers" ? (
                    <>
                        <UnlockedText
                            style={{
                                color: colors.muted,
                                fontSize: 13,
                                lineHeight: 20,
                            }}
                        >
                            {t`Use Android password autofill first. Some browsers also need their own switch to use another password manager. Accessibility filling is a separate fallback.`}
                        </UnlockedText>
                        {browsers.length ? (
                            browsers.map((browser) => (
                                <UnlockedMenuRow
                                    key={browser.packageName}
                                    icon={Globe}
                                    title={browser.label}
                                    subtitle={t`Use another autofill service`}
                                    value={browser.enabled ? on : off}
                                    onPress={() =>
                                        androidCredentials.openBrowserAutofillSettings(
                                            browser.packageName,
                                        )
                                    }
                                />
                            ))
                        ) : (
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    lineHeight: 20,
                                }}
                            >
                                {t`Installed browsers use Android’s selected service directly. No separate browser setting was found.`}
                            </UnlockedText>
                        )}
                        <View
                            style={{
                                borderLeftWidth: 2,
                                borderLeftColor: colors.muted,
                                paddingLeft: 13,
                                marginVertical: 20,
                            }}
                        >
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    lineHeight: 18,
                                }}
                            >
                                {t`Other browsers may use Android’s selected service directly, without a separate setting.`}
                            </UnlockedText>
                        </View>
                    </>
                ) : (
                    <>
                        <UnlockedText
                            style={{
                                color: colors.muted,
                                fontSize: 13,
                                lineHeight: 20,
                            }}
                        >
                            {t`An optional Cryptex Vault button can appear on login fields where Android autofill is unavailable.`}
                        </UnlockedText>
                        <View
                            style={{
                                borderLeftWidth: 2,
                                borderLeftColor: colors.primary,
                                paddingLeft: 13,
                                marginVertical: 20,
                            }}
                        >
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    lineHeight: 18,
                                }}
                            >
                                {t`Android gives accessibility services broad access to on-screen controls. In a browser, an embedded or hidden frame may receive a login even when the address bar shows another site. Enable this only if you need it. Every browser fill asks for another confirmation, but this cannot verify who owns the field.`}
                            </UnlockedText>
                        </View>
                        {[
                            [
                                t`Field labels`,
                                t`Used to offer the Cryptex button`,
                            ],
                            [
                                t`Form values`,
                                t`Read after you choose Save login`,
                            ],
                            [
                                t`Vault secrets`,
                                t`Released after you choose Autofill login`,
                            ],
                        ].map(([label, value]) => (
                            <View
                                key={label}
                                style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 20,
                                    paddingVertical: 16,
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                }}
                            >
                                <UnlockedText
                                    style={{
                                        fontSize: 13,
                                        color: colors.muted,
                                    }}
                                >
                                    {label}
                                </UnlockedText>
                                <UnlockedText
                                    style={{
                                        fontSize: 13,
                                        lineHeight: 19,
                                        maxWidth: "65%",
                                        textAlign: "right",
                                    }}
                                >
                                    {value}
                                </UnlockedText>
                            </View>
                        ))}
                        <UnlockedText style={{ fontSize: 13, lineHeight: 19 }}>
                            {t`Nothing this service reads is sent off your phone. Logins you save go into your encrypted vault.`}
                        </UnlockedText>
                        <View
                            style={{
                                borderLeftWidth: 2,
                                borderLeftColor: colors.muted,
                                paddingLeft: 13,
                                marginVertical: 20,
                            }}
                        >
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    lineHeight: 18,
                                }}
                            >
                                {t`If Android hides a password field, enter the password again inside Cryptex Vault. You can turn this service off in Android settings.`}
                            </UnlockedText>
                        </View>
                        {/* Google Play requires an explicit choice before the service can be turned on. */}
                        <UnlockedButton
                            style={{ marginTop: 24 }}
                            onPress={() =>
                                androidCredentials.openAccessibilityAutofillSettings()
                            }
                        >
                            {accessibilityEnabled
                                ? t`Review accessibility access`
                                : t`Agree and continue`}
                        </UnlockedButton>
                        {accessibilityEnabled ? null : (
                            <UnlockedButton
                                variant="ghost"
                                style={{ marginTop: 8 }}
                                onPress={() => setPane("root")}
                            >
                                {t`Not now`}
                            </UnlockedButton>
                        )}
                    </>
                )}
            </Dialog>
        </UnlockedTaskScreen>
    );
}
