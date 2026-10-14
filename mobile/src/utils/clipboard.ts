import * as Clipboard from "expo-clipboard";
import { androidCredentials } from "@/utils/android-credentials";
import { isAutoLockDue } from "@/utils/session-timeout";

export const SECRET_CLEAR_MS = 30_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSecret: string | null = null;

function clearScheduledClear() {
    if (clearTimer != null) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
}

async function clearIfStillSecret() {
    const expected = pendingSecret;
    pendingSecret = null;
    clearTimer = null;
    if (expected == null) return;

    try {
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

    try {
        if (androidCredentials.available) {
            await androidCredentials.setSensitiveClipboardString(text);
        } else {
            await Clipboard.setStringAsync(text);
        }
    } catch {
        return false;
    }

    if (isAutoLockDue()) {
        // A suspended native write can complete after the session expires.
        if (androidCredentials.available)
            androidCredentials.clearSensitiveClipboardIfOwned();
        clearScheduledClear();
        pendingSecret = text;
        await clearIfStillSecret();
        return false;
    }

    clearScheduledClear();
    pendingSecret = text;
    clearTimer = setTimeout(() => {
        void clearIfStillSecret();
    }, SECRET_CLEAR_MS);

    return true;
}

/** Copy non-secret text without scheduling a clear. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false;
    try {
        await Clipboard.setStringAsync(text);
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
}

/** Inspects the pending secret for tests. */
export function getPendingClipboardSecretForTests(): string | null {
    return pendingSecret;
}
