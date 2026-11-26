import AsyncStorage from "@react-native-async-storage/async-storage";
import { iosCredentials } from "@/utils/ios-credentials";

export const AUTO_COPY_TOTP_KEY = "cryptex:autofill-auto-copy-totp";

let cachedAutoCopyTotp = false;

export function getCachedAutoCopyTotp(): boolean {
    return cachedAutoCopyTotp;
}

// On iOS the setting lives in the App Group, where the AutoFill extension reads it.
export async function loadAutoCopyTotp(): Promise<boolean> {
    try {
        cachedAutoCopyTotp = iosCredentials
            ? await iosCredentials.getAutoCopyTotp()
            : (await AsyncStorage.getItem(AUTO_COPY_TOTP_KEY)) === "true";
    } catch {
        cachedAutoCopyTotp = false;
    }
    return cachedAutoCopyTotp;
}

export async function saveAutoCopyTotp(enabled: boolean): Promise<void> {
    cachedAutoCopyTotp = enabled;
    if (iosCredentials) await iosCredentials.setAutoCopyTotp(enabled);
    else await AsyncStorage.setItem(AUTO_COPY_TOTP_KEY, String(enabled));
}
