import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    DEFAULT_AUTO_LOCK_MINUTES,
    parseAutoLockMinutes,
} from "@/utils/auto-lock-policy";

export const AUTO_LOCK_KEY = "cryptex:auto-lock-minutes";

type Listener = (minutes: number) => void;

let cachedMinutes: number | null = null;
const listeners = new Set<Listener>();

export function getCachedAutoLockMinutes(): number {
    return cachedMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
}

export async function loadAutoLockMinutes(): Promise<number> {
    try {
        const raw = await AsyncStorage.getItem(AUTO_LOCK_KEY);
        cachedMinutes = parseAutoLockMinutes(raw);
    } catch {
        cachedMinutes = DEFAULT_AUTO_LOCK_MINUTES;
    }
    return cachedMinutes;
}

export async function saveAutoLockMinutes(minutes: number): Promise<void> {
    const next = parseAutoLockMinutes(String(minutes));
    cachedMinutes = next;
    try {
        await AsyncStorage.setItem(AUTO_LOCK_KEY, String(next));
    } catch {
        // Keep in-memory value so the active session still respects the choice.
    }
    for (const listener of listeners) {
        listener(next);
    }
}

export function subscribeAutoLockMinutes(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Clears the in-memory cache and subscribers for tests. */
export function resetAutoLockSettingsForTests(): void {
    cachedMinutes = null;
    listeners.clear();
}
