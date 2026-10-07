import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Accessibility, Globe, KeyRound, Settings2, Shield } from "lucide-react-native";

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
        <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}>{title}</UnlockedText>
            <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>{body}</UnlockedText>
        </View>
    );
}

function SectionLabel({ children }: { children: string }) {
    return (
        <UnlockedText style={{ color: colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 26, marginBottom: 6, textTransform: "uppercase" }}>
            {children}
        </UnlockedText>
    );
}

export default function AutofillSettingsScreen() {
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [pane, setPane] = useState<Pane>("root");
    const [enabled, setEnabled] = useState(false);
    const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
    const [inlineEnabled, setInlineEnabled] = useState(true);
    const [autoCopyTotp, setAutoCopyTotp] = useState(getCachedAutoCopyTotp());
    const [browsers, setBrowsers] = useState<AndroidBrowserAutofillIntegration[]>([]);
    const credentialProviderAvailable = androidCredentials.isCredentialProviderAvailable();

    const refresh = useCallback(() => {
        setEnabled(androidCredentials.isAutofillEnabled());
        setAccessibilityEnabled(androidCredentials.isAccessibilityAutofillEnabled());
        setInlineEnabled(androidCredentials.isInlineSuggestionsEnabled());
        setBrowsers(androidCredentials.getBrowserAutofillIntegrations().filter((browser) => browser.available));
        void loadAutoCopyTotp().then(setAutoCopyTotp);
    }, []);
    useFocusEffect(refresh);
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => state === "active" && refresh());
        return () => subscription.remove();
    }, [refresh]);

    return (
        <UnlockedTaskScreen title="Autofill">
            <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen} placement="bottom" scroll>
                <DialogHeader><UnlockedDialogTitle>Suggestion display</UnlockedDialogTitle></DialogHeader>
                    {[{ value: true, label: "Above keyboard", hint: "Uses the keyboard suggestion strip when supported." }, { value: false, label: "Popup / dropdown", hint: "Shows suggestions next to the login field." }].map((option) => (
                        <Pressable key={option.label} accessibilityRole="radio" accessibilityState={{ checked: inlineEnabled === option.value }} onPress={() => { androidCredentials.setInlineSuggestionsEnabled(option.value); setInlineEnabled(option.value); setSuggestionsOpen(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: inlineEnabled === option.value ? colors.primary : colors.muted, alignItems: "center", justifyContent: "center" }}>{inlineEnabled === option.value ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}</View>
                            <View style={{ flex: 1 }}><UnlockedText style={{ fontSize: 14 }}>{option.label}</UnlockedText><UnlockedText style={{ fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 5 }}>{option.hint}</UnlockedText></View>
                        </Pressable>
                    ))}
            </Dialog>
            <>
                    <Intro title="Fill from your vault" body="Use your saved passwords and passkeys in apps and browsers." />
                    <SectionLabel>Android integration</SectionLabel>
                    <UnlockedMenuRow icon={KeyRound} title="Password autofill" subtitle={enabled ? "Cryptex Vault is selected" : "Select Cryptex Vault in Android settings"} value={enabled ? "On" : "Off"} onPress={() => androidCredentials.openAutofillSettings()} />
                    <UnlockedMenuRow icon={Globe} title="Browser integrations" subtitle="Use browser-protected autofill where available" onPress={() => setPane("browsers")} />
                    <UnlockedMenuRow icon={Shield} title="Passkey provider" subtitle={credentialProviderAvailable ? "Create and use passkeys on Android 14+" : "Requires Android 14 or newer"} onPress={() => androidCredentials.openCredentialProviderSettings()} />
                    <SectionLabel>Preferences</SectionLabel>
                    <UnlockedMenuRow icon={Settings2} title="Suggestion display" subtitle="Choose where suggestions appear" value={inlineEnabled ? "Above keyboard" : "Popup / dropdown"} onPress={() => setSuggestionsOpen(true)} />
                    <View style={{ minHeight: 70, paddingVertical: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                            <UnlockedText style={{ fontSize: 14 }}>Copy verification codes</UnlockedText>
                            <UnlockedText style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }}>Copy the current code after autofill. It clears after 30 seconds.</UnlockedText>
                        </View>
                        <Switch value={autoCopyTotp} onValueChange={(value) => { setAutoCopyTotp(value); void saveAutoCopyTotp(value); }} accessibilityLabel="Copy verification codes after autofill" />
                    </View>
                    <SectionLabel>Optional</SectionLabel>
                    <UnlockedMenuRow icon={Accessibility} title="Accessibility fallback" subtitle="For apps that do not support Android autofill" value={accessibilityEnabled ? "On" : "Off"} onPress={() => setPane("accessibility")} />
            </>
            <Dialog open={pane !== "root"} onOpenChange={(open) => !open && setPane("root")} placement="bottom" scroll>
                <DialogHeader><UnlockedDialogTitle>{pane === "browsers" ? "Browser integrations" : "Accessibility fallback"}</UnlockedDialogTitle></DialogHeader>
                {pane === "browsers" ? (
                <>
                    <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>Use Android password autofill first. Some browsers also need their own switch to use another password manager. Accessibility filling is a separate fallback.</UnlockedText>
                    {browsers.length ? browsers.map((browser) => <UnlockedMenuRow key={browser.packageName} icon={Globe} title={browser.label} subtitle="Use another autofill service" value={browser.enabled ? "On" : "Off"} onPress={() => androidCredentials.openBrowserAutofillSettings(browser.packageName)} />) : <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>Installed browsers use Android’s selected service directly. No separate browser setting was found.</UnlockedText>}
                    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.muted, paddingLeft: 13, marginVertical: 20 }}><UnlockedText style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Other browsers may use Android’s selected service directly, without a separate setting.</UnlockedText></View>
                </>
            ) : (
                <>
                    <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>An optional Cryptex Vault button can appear on login fields where Android autofill is unavailable.</UnlockedText>
                    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: 13, marginVertical: 20 }}><UnlockedText style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Android gives accessibility services broad access to on-screen controls. In a browser, an embedded or hidden frame may receive a login even when the address bar shows another site. Enable this only if you need it. Every browser fill asks for another confirmation, but this cannot verify who owns the field.</UnlockedText></View>
                    {[["Field labels", "Used to offer the Cryptex button"], ["Form values", "Read after you choose Save login"], ["Vault secrets", "Released after you choose Autofill login"]].map(([label, value]) => <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}><UnlockedText style={{ fontSize: 13, color: colors.muted }}>{label}</UnlockedText><UnlockedText style={{ fontSize: 13, lineHeight: 19, maxWidth: "65%", textAlign: "right" }}>{value}</UnlockedText></View>)}
                    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.muted, paddingLeft: 13, marginVertical: 20 }}><UnlockedText style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>If Android hides a password field, enter the password again inside Cryptex Vault. You can turn this service off in Android settings.</UnlockedText></View>
                    <UnlockedButton style={{ marginTop: 24 }} onPress={() => androidCredentials.openAccessibilityAutofillSettings()}>{accessibilityEnabled ? "Review accessibility access" : "Continue to Android settings"}</UnlockedButton>
                </>
                )}
            </Dialog>
        </UnlockedTaskScreen>
    );
}
