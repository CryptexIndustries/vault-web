const VAULT_METADATA_SESSION_KEY = "UVM";

const ICON_PATHS = {
    16: "assets/icons/icon-16.png",
    32: "assets/icons/icon-32.png",
    48: "assets/icons/icon-48.png",
} as const;

export async function setVaultActionState(unlocked: boolean): Promise<void> {
    const extensionName = chrome.runtime.getManifest().name;
    const state = unlocked ? "unlocked" : "locked";

    await Promise.all([
        chrome.action.setIcon({ path: ICON_PATHS }),
        chrome.action.setTitle({
            title: `${extensionName} - Vault ${state}`,
        }),
    ]);
}

async function syncVaultActionState(): Promise<void> {
    const stored = await chrome.storage.session.get([
        VAULT_METADATA_SESSION_KEY,
    ]);
    await setVaultActionState(Boolean(stored[VAULT_METADATA_SESSION_KEY]));
}

/**
 * Keeps the toolbar icon aligned with the session-backed vault state.
 * Calling this during service-worker evaluation also repairs stale UI after
 * a Manifest V3 worker restart.
 */
export function registerVaultActionStateIndicator(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (
            areaName !== "session" ||
            !(VAULT_METADATA_SESSION_KEY in changes)
        ) {
            return;
        }

        void setVaultActionState(
            Boolean(changes[VAULT_METADATA_SESSION_KEY].newValue),
        ).catch((error) => {
            console.warn("[SW] Failed to update vault action icon", error);
        });
    });

    void syncVaultActionState().catch((error) => {
        console.warn("[SW] Failed to synchronize vault action icon", error);
    });
}
