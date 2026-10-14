import { Alert, Linking } from "react-native";

import { normalizeCredentialUrl } from "@cryptex-industries/vault-core/credential-url";

/**
 * Normalize credential URL, warn about leaving the app, then open externally.
 */
export function openCredentialUrl(rawUrl?: string | null): void {
    const urlString = normalizeCredentialUrl(rawUrl);
    if (!urlString) {
        Alert.alert("Invalid URL", "Credential URL is invalid.");
        return;
    }

    Alert.alert(
        "Open external site",
        `You are about to visit "${urlString}"`,
        [
            { text: "Cancel", style: "cancel" },
            {
                text: "Open URL",
                onPress: () => {
                    void Linking.openURL(urlString).catch(() => {
                        Alert.alert("Error", "Could not open this URL.");
                    });
                },
            },
        ],
    );
}
