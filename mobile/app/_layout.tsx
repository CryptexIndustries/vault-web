import "../src/polyfills";
import "../src/i18n";
import "../src/vault-core-runtime";
import "../global.css";

import { useEffect, useRef, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";

import * as SplashScreen from "expo-splash-screen";
import { useLocales } from "expo-localization";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider as JotaiProvider, useAtomValue } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalHost } from "@rn-primitives/portal";
import {
    Oxanium_400Regular,
    Oxanium_500Medium,
    Oxanium_600SemiBold,
    Oxanium_700Bold,
    useFonts,
} from "@expo-google-fonts/oxanium";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { AppState, Platform } from "react-native";

import {
    isVaultUnlockedAtom,
    unlockedVaultMetadataAtom,
    vaultCredentialsAtom,
    vaultStore,
} from "@/utils/atoms";
import { trpcReact, reactQueryClientConfig } from "@/utils/trpc";
import { androidCredentials } from "@/utils/android-credentials";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";
import {
    retryIosCredentialIdentityClears,
    syncIosCredentialIdentities,
} from "@/utils/ios-credential-identities";
import { mergeIosAutofillInbox } from "@/utils/ios-autofill-inbox";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import {
    getCachedAutoLockMinutes,
    loadAutoLockMinutes,
} from "@/utils/auto-lock-settings";
import { colors } from "@/theme";
import { ensureSecretTempFilesReady } from "@/utils/secret-temp-files";
import { bindOnlineServicesQueryCache } from "@/utils/online-services-query-cache";
import { AgentRuntimeBridge } from "@/agent/agent-runtime-bridge";
import { activateAppLocale } from "@/i18n";

SplashScreen.preventAutoHideAsync().catch(() => {
    /* already prevented / unavailable */
});

/**
 * Routes each Android credential request to the request screen. A prior
 * request can leave a stale pathname during task handoff, so deduplicate by
 * request ID rather than the router's last reported path.
 */
function CredentialRequestWatcher() {
    const router = useRouter();
    const routedRequestIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== "android") return;
        const route = () => {
            if (!androidCredentials.available) return;
            const pending = androidCredentials.getPendingRequest();
            if (!pending || routedRequestIdRef.current === pending.id) return;
            routedRequestIdRef.current = pending.id;
            router.replace("/credential-request");
        };
        route();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") route();
        });
        const requestSubscription =
            androidCredentials.addCredentialRequestListener(route);
        return () => {
            subscription.remove();
            requestSubscription.remove();
        };
    }, [router]);

    return null;
}

/** Keeps only non-secret credential metadata available to Android while unlocked. */
function CredentialProviderBridge() {
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const credentials = useAtomValue(vaultCredentialsAtom);

    useEffect(() => {
        if (!unlocked) {
            androidCredentials.clearProviderCredentials();
            return;
        }
        androidCredentials.setProviderCredentials(
            buildAndroidProviderCredentials(credentials),
            getCachedAutoLockMinutes(),
        );
    }, [credentials, unlocked]);

    return null;
}

/**
 * Keeps iOS AutoFill suggestions in step with the unlocked vault's logins, and
 * adds the logins the extension saved for it. Adding them changes the logins,
 * which updates the suggestions again.
 */
function IosCredentialIdentityBridge() {
    const vaultDbIndex = useAtomValue(unlockedVaultMetadataAtom)?.DBIndex;
    const credentials = useAtomValue(vaultCredentialsAtom);
    const showNotice = useUnlockedSnackbar();

    useEffect(() => {
        if (vaultDbIndex == null) return;
        const merge = () =>
            void mergeIosAutofillInbox(vaultDbIndex)
                .then((result) => {
                    if (!result) return;
                    const saved =
                        result.added + result.updated + result.savedAsNew;
                    const notice = [
                        saved
                            ? plural(saved, {
                                  one: "Saved # AutoFill login to your vault.",
                                  other: "Saved # AutoFill logins to your vault.",
                              })
                            : "",
                        result.associated
                            ? plural(result.associated, {
                                  one: "Added # website from AutoFill to your logins.",
                                  other: "Added # websites from AutoFill to your logins.",
                              })
                            : "",
                        result.savedAsNew
                            ? plural(result.savedAsNew, {
                                  one: "# saved password was for a login you had deleted, so it was added as a new login.",
                                  other: "# saved passwords were for logins you had deleted, so they were added as new logins.",
                              })
                            : "",
                        result.failed
                            ? plural(result.failed, {
                                  one: "# AutoFill login could not be added to your vault.",
                                  other: "# AutoFill logins could not be added to your vault.",
                              })
                            : "",
                    ]
                        .filter(Boolean)
                        .join(" ");
                    if (notice) showNotice(notice);
                })
                // A lock or a failed save keeps the entries for the next try.
                .catch(() => undefined);
        merge();
        // The extension can save while the vault stays unlocked in the background.
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") merge();
        });
        return () => subscription.remove();
    }, [showNotice, vaultDbIndex]);

    useEffect(() => {
        void retryIosCredentialIdentityClears();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") void retryIosCredentialIdentityClears();
        });
        return () => subscription.remove();
    }, []);

    useEffect(() => {
        if (vaultDbIndex == null) return;
        void syncIosCredentialIdentities(vaultDbIndex, credentials);
        // iOS takes suggestions only once the user turns the extension on in Settings.
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active")
                void syncIosCredentialIdentities(vaultDbIndex, credentials);
        });
        return () => subscription.remove();
    }, [credentials, vaultDbIndex]);

    return null;
}

/** Follows device language changes, including Android's per-app language setting. */
function LocaleSync() {
    const locales = useLocales();
    useEffect(() => activateAppLocale(), [locales]);
    return null;
}

export default function RootLayout() {
    return (
        <I18nProvider i18n={i18n}>
            <LocaleSync />
            <RootStack />
        </I18nProvider>
    );
}

function RootStack() {
    const { t } = useLingui();
    const [autoLockSettingsLoaded, setAutoLockSettingsLoaded] = useState(false);
    useEffect(() => {
        void ensureSecretTempFilesReady().catch(() => undefined);
        void loadAutoLockMinutes().then(() => setAutoLockSettingsLoaded(true));
    }, []);
    const [queryClient] = useState(() => new QueryClient());
    useEffect(() => bindOnlineServicesQueryCache(queryClient), [queryClient]);
    const [trpcClient] = useState(() =>
        trpcReact.createClient(reactQueryClientConfig()),
    );

    const reducedMotion = useReducedMotion();

    const [fontsLoaded, fontError] = useFonts({
        Oxanium_400Regular,
        Oxanium_500Medium,
        Oxanium_600SemiBold,
        Oxanium_700Bold,
    });

    useEffect(() => {
        if ((fontsLoaded || fontError) && autoLockSettingsLoaded) {
            void SplashScreen.hideAsync();
        }
    }, [fontsLoaded, fontError, autoLockSettingsLoaded]);

    if ((!fontsLoaded && !fontError) || !autoLockSettingsLoaded) {
        return null;
    }

    return (
        <GestureHandlerRootView
            style={{ flex: 1, backgroundColor: colors.background }}
        >
            <SafeAreaProvider>
                <JotaiProvider store={vaultStore}>
                    <CredentialRequestWatcher />
                    <CredentialProviderBridge />
                    {Platform.OS === "ios" ? (
                        <IosCredentialIdentityBridge />
                    ) : null}
                    <AgentRuntimeBridge />
                    <trpcReact.Provider
                        client={trpcClient}
                        queryClient={queryClient}
                    >
                        <QueryClientProvider client={queryClient}>
                            <StatusBar style="light" />
                            <Stack
                                screenOptions={{
                                    headerShown: false,
                                    contentStyle: {
                                        backgroundColor: colors.background,
                                    },
                                    animation: reducedMotion ? "none" : "fade",
                                    headerStyle: {
                                        backgroundColor: colors.background,
                                    },
                                    headerTintColor: colors.primary,
                                    headerTitleStyle: {
                                        fontFamily: "Oxanium_600SemiBold",
                                        color: colors.foreground,
                                    },
                                    headerShadowVisible: false,
                                    headerBackTitle: t`Back`,
                                }}
                            >
                                <Stack.Screen name="index" />
                                <Stack.Screen name="(locked)" />
                                <Stack.Screen name="(app)" />
                                <Stack.Screen name="credential-request" />
                                <Stack.Screen name="billing-return" />
                                <Stack.Screen
                                    name="link-receive"
                                    options={{
                                        headerShown: false,
                                        animation: reducedMotion
                                            ? "none"
                                            : "slide_from_right",
                                    }}
                                />
                                {/* Legacy redirects */}
                                <Stack.Screen name="welcome" />
                                <Stack.Screen name="unlock" />
                                <Stack.Screen name="create" />
                                <Stack.Screen name="restore" />
                            </Stack>
                            <PortalHost />
                        </QueryClientProvider>
                    </trpcReact.Provider>
                </JotaiProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
