import "../src/polyfills";
import "../src/vault-core-runtime";
import "../global.css";

import { useEffect, useRef, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";

import * as SplashScreen from "expo-splash-screen";
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
    vaultCredentialsAtom,
    vaultStore,
} from "@/utils/atoms";
import { trpcReact, reactQueryClientConfig } from "@/utils/trpc";
import { androidCredentials } from "@/utils/android-credentials";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";
import { getCachedAutoLockMinutes, loadAutoLockMinutes } from "@/utils/auto-lock-settings";
import { colors } from "@/theme";
import { ensureSecretTempFilesReady } from "@/utils/secret-temp-files";
import { bindOnlineServicesQueryCache } from "@/utils/online-services-query-cache";

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

export default function RootLayout() {
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
                                    headerBackTitle: "Back",
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
