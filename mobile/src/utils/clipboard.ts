import * as Clipboard from "expo-clipboard";
import { requireOptionalNativeModule } from "expo-modules-core";
import { androidCredentials } from "@/utils/android-credentials";
import { isAutoLockDue } from "@/utils/session-timeout";
import { getVaultLockEpoch } from "@/utils/vault-lock-epoch";

export const SECRET_CLEAR_MS = 30_000;

type IosClipboardModule = {
    /**
     * Writes text that stays on this device and expires on its own. Resolves
     * with a marker for this copy.
     */
    setSecretString(text: string, expiresInMs: number): Promise<string>;
    /** Clears the clipboard if it still holds the marked copy. */
    clearSecretIfOwned(marker: string): Promise<void>;
    /** Plain copy, ordered with clearSecretIfOwned. */
    setString(text: string): Promise<void>;
};

/** Only iOS builds include the module. */
const iosClipboard = requireOptionalNativeModule<IosClipboardModule>(
    "CryptexIosClipboard",
);

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSecret: string | null = null;
let pendingMarker: string | null = null;

function clearScheduledClear() {
    if (clearTimer != null) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
}

async function clearIfStillSecret() {
    const expected = pendingSecret;
    const marker = pendingMarker;
    pendingSecret = null;
    pendingMarker = null;
    clearTimer = null;
    if (expected == null) return;

    try {
        // Reading the clipboard after another app copied shows iOS's paste prompt.
        if (iosClipboard && marker != null) {
            await iosClipboard.clearSecretIfOwned(marker);
            return;
        }

        const current = await Clipboard.getStringAsync();
        if (current === expected) {
            await Clipboard.setStringAsync("");
        }
    } catch {
        // Clipboard may be unavailable; leave as-is.
    }
}

/**
 * Copy a secret and schedule a 30s clear if the clipboard still holds it.
 * Reusable by vault detail, list actions, generator, and later screens.
 */
export async function copySecretToClipboard(text: string): Promise<boolean> {
    if (!text || isAutoLockDue()) return false;
    const lockEpoch = getVaultLockEpoch();
    let marker: string | null = null;

    try {
        if (androidCredentials.available) {
            await androidCredentials.setSensitiveClipboardString(text);
        } else if (iosClipboard) {
            marker = await iosClipboard.setSecretString(text, SECRET_CLEAR_MS);
        } else {
            await Clipboard.setStringAsync(text);
        }
    } catch {
        return false;
    }

    if (isAutoLockDue() || getVaultLockEpoch() !== lockEpoch) {
        // A suspended native write can complete after the session expires,
        // or after a lock started and already cleared the clipboard.
        if (androidCredentials.available)
            androidCredentials.clearSensitiveClipboardIfOwned();
        clearScheduledClear();
        pendingSecret = text;
        pendingMarker = marker;
        await clearIfStillSecret();
        return false;
    }

    clearScheduledClear();
    pendingSecret = text;
    pendingMarker = marker;
    clearTimer = setTimeout(() => {
        void clearIfStillSecret();
    }, SECRET_CLEAR_MS);

    return true;
}

/** Copy non-secret text without scheduling a clear. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        if (iosClipboard) await iosClipboard.setString(text);
        else await Clipboard.setStringAsync(text);
        return true;
    } catch {
        return false;
    }
}

/** Clear a copied secret immediately if Cryptex still owns the clipboard. */
export async function clearPendingSecretFromClipboard(): Promise<void> {
    clearScheduledClear();
    if (androidCredentials.available)
        androidCredentials.clearSensitiveClipboardIfOwned();
    await clearIfStillSecret();
}

/** Clears module timers and pending secrets without touching the OS clipboard. */
export function resetClipboardStateForTests(): void {
    clearScheduledClear();
    pendingSecret = null;
    pendingMarker = null;
}

/** Inspects the pending secret for tests. */
export function getPendingClipboardSecretForTests(): string | null {
    return pendingSecret;
}
