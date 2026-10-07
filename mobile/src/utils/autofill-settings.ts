import AsyncStorage from "@react-native-async-storage/async-storage";

export const AUTO_COPY_TOTP_KEY = "cryptex:autofill-auto-copy-totp";

let cachedAutoCopyTotp = false;

export function getCachedAutoCopyTotp(): boolean {
    return cachedAutoCopyTotp;
}

export async function loadAutoCopyTotp(): Promise<boolean> {
    try {
        const saved = await AsyncStorage.getItem(AUTO_COPY_TOTP_KEY);
        cachedAutoCopyTotp = saved === "true";
    } catch {
        cachedAutoCopyTotp = false;
    }
    return cachedAutoCopyTotp;
}

export async function saveAutoCopyTotp(enabled: boolean): Promise<void> {
    cachedAutoCopyTotp = enabled;
    await AsyncStorage.setItem(AUTO_COPY_TOTP_KEY, String(enabled));
}
