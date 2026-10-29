import { Alert, Linking } from "react-native";
import { t } from "@lingui/core/macro";

import { normalizeCredentialUrl } from "@cryptex-industries/vault-core/credential-url";

/**
 * Normalize credential URL, warn about leaving the app, then open externally.
 */
export function openCredentialUrl(rawUrl?: string | null): void {
    const urlString = normalizeCredentialUrl(rawUrl);
    if (!urlString) {
        Alert.alert(t`Invalid URL`, t`Credential URL is invalid.`);
        return;
    }

    Alert.alert(
        t`Open external site`,
        t`You are about to visit "${urlString}"`,
        [
            { text: t`Cancel`, style: "cancel" },
            {
                text: t`Open URL`,
                onPress: () => {
                    void Linking.openURL(urlString).catch(() => {
                        Alert.alert(t`Error`, t`Could not open this URL.`);
                    });
                },
            },
        ],
    );
}
