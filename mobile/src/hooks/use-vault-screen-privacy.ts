import { useEffect } from "react";
import { Platform } from "react-native";
import * as ScreenCapture from "expo-screen-capture";

const DEFAULT_PRIVACY_KEY = "cryptex-vault-unlocked";
const screenCaptureAllowedForE2E =
    process.env.EXPO_PUBLIC_CRYPTEX_E2E === "1";

/**
 * iOS route privacy. Android sets FLAG_SECURE in native activity creation;
 * calling allowScreenCaptureAsync on route unmount would clear that native flag.
 */
export function useVaultScreenPrivacy(
    enabled: boolean,
    privacyKey = DEFAULT_PRIVACY_KEY,
) {
    useEffect(() => {
        if (Platform.OS !== "ios" || !enabled || screenCaptureAllowedForE2E)
            return;

        let cancelled = false;

        void (async () => {
            try {
                await ScreenCapture.preventScreenCaptureAsync(privacyKey);
            } catch {
                // Native module missing (needs rebuild) or platform unsupported.
            }
            if (cancelled) return;
            try {
                await ScreenCapture.enableAppSwitcherProtectionAsync(0.7);
            } catch {
                // Older iOS / module unavailable.
            }
        })();

        return () => {
            cancelled = true;
            void (async () => {
                try {
                    await ScreenCapture.allowScreenCaptureAsync(privacyKey);
                } catch {
                    // ignore
                }
                try {
                    await ScreenCapture.disableAppSwitcherProtectionAsync();
                } catch {
                    // ignore
                }
            })();
        };
    }, [enabled, privacyKey]);
}
